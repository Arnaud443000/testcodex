import type { Decimal } from '../types/money'
import type { TradeView } from '../types/trade'
import type { JournalEntry } from '../types/journal'
import type { StatsQuery, Summary } from '../types/stats'
import type {
  Drift,
  EvidenceFilter,
  Insight,
  InsightDetail,
  InsightHalf,
  InsightMessageKey,
  InsightPeriod,
  InsightPriority,
  InsightRecord,
  InsightSource,
  SegmentHighlight,
} from '../types/insights'
import { localDay, ratio, toDec, toScaled } from './mockStats'
import { summary as summaryOf, type Closed } from './mockAnalyses'
import {
  mockDiscipline,
  mockExternalFactors,
  mockMistakes,
  mockPatterns,
  mockRisk,
  mockRuleAdherence,
  mockSizeChange,
  type BehaviorInput,
} from './mockBehavior'

/**
 * MOCK des insights automatiques (lot 19) — uniquement pour `npm run dev` dans un navigateur.
 * Il suit CLAUDE.md (« Insights automatiques (lot 19) ») en lisant les rapports du faux backend, comme
 * pulse-core lit les siens, et il est testé contre les journaux du test Rust `insights::tests`.
 * Il ne fait pas foi : dans l'application, tout vient de `pulse_core::insights`. Montants en BigInt exacts.
 */

const DAY = 86_400_000
const MIN = 60_000
const EPSILON = 1e-9
export const TREND_WINDOW = 20
export const TREND_MIN_HALF = 5
export const ANALYSIS_DAYS = 90
export const EPISODE_GAP_MS = 14 * DAY
const RISK_BAND = 0.2
const DISCIPLINE_GAP = 10
const PLAN_DROP = 0.25
const FEES_UP = 0.25
const RULE_MIN_CHECKS = 10
const RULE_DROP = 0.25
const MAX_RULES = 2
const SIZE_AFTER_LOSS = 0.2
const PATTERN_MIN_COUNT = 2
const SEGMENT_MIN_R_TRADES = 10
const GAP_R = 0.25
const MISTAKE_MIN_TRADES = 3
const MISTAKE_MIN_SHARE = 0.1
const MAX_MISTAKES = 2
const MIN_R_TRADES = 5
const MAX_EMOTIONS = 2

const RANK: Record<InsightDetail['kind'], number> = {
  riskDrift: 0, disciplineTrend: 1, planDrop: 2, ruleAdherenceDrop: 3, feesUp: 4, sizeUpAfterLoss: 5, revengePattern: 6,
  overtradingPattern: 7, costlyMistake: 8, emotionLower: 9, factorLower: 10, bestSegment: 11, weakSegment: 12,
}
const PRIORITY: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 }

const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null
const byExit = (a: Closed, b: Closed) => a.exitTime - b.exitTime || a.id - b.id
const level = (value: number, step: number) => Math.floor(Math.abs(value) / step + EPSILON)
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length

/** Le compte « tel qu'à `now` » : trades entrés après ignorés, sortis après = ouverts, flux après ignorés. */
function asOf(input: BehaviorInput, now: number): BehaviorInput {
  return {
    ...input,
    cashFlows: input.cashFlows.filter((f) => f.occurredAt <= now),
    trades: input.trades
      .filter((t) => t.entryTime <= now)
      .map((t) => (t.exitTime != null && t.exitTime > now ? { ...t, exitTime: null, exitPrice: null, figures: null } : t)),
  }
}

interface Scope {
  input: BehaviorInput
  accountId: number
  currency: string | null
  analysis: StatsQuery
  out: Insight[]
}

function push(
  s: Scope, priority: InsightPriority, messageKey: InsightMessageKey, subject: string, lvl: number, period: InsightPeriod,
  source: InsightSource, tradeIds: number[], filter: EvidenceFilter | null, detail: InsightDetail, order = 0,
) {
  const situation = `${detail.kind}:${s.accountId}:${subject}`
  const rank = RANK[detail.kind]
  const category = rank <= 7 ? 'trend' : rank <= 10 ? 'suggestion' : 'highlight'
  s.out.push({
    ...detail, id: `${situation}:${lvl}`, situation, level: lvl, episode: 0, accountId: s.accountId, currency: s.currency, category, priority,
    messageKey, period, source, tradeIds, filter, firstSeenAt: null, dismissedAt: null, order,
  } as Insight & { order: number })
}

const analysisPeriod = (s: Scope, tradeCount: number): InsightPeriod => ({
  basis: 'days', from: s.analysis.from ?? null, to: s.analysis.to ?? null, tradeCount, days: ANALYSIS_DAYS,
})

const selectedIn = (input: BehaviorInput, q: StatsQuery) =>
  input.trades.filter(isClosed).filter((t) => (q.from == null || t.exitTime >= q.from) && (q.to == null || t.exitTime < q.to)).sort(byExit)

/** Moyenne exacte (8 décimales) des montants des trades `ids` présents dans `values`. */
function meanAmount(ids: number[], values: Map<number, Decimal>): bigint {
  const v = ids.flatMap((id) => (values.has(id) ? [toScaled(values.get(id)!)] : []))
  return v.length ? v.reduce((a, b) => a + b, 0n) / BigInt(v.length) : 0n
}

function trends(s: Scope) {
  const closed = s.input.trades.filter(isClosed).sort(byExit)
  const last = closed.slice(Math.max(0, closed.length - TREND_WINDOW))
  const half = Math.floor(last.length / 2)
  if (half >= TREND_MIN_HALF) {
    const ids = last.map((t) => t.id)
    const exit = new Map(last.map((t) => [t.id, t.exitTime]))
    const older = ids.slice(0, half)
    const recent = ids.slice(ids.length - half)
    const q: StatsQuery = { accountIds: [s.accountId], from: last[0].exitTime }
    const period: InsightPeriod = { basis: 'lastTrades', from: last[0].exitTime, to: last[last.length - 1].exitTime, tradeCount: ids.length, days: null }
    const halfOf = (h: number[], valueCount: number): InsightHalf => ({ tradeCount: h.length, valueCount, from: exit.get(h[0])!, to: exit.get(h[h.length - 1])!, tradeIds: h })
    const means = (values: Map<number, number>, min: number) => {
      const m = (h: number[]) => {
        const v = h.flatMap((id) => (values.has(id) ? [values.get(id)!] : []))
        return v.length >= min ? ([mean(v), v.length] as const) : null
      }
      const [a, b] = [m(older), m(recent)]
      return a && b ? { older: a, recent: b } : null
    }

    // Risque en % du capital.
    const risk = mockRisk(s.input, q).trades
    const pct = new Map(risk.flatMap((t) => (t.riskPct === null ? [] : [[t.tradeId, t.riskPct] as const])))
    const money = new Map(risk.flatMap((t) => (t.riskPct === null || t.initialRisk === null ? [] : [[t.tradeId, t.initialRisk] as const])))
    const r = means(pct, TREND_MIN_HALF)
    if (r && r.older[0] > 0) {
      const change = r.recent[0] / r.older[0] - 1
      const direction: Drift | null = change >= RISK_BAND - EPSILON ? 'up' : change <= -RISK_BAND + EPSILON ? 'down' : null
      if (direction) {
        const [o, n] = [meanAmount(older, money), meanAmount(recent, money)]
        push(s, direction === 'up' ? 'high' : 'low', `riskDrift.${direction}`, direction, level(change, 0.1), period, 'risk', ids, null, {
          kind: 'riskDrift', direction, older: halfOf(older, r.older[1]), recent: halfOf(recent, r.recent[1]),
          olderAvgRiskPct: r.older[0], recentAvgRiskPct: r.recent[0], change, olderAvgRisk: toDec(o), recentAvgRisk: toDec(n),
          riskChange: ratio(n - o, o), threshold: RISK_BAND,
        })
      }
    }

    // Discipline et plan.
    const d = mockDiscipline(s.input, q).trades
    const scores = new Map(d.flatMap((t) => (t.score === null ? [] : [[t.tradeId, t.score] as const])))
    const plan = new Map(d.flatMap((t) => {
      const v = t.components.find((c) => c.key === 'plan')?.value
      return v == null ? [] : [[t.tradeId, v] as const]
    }))
    const ds = means(scores, TREND_MIN_HALF)
    if (ds) {
      const difference = ds.recent[0] - ds.older[0]
      const direction: Drift | null = difference <= -DISCIPLINE_GAP + EPSILON ? 'down' : difference >= DISCIPLINE_GAP - EPSILON ? 'up' : null
      if (direction) {
        push(s, direction === 'down' ? 'high' : 'low', `disciplineTrend.${direction}`, direction, level(difference, 10), period, 'discipline', ids, null, {
          kind: 'disciplineTrend', direction, older: halfOf(older, ds.older[1]), recent: halfOf(recent, ds.recent[1]),
          olderScore: ds.older[0], recentScore: ds.recent[0], difference, threshold: DISCIPLINE_GAP,
        })
      }
    }
    const pm = means(plan, TREND_MIN_HALF)
    if (pm && pm.recent[0] - pm.older[0] <= -PLAN_DROP + EPSILON) {
      const difference = pm.recent[0] - pm.older[0]
      push(s, 'medium', 'planDrop', 'plan', level(difference, 0.1), period, 'discipline', ids, null, {
        kind: 'planDrop', older: halfOf(older, pm.older[1]), recent: halfOf(recent, pm.recent[1]),
        olderRate: pm.older[0], recentRate: pm.recent[0], difference, threshold: PLAN_DROP,
      })
    }

    // Frais moyens par trade.
    const fees = new Map(last.map((t) => [t.id, t.figures.fees] as const))
    const [fo, fr] = [meanAmount(older, fees), meanAmount(recent, fees)]
    const change = fo > 0n ? ratio(fr - fo, fo) : null
    if (change !== null && change >= FEES_UP - EPSILON) {
      push(s, 'medium', 'feesUp', 'fees', level(change, FEES_UP), period, 'fees', ids, null, {
        kind: 'feesUp', older: halfOf(older, older.length), recent: halfOf(recent, recent.length),
        olderAvgFees: toDec(fo), recentAvgFees: toDec(fr), change, threshold: FEES_UP,
      })
    }
  }

  // Règles moins respectées (fenêtre d'analyse).
  const selected = selectedIn(s.input, s.analysis)
  const drops = mockRuleAdherence(s.input, s.analysis).rules
    .filter((r) => r.checks >= RULE_MIN_CHECKS && r.trend !== null && r.trend <= -RULE_DROP + EPSILON)
    .sort((a, b) => a.trend! - b.trend!)
    .slice(0, MAX_RULES)
  drops.forEach((r, order) =>
    push(s, 'medium', 'ruleAdherenceDrop', String(r.ruleId), level(r.trend!, 0.1), analysisPeriod(s, selected.length), 'ruleAdherence',
      selected.filter((t) => t.ruleChecks.some((c) => c.ruleId === r.ruleId)).map((t) => t.id), { kind: 'mistake', source: 'rule', id: r.ruleId }, {
        kind: 'ruleAdherenceDrop', ruleId: r.ruleId, text: r.text, checks: r.checks, respected: r.respected, rate: r.rate, trend: r.trend!,
        threshold: RULE_DROP, minChecks: RULE_MIN_CHECKS,
      }, order),
  )

  // Taille après une perte.
  const sc = mockSizeChange(s.input, s.analysis)
  const [al, aw, gap] = [sc.afterLoss.meanChange, sc.afterWin.meanChange, sc.lossVsWin]
  if (al !== null && aw !== null && gap !== null && al >= SIZE_AFTER_LOSS - EPSILON && gap >= SIZE_AFTER_LOSS - EPSILON) {
    push(s, 'high', 'sizeUpAfterLoss', 'afterLoss', level(gap, 0.1), analysisPeriod(s, sc.tradeCount), 'sizeChange', sc.afterLoss.cases.map((c) => c.tradeId), null, {
      kind: 'sizeUpAfterLoss', afterLossMean: al, afterLossMedian: sc.afterLoss.medianChange, afterWinMean: aw, lossVsWin: gap,
      afterLossCases: sc.afterLoss.caseCount, afterWinCases: sc.afterWin.caseCount, increasedCount: sc.afterLoss.increasedCount, threshold: SIZE_AFTER_LOSS,
    })
  }

  // Revanche et surtrading répétés.
  const p = mockPatterns({ ...s.input, missed: [] }, s.analysis)
  const count = p.revengeTrades.length
  if (count >= PATTERN_MIN_COUNT) {
    push(s, 'high', 'revengePattern', 'revenge', count, analysisPeriod(s, selected.length), 'patterns', p.revengeTrades.map((t) => t.tradeId), null, {
      kind: 'revengePattern', count, netPnl: p.revengeSummary.netPnl, winRate: p.revengeSummary.winRate,
      windowMin: s.input.settings.revengeWindowMin, sizeFactor: s.input.settings.revengeSizeFactor, minCount: PATTERN_MIN_COUNT,
    })
  }
  if (p.maxTradesPerDay !== null && p.overtradingDays.length >= PATTERN_MIN_COUNT) {
    const tradeIds = p.overtradingDays.flatMap((d) => d.tradeIds)
    const dayCount = p.overtradingDays.length
    push(s, 'medium', 'overtradingPattern', 'overtrading', dayCount, analysisPeriod(s, selected.length), 'patterns', tradeIds, null, {
      kind: 'overtradingPattern', dayCount, limit: p.maxTradesPerDay, days: p.overtradingDays.map((d) => d.day), tradeCount: tradeIds.length, minCount: PATTERN_MIN_COUNT,
    })
  }
}

function suggestions(s: Scope, journal: JournalEntry[]) {
  const selected = selectedIn(s.input, s.analysis)
  const all = summaryOf(selected)
  const totalLosses = toScaled(all.totalLosses)
  const report = mockMistakes(s.input, s.analysis)
  let order = 0
  for (const m of report.byCost) {
    if (order === MAX_MISTAKES) break
    const cost = toScaled(m.cost)
    if (m.tradeCount < MISTAKE_MIN_TRADES || cost <= 0n || cost * 10n < totalLosses) continue
    push(s, 'medium', `costlyMistake.${m.source}`, `${m.source}:${m.id}`, m.tradeCount, analysisPeriod(s, report.tradeCount), 'mistakes', m.tradeIds,
      { kind: 'mistake', source: m.source, id: m.id }, {
        kind: 'costlyMistake', mistakeSource: m.source, mistakeId: m.id, label: m.label, tradeCount: m.tradeCount, shareOfTrades: m.share, cost: m.cost,
        totalLosses: all.totalLosses, shareOfLosses: ratio(cost, totalLosses), netPnl: m.netPnl, expectancyR: m.expectancyR,
        minTrades: MISTAKE_MIN_TRADES, minShareOfLosses: MISTAKE_MIN_SHARE,
      }, order++)
  }

  // Émotions déclarées avant l'entrée.
  const groups = new Map<number, Closed[]>()
  for (const t of selected) {
    for (const id of new Set(t.emotions.filter((e) => e.moment === 'before').map((e) => e.tagId))) groups.set(id, [...(groups.get(id) ?? []), t])
  }
  const name = (id: number) => s.input.tags.find((g) => g.id === id)?.name ?? String(id)
  const found = [...groups.entries()]
    .sort(([a], [b]) => name(a).toLowerCase().localeCompare(name(b).toLowerCase()))
    .flatMap(([tagId, list]) => {
      const group = summaryOf(list)
      const others = summaryOf(selected.filter((t) => !list.includes(t)))
      if (group.rTradeCount < MIN_R_TRADES || others.rTradeCount < MIN_R_TRADES || group.expectancyR === null || others.expectancyR === null) return []
      const difference = group.expectancyR - others.expectancyR
      return difference <= -GAP_R + EPSILON ? [{ tagId, list, group, others, difference }] : []
    })
    .sort((a, b) => a.difference - b.difference)
    .slice(0, MAX_EMOTIONS)
  found.forEach((e, i) =>
    push(s, 'medium', 'emotionLower', String(e.tagId), level(e.difference, GAP_R), analysisPeriod(s, selected.length), 'emotions', e.list.map((t) => t.id), null, {
      kind: 'emotionLower', tagId: e.tagId, name: name(e.tagId), group: e.group, others: e.others, difference: e.difference, threshold: GAP_R,
    }, i),
  )

  // Facteurs externes.
  const factors = mockExternalFactors(s.input, s.analysis, journal)
  factors.factors.forEach((f, i) => {
    const lower = [f.discipline.verdict, f.expectancyR.verdict].filter((v) => v === 'lower').length
    if (!lower) return
    push(s, 'medium', 'factorLower', f.key, lower, analysisPeriod(s, factors.tradeCount), 'externalFactors', f.present.tradeIds, null, {
      kind: 'factorLower', factor: f.key, presentDays: f.present.dayCount, absentDays: f.absent.dayCount,
      presentTradeCount: f.present.summary.tradeCount, absentTradeCount: f.absent.summary.tradeCount, discipline: f.discipline, expectancyR: f.expectancyR,
    }, i)
  })
}

function highlights(s: Scope) {
  const selected = selectedIn(s.input, s.analysis)
  const baseline = summaryOf(selected)
  if (baseline.expectancyR === null) return
  const base = baseline.expectancyR
  for (const [dimension, kind, order] of [['setup', 'setup', 0], ['session', 'session', 1]] as const) {
    const byTag = new Map<number, Closed[]>()
    for (const t of selected) {
      for (const id of t.tagIds) if (s.input.tags.find((g) => g.id === id)?.kind === kind) byTag.set(id, [...(byTag.get(id) ?? []), t])
    }
    const name = (id: number) => s.input.tags.find((g) => g.id === id)?.name ?? String(id)
    const eligible = [...byTag.entries()]
      .sort(([a], [b]) => name(a).toLowerCase().localeCompare(name(b).toLowerCase()))
      .map(([tagId, list]) => ({ tagId, list, summary: summaryOf(list) }))
      .filter((e) => e.summary.rTradeCount >= SEGMENT_MIN_R_TRADES && e.summary.expectancyR !== null)
    if (eligible.length < 2) continue
    const exp = (e: { summary: Summary }) => e.summary.expectancyR!
    const pick = (better: (a: number, b: number) => boolean) =>
      eligible.slice(1).reduce((best, e) => (better(exp(e), exp(best)) || (exp(e) === exp(best) && e.summary.rTradeCount > best.summary.rTradeCount) ? e : best), eligible[0])
    const highlight = (e: (typeof eligible)[number]): SegmentHighlight => ({
      dimension, tagId: e.tagId, name: name(e.tagId), summary: e.summary, baselineExpectancyR: base, baselineRTradeCount: baseline.rTradeCount,
      eligibleCount: eligible.length, gap: exp(e) - base, minRTrades: SEGMENT_MIN_R_TRADES,
    })
    const filter = (e: (typeof eligible)[number]): EvidenceFilter | null => (dimension === 'setup' ? { kind: 'setup', tagId: e.tagId } : null)
    const period = analysisPeriod(s, selected.length)
    const best = pick((a, b) => a > b)
    const weak = pick((a, b) => a < b)
    if (exp(best) > 0 && exp(best) >= base + GAP_R - EPSILON) {
      push(s, 'low', `bestSegment.${dimension}`, `${dimension}:${best.tagId}`, 0, period, 'segments', best.list.map((t) => t.id), filter(best), { kind: 'bestSegment', ...highlight(best) }, order)
    }
    if (exp(weak) < 0 && exp(weak) <= base - GAP_R + EPSILON) {
      push(s, 'medium', `weakSegment.${dimension}`, `${dimension}:${weak.tagId}`, 0, period, 'segments', weak.list.map((t) => t.id), filter(weak), { kind: 'weakSegment', ...highlight(weak) }, order)
    }
  }
}

type Ordered = Insight & { order: number }

/** Même ordre que `insights::sort` : priorité, ordre des tableaux, compte, rang dans son rapport. */
export function sortInsights(list: Insight[]): Insight[] {
  const o = (i: Insight) => (i as Ordered).order ?? 0
  return [...list].sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || RANK[a.kind] - RANK[b.kind] || a.accountId - b.accountId || o(a) - o(b))
}

/** Insights d'UN compte (`input` ne contient que lui) à `now` ; pur, sans état. */
export function mockEvaluateInsights(input: BehaviorInput, journal: JournalEntry[], now: number, tzOffsetMin: number): Insight[] {
  const account = input.accounts[0]
  if (!account) return []
  const today = localDay(now, tzOffsetMin)
  const midnight = (day: number) => day * DAY - tzOffsetMin * MIN
  const s: Scope = {
    input: asOf(input, now),
    accountId: account.id,
    currency: account.currency,
    analysis: { accountIds: [account.id], from: midnight(today + 1 - ANALYSIS_DAYS), to: midnight(today + 1) },
    out: [],
  }
  trends(s)
  suggestions(s, journal)
  highlights(s)
  return sortInsights(s.out)
}

interface LogRow extends InsightRecord {
  lastSeenAt: number
}

/** Historique en mémoire : mêmes règles que `insights::log` (épisodes, paliers, masquage). */
export function createInsightLog() {
  const rows = new Map<string, LogRow>()
  return {
    record(insights: Insight[], now: number, includeDismissed: boolean): Insight[] {
      const shown: Insight[] = []
      for (const found of insights) {
        const same = [...rows.values()].filter((r) => r.situation === found.situation)
        const lastEpisode = same.length ? Math.max(...same.map((r) => r.episode)) : null
        const lastSeen = same.length ? Math.max(...same.map((r) => r.lastSeenAt)) : null
        const episode = lastEpisode === null ? 1 : lastSeen !== null && now - lastSeen <= EPISODE_GAP_MS ? lastEpisode : lastEpisode + 1
        const insight = { ...found, episode, id: `${found.situation}:${found.level}#${episode}`, firstSeenAt: now }
        const { order: _order, ...payload } = insight as Ordered
        if (!rows.has(insight.id)) {
          rows.set(insight.id, {
            insightId: insight.id, accountId: insight.accountId, situation: insight.situation, level: insight.level, episode, kind: insight.kind,
            category: insight.category, priority: insight.priority, firstSeenAt: now, lastSeenAt: now, dismissedAt: null, insight: structuredClone(payload),
          })
        }
        const row = rows.get(insight.id)!
        row.lastSeenAt = Math.max(row.lastSeenAt, now)
        insight.firstSeenAt = row.firstSeenAt
        const dismissed = [...rows.values()]
          .filter((r) => r.situation === insight.situation && r.episode === episode && r.level >= insight.level && r.dismissedAt !== null)
          .map((r) => r.dismissedAt!)
        insight.dismissedAt = dismissed.length ? Math.min(...dismissed) : null
        if (includeDismissed || insight.dismissedAt === null) shown.push(insight)
      }
      return shown
    },
    dismiss(insightId: string, now: number) {
      const r = rows.get(insightId)
      if (!r) throw new Error(`not found: insight ${insightId}`)
      r.dismissedAt ??= now
    },
    history(accountIds: number[], limit: number): InsightRecord[] {
      return [...rows.values()]
        .filter((r) => !accountIds.length || accountIds.includes(r.accountId))
        .reverse()
        .sort((a, b) => b.firstSeenAt - a.firstSeenAt)
        .slice(0, limit)
        .map(({ ...r }) => r)
    },
  }
}
