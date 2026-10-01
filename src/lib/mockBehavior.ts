import type { Account, CashFlow } from '../types/account'
import type { Decimal } from '../types/money'
import type { EmotionMoment, Rule, Tag, TradeView } from '../types/trade'
import type {
  BehaviorSettings,
  Component,
  ComponentKey,
  DisciplineReport,
  EmotionReport,
  FirstTradeReport,
  Hesitation,
  Mistake,
  MistakeReport,
  OvertradingDay,
  PatternReport,
  PlanReport,
  Quadrant,
  RankGroup,
  Revenge,
  RevengeTrade,
  RuleAdherenceReport,
  Streak,
  StreakReport,
  TradeDiscipline,
} from '../types/behavior'
import type { Heatmap, HeatCell, LongShort, RBin, RDistribution, RiskReport, Segment, StatsQuery } from '../types/stats'
import { dayKey, localDay, ratio, summarize, toDec, toScaled, type MockClosed } from './mockStats'

/**
 * MOCK de l'analyse comportementale — uniquement pour `npm run dev` dans un navigateur.
 * Il suit les règles de CLAUDE.md (« Analyse comportementale ») sur les données du faux
 * backend pour que l'interface ait des chiffres plausibles, mais il ne fait pas foi :
 * dans l'application, tout vient de pulse-core. Montants en BigInt exacts (8 décimales).
 */

const DAY = 86_400_000
const ONE = toScaled('1')
const MIN_SCORED_TRADES = 5
const WELL_EXECUTED = 70
const WEIGHTS: [ComponentKey, number][] = [['plan', 30], ['rules', 25], ['checklist', 15], ['stopLoss', 10], ['risk', 10], ['behavior', 10]]

export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettings = { maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' }

/** Données des comptes choisis. */
export interface BehaviorInput {
  accounts: Account[]
  cashFlows: CashFlow[]
  /** Tous les trades des comptes choisis, ouverts compris, avec leurs chiffres. */
  trades: TradeView[]
  tags: Tag[]
  rules: Rule[]
  settings: BehaviorSettings
  /** Trades manqués des comptes choisis (jamais de P&L). */
  missed?: { accountId: number; occurredAt: number; tagIds: number[] }[]
}

type Closed = TradeView & { exitTime: number; figures: NonNullable<TradeView['figures']> }

const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null
const byExit = (a: Closed, b: Closed) => a.exitTime - b.exitTime || a.id - b.id
const asMock = (t: Closed): MockClosed => ({
  id: t.id, symbol: t.symbol, direction: t.direction, exitTime: t.exitTime, tzOffsetMin: t.tzOffsetMin,
  netPnl: t.figures.netPnl, rMultiple: t.figures.rMultiple, outcome: t.figures.outcome,
})
const sum = (values: Decimal[]) => toDec(values.reduce((a, v) => a + toScaled(v), 0n))
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const weekday = (ms: number, tz: number) => (((localDay(ms, tz) + 3) % 7) + 7) % 7 + 1
const hour = (ms: number, tz: number) => Math.floor(((((ms + tz * 60_000) % DAY) + DAY) % DAY) / 3_600_000)

function selected(input: BehaviorInput, q: StatsQuery): Closed[] {
  return input.trades
    .filter(isClosed)
    .filter((t) => (q.from == null || t.exitTime >= q.from) && (q.to == null || t.exitTime < q.to))
    .filter((t) => q.direction == null || t.direction === q.direction)
    .filter((t) => !q.instrumentIds?.length || q.instrumentIds.includes(t.instrumentId))
    .filter((t) => (q.tagIds ?? []).every((id) => t.tagIds.includes(id)))
    .sort(byExit)
}

const segment = (key: string, label: string, list: Closed[]): Segment => ({ key, label, summary: summarize(list.map(asMock)) })

/** Groupes triés par clé de tri, « none » en dernier (comme stats::segments). */
function segments(list: Closed[], keysOf: (t: Closed) => [sort: string, key: string, label: string][]): Segment[] {
  const groups = new Map<string, { key: string; label: string; sort: string; trades: Closed[] }>()
  for (const t of list) {
    const keys = keysOf(t)
    for (const [sort, key, label] of keys.length ? keys : [['', 'none', 'None'] as [string, string, string]]) {
      const g = groups.get(key) ?? { key, label, sort, trades: [] }
      g.trades.push(t)
      groups.set(key, g)
    }
  }
  return [...groups.values()]
    .sort((a, b) => Number(a.key === 'none') - Number(b.key === 'none') || a.sort.localeCompare(b.sort))
    .map((g) => segment(g.key, g.label, g.trades))
}

// --- historique par compte ------------------------------------------------------

function context(input: BehaviorInput) {
  const s = input.settings
  const closed = input.trades.filter(isClosed).sort(byExit)
  const ranks = new Map<number, number>()
  const order = [...input.trades].sort(
    (a, b) => a.accountId - b.accountId || localDay(a.entryTime, a.tzOffsetMin) - localDay(b.entryTime, b.tzOffsetMin) || a.entryTime - b.entryTime || a.id - b.id,
  )
  order.forEach((t, i) => {
    const prev = order[i - 1]
    const same = prev && prev.accountId === t.accountId && localDay(prev.entryTime, prev.tzOffsetMin) === localDay(t.entryTime, t.tzOffsetMin)
    ranks.set(t.id, same ? ranks.get(prev.id)! + 1 : 1)
  })
  const balanceAtEntry = (t: TradeView): bigint => {
    const account = input.accounts.find((a) => a.id === t.accountId)
    let b = account ? toScaled(account.initialCapital) : 0n
    for (const f of input.cashFlows) {
      if (f.accountId === t.accountId && f.occurredAt <= t.entryTime) b += (f.kind === 'deposit' ? 1n : -1n) * toScaled(f.amount)
    }
    for (const c of closed) if (c.accountId === t.accountId && c.id !== t.id && c.exitTime <= t.entryTime) b += toScaled(c.figures.netPnl)
    return b
  }
  const revenge = (t: TradeView): Revenge | null => {
    const p = closed.filter((c) => c.accountId === t.accountId && c.exitTime <= t.entryTime && c.id !== t.id).pop()
    if (!p || p.figures.outcome !== 'loss' || t.entryTime - p.exitTime > s.revengeWindowMin * 60_000) return null
    let basis: Revenge['basis']
    let mine: bigint
    let theirs: bigint
    if (t.initialRisk !== null && p.figures.initialRisk !== null) {
      ;[basis, mine, theirs] = ['risk', toScaled(t.initialRisk), toScaled(p.figures.initialRisk)]
    } else if (t.instrumentId === p.instrumentId) {
      ;[basis, mine, theirs] = ['size', toScaled(t.size) * toScaled(t.multiplier ?? '1'), toScaled(p.size) * toScaled(p.multiplier ?? '1')]
    } else return null
    if (mine * ONE < toScaled(s.revengeSizeFactor) * theirs) return null
    return { previousTradeId: p.id, gapMs: t.entryTime - p.exitTime, basis, ratio: ratio(mine, theirs) }
  }
  return { ranks, balanceAtEntry, revenge, closed }
}

type Ctx = ReturnType<typeof context>

function disciplineOf(ctx: Ctx, s: BehaviorSettings, t: TradeView): TradeDiscipline {
  const checks = t.ruleChecks
  const respected = checks.filter((c) => c.respected).length
  const ticked = t.checklist.filter((c) => c.checked).length
  const balance = ctx.balanceAtEntry(t)
  const risk = t.initialRisk !== null ? toScaled(t.initialRisk) : null
  const within =
    risk === null || s.maxRiskPercent === null || balance <= 0n ? null : risk * 100n * ONE <= toScaled(s.maxRiskPercent) * balance
  const revenge = ctx.revenge(t)
  const rank = ctx.ranks.get(t.id) ?? 1
  const overtrading = s.maxTradesPerDay !== null && rank > s.maxTradesPerDay
  const value: Record<ComponentKey, number | null> = {
    plan: t.planFollowed == null ? null : { yes: 1, partial: 0.5, no: 0 }[t.planFollowed],
    rules: checks.length ? respected / checks.length : null,
    checklist: t.checklist.length ? ticked / t.checklist.length : null,
    stopLoss: risk !== null ? 1 : 0,
    risk: within === null ? null : within ? 1 : 0,
    behavior: revenge || overtrading ? 0 : 1,
  }
  const components: Component[] = WEIGHTS.map(([key, weight]) => ({ key, weight, value: value[key] }))
  const present = components.filter((c) => c.value !== null)
  const weights = present.reduce((a, c) => a + c.weight, 0)
  const closed = isClosed(t) ? t : null
  return {
    tradeId: t.id,
    accountId: t.accountId,
    entryTime: t.entryTime,
    exitTime: closed?.exitTime ?? null,
    day: closed ? dayKey(closed.exitTime, t.tzOffsetMin) : null,
    netPnl: closed?.figures.netPnl ?? null,
    outcome: closed?.figures.outcome ?? null,
    score: weights ? (100 * present.reduce((a, c) => a + c.weight * c.value!, 0)) / weights : null,
    coverage: weights / 100,
    components,
    planFollowed: t.planFollowed ?? null,
    rulesChecked: checks.length,
    rulesRespected: respected,
    checklistTotal: t.checklist.length,
    checklistChecked: ticked,
    hasStopLoss: risk !== null,
    riskPct: risk !== null && balance > 0n ? ratio(risk, balance) : null,
    maxRiskPercent: s.maxRiskPercent,
    revenge,
    overtrading,
    dayRank: rank,
  }
}

const meanScore = (list: TradeDiscipline[]) => {
  const scores = list.flatMap((t) => (t.score === null ? [] : [t.score]))
  return { score: scores.length >= MIN_SCORED_TRADES ? mean(scores) : null, count: scores.length }
}

export function mockDiscipline(input: BehaviorInput, q: StatsQuery): DisciplineReport {
  const ctx = context(input)
  const trades = selected(input, q).map((t) => disciplineOf(ctx, input.settings, t))
  const { score, count } = meanScore(trades)
  const days = new Map<string, TradeDiscipline[]>()
  for (const t of trades) days.set(t.day!, [...(days.get(t.day!) ?? []), t])
  const cell = (pick: (t: TradeDiscipline) => boolean): Quadrant => {
    const list = trades.filter(pick)
    return { count: list.length, netPnl: sum(list.map((t) => t.netPnl ?? '0')) }
  }
  const well = (t: TradeDiscipline) => t.score !== null && t.score >= WELL_EXECUTED
  return {
    score,
    scoredTradeCount: count,
    minTradeCount: MIN_SCORED_TRADES,
    sampleTooSmall: score === null,
    components: WEIGHTS.map(([key, weight], i) => {
      const values = trades.flatMap((t) => (t.components[i].value === null ? [] : [t.components[i].value!]))
      return { key, weight, tradeCount: values.length, average: mean(values) }
    }),
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({
      day, tradeCount: list.length, score: mean(list.flatMap((t) => (t.score === null ? [] : [t.score]))),
    })),
    quadrants: {
      threshold: WELL_EXECUTED,
      wellExecutedWins: cell((t) => t.outcome === 'win' && well(t)),
      poorlyExecutedWins: cell((t) => t.outcome === 'win' && !well(t)),
      wellExecutedLosses: cell((t) => t.outcome === 'loss' && well(t)),
      poorlyExecutedLosses: cell((t) => t.outcome === 'loss' && !well(t)),
      breakevens: cell((t) => t.outcome === 'breakeven'),
    },
    trades,
    settings: input.settings,
  }
}

export function mockTradeDiscipline(input: BehaviorInput, id: number): TradeDiscipline {
  const t = input.trades.find((x) => x.id === id)
  if (!t) throw new Error(`not found: trade ${id}`)
  return disciplineOf(context(input), input.settings, t)
}

// --- analyses 3.4.x ---------------------------------------------------------------

export function mockEmotions(input: BehaviorInput, q: StatsQuery): EmotionReport {
  const list = selected(input, q)
  const by = (moment: EmotionMoment | null) =>
    segments(list, (t) => {
      const ids = [...new Set(t.emotions.filter((e) => moment === null || e.moment === moment).map((e) => e.tagId))]
      return ids.map((id) => {
        const name = input.tags.find((g) => g.id === id)?.name ?? String(id)
        return [name.toLowerCase(), String(id), name]
      })
    })
  return { any: by(null), before: by('before'), during: by('during'), after: by('after') }
}

export function mockStreaks(input: BehaviorInput, q: StatsQuery): StreakReport {
  const list = selected(input, q)
  const all: Streak[] = []
  let open: Streak | null = null
  for (const t of list) {
    const o = t.figures.outcome
    if (open && open.outcome === o) {
      open.length++
      open.netPnl = sum([open.netPnl, t.figures.netPnl])
      open.lastTradeId = t.id
      open.to = t.exitTime
    } else {
      if (open) all.push(open)
      open = o === 'breakeven' ? null : { outcome: o, length: 1, netPnl: t.figures.netPnl, firstTradeId: t.id, lastTradeId: t.id, from: t.exitTime, to: t.exitTime }
    }
  }
  const current = open ? { ...open } : null
  if (open) all.push(open)
  const longest = (o: 'win' | 'loss') => all.filter((x) => x.outcome === o).reduce<Streak | null>((best, x) => (best && best.length > x.length ? best : x), null)
  return { current, longestWin: longest('win'), longestLoss: longest('loss'), tradeCount: list.length }
}

function fixed(found: Segment[], keys: [string, string][]): Segment[] {
  return keys.map(([key, label]) => found.find((s) => s.key === key) ?? segment(key, label, []))
}

export function mockPlan(input: BehaviorInput, q: StatsQuery): PlanReport {
  const labels = { yes: 'Yes', partial: 'Partial', no: 'No' } as const
  const found = segments(selected(input, q), (t) => (t.planFollowed ? [[t.planFollowed, t.planFollowed, labels[t.planFollowed]]] : []))
  return { groups: fixed(found, [['yes', 'Yes'], ['partial', 'Partial'], ['no', 'No'], ['none', 'None']]) }
}

export function mockFirstTrade(input: BehaviorInput, q: StatsQuery): FirstTradeReport {
  const ctx = context(input)
  const list = selected(input, q)
  const group = (key: string, label: string, pick: (rank: number) => boolean): RankGroup => {
    const trades = list.filter((t) => pick(ctx.ranks.get(t.id) ?? 1))
    const { score, count } = meanScore(trades.map((t) => disciplineOf(ctx, input.settings, t)))
    return { key, label, summary: summarize(trades.map(asMock)), disciplineScore: score, scoredTradeCount: count }
  }
  return {
    first: group('first', 'First trade of the day', (r) => r === 1),
    subsequent: group('subsequent', 'Subsequent trades', (r) => r > 1),
    byRank: [group('1', '1', (r) => r === 1), group('2', '2', (r) => r === 2), group('3', '3', (r) => r === 3), group('4+', '4+', (r) => r >= 4)],
  }
}

export function mockMistakes(input: BehaviorInput, q: StatsQuery): MistakeReport {
  const list = selected(input, q)
  const found = new Map<string, Mistake & { trades: Closed[] }>()
  const add = (source: Mistake['source'], id: number, label: string, t: Closed) => {
    const k = `${source}-${id}`
    const m = found.get(k) ?? { source, id, label, tradeCount: 0, share: null, netPnl: '0', cost: '0', expectancyR: null, tradeIds: [], trades: [] }
    m.trades.push(t)
    found.set(k, m)
  }
  for (const t of list) {
    for (const id of t.tagIds) {
      const tag = input.tags.find((g) => g.id === id)
      if (tag?.kind === 'mistake') add('tag', id, tag.name, t)
    }
    for (const c of t.ruleChecks) if (!c.respected) add('rule', c.ruleId, input.rules.find((r) => r.id === c.ruleId)?.text ?? String(c.ruleId), t)
  }
  const mistakes: Mistake[] = [...found.values()].map(({ trades, ...m }) => {
    const s = summarize(trades.map(asMock))
    return { ...m, tradeCount: trades.length, share: list.length ? trades.length / list.length : null, netPnl: s.netPnl, cost: s.totalLosses, expectancyR: s.expectancyR, tradeIds: trades.map((t) => t.id) }
  })
  const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
  return {
    tradeCount: list.length,
    tradesWithMistake: list.filter((t) => t.ruleChecks.some((c) => !c.respected) || t.tagIds.some((id) => input.tags.find((g) => g.id === id)?.kind === 'mistake')).length,
    byCount: [...mistakes].sort((a, b) => b.tradeCount - a.tradeCount || cmp(toScaled(b.cost), toScaled(a.cost)) || a.label.localeCompare(b.label)),
    byCost: [...mistakes].sort((a, b) => cmp(toScaled(b.cost), toScaled(a.cost)) || b.tradeCount - a.tradeCount || a.label.localeCompare(b.label)),
  }
}

export function mockRuleAdherence(input: BehaviorInput, q: StatsQuery): RuleAdherenceReport {
  const list = selected(input, q)
  const rate = (ok: number, n: number) => (n ? ok / n : null)
  const rules = input.rules.flatMap((rule) => {
    const checks = list.flatMap((t) => t.ruleChecks.filter((c) => c.ruleId === rule.id).map((c) => ({ month: dayKey(t.exitTime, t.tzOffsetMin).slice(0, 7), ok: c.respected })))
    if (rule.archived && !checks.length) return []
    const ok = checks.filter((c) => c.ok).length
    const half = Math.floor(checks.length / 2)
    const count = (part: typeof checks) => part.filter((c) => c.ok).length
    const months = new Map<string, { checks: number; respected: number }>()
    for (const c of checks) {
      const m = months.get(c.month) ?? { checks: 0, respected: 0 }
      m.checks++
      m.respected += Number(c.ok)
      months.set(c.month, m)
    }
    return [{
      ruleId: rule.id, text: rule.text, archived: rule.archived, checks: checks.length, respected: ok, rate: rate(ok, checks.length),
      trend: checks.length >= 4 ? count(checks.slice(checks.length - half)) / half - count(checks.slice(0, half)) / half : null,
      monthly: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({ month, ...m, rate: rate(m.respected, m.checks) })),
    }]
  })
  const all = list.flatMap((t) => t.ruleChecks)
  const ok = all.filter((c) => c.respected).length
  return { checks: all.length, respected: ok, rate: rate(ok, all.length), tradesWithChecks: list.filter((t) => t.ruleChecks.length).length, rules }
}

export function mockPatterns(input: BehaviorInput, q: StatsQuery): PatternReport {
  const ctx = context(input)
  const list = selected(input, q)
  const revengeTrades: RevengeTrade[] = list.flatMap((t) => {
    const r = ctx.revenge(t)
    return r ? [{ tradeId: t.id, exitTime: t.exitTime, netPnl: t.figures.netPnl, ...r }] : []
  })
  const limit = input.settings.maxTradesPerDay
  const days = new Map<string, OvertradingDay>()
  if (limit !== null) {
    for (const t of list.filter((x) => (ctx.ranks.get(x.id) ?? 1) > limit)) {
      const day = dayKey(t.entryTime, t.tzOffsetMin)
      const k = `${day}-${t.accountId}`
      const count = input.trades.filter((x) => x.accountId === t.accountId && dayKey(x.entryTime, x.tzOffsetMin) === day).length
      const d = days.get(k) ?? { accountId: t.accountId, day, tradeCount: count, limit, tradeIds: [] }
      d.tradeIds.push(t.id)
      days.set(k, d)
    }
  }
  const hesitation = new Map<number, Hesitation>()
  const bump = (tagIds: number[], field: 'taken' | 'missed') => {
    for (const id of tagIds) {
      const tag = input.tags.find((g) => g.id === id)
      if (tag && (tag.kind === 'setup' || tag.kind === 'session')) {
        const h = hesitation.get(id) ?? { tagId: id, kind: tag.kind, name: tag.name, taken: 0, missed: 0, missedShare: null }
        h[field]++
        h.missedShare = h.missed / (h.taken + h.missed)
        hesitation.set(id, h)
      }
    }
  }
  for (const t of list) bump(t.tagIds, 'taken')
  const missed = (input.missed ?? []).filter((m) => (q.from == null || m.occurredAt >= q.from) && (q.to == null || m.occurredAt < q.to))
  for (const m of missed) bump(m.tagIds, 'missed')
  return {
    revengeTrades,
    revengeSummary: summarize(list.filter((t) => revengeTrades.some((r) => r.tradeId === t.id)).map(asMock)),
    maxTradesPerDay: limit,
    overtradingDays: [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.accountId - b.accountId),
    hesitation: [...hesitation.values()].sort((a, b) => Number(a.kind === 'session') - Number(b.kind === 'session') || a.name.localeCompare(b.name)),
    missedTradeCount: missed.length,
  }
}

// --- statistiques complémentaires --------------------------------------------------

export function mockRDistribution(input: BehaviorInput, q: StatsQuery): RDistribution {
  const list = selected(input, q)
  const bins: RBin[] = [{ from: null, to: -3, count: 0 }]
  for (let k = 0; k < 16; k++) bins.push({ from: -3 + k * 0.5, to: -2.5 + k * 0.5, count: 0 })
  bins.push({ from: 5, to: null, count: 0 })
  const rs = list.flatMap((t) => (t.figures.rMultiple === null ? [] : [t.figures.rMultiple]))
  for (const r of rs) bins[r < -3 ? 0 : r >= 5 ? 17 : 1 + Math.floor(r / 0.5) + 6].count++
  const sorted = [...rs].sort((a, b) => a - b)
  const n = sorted.length
  return {
    binWidth: 0.5,
    bins,
    rTradeCount: n,
    noRCount: list.length - n,
    meanR: mean(rs),
    medianR: n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null,
  }
}

export function mockHeatmap(input: BehaviorInput, q: StatsQuery): Heatmap {
  const cells = new Map<string, HeatCell & { total: bigint }>()
  for (const t of selected(input, q)) {
    const [w, h] = [weekday(t.entryTime, t.tzOffsetMin), hour(t.entryTime, t.tzOffsetMin)]
    const c = cells.get(`${w}-${h}`) ?? { weekday: w, hour: h, tradeCount: 0, winCount: 0, netPnl: '0', winRate: null, intensity: 0, total: 0n }
    c.tradeCount++
    c.winCount += Number(t.figures.outcome === 'win')
    c.total += toScaled(t.figures.netPnl)
    cells.set(`${w}-${h}`, c)
  }
  const list = [...cells.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour)
  const max = list.reduce((m, c) => (c.total < 0n ? -c.total : c.total) > m ? (c.total < 0n ? -c.total : c.total) : m, 0n)
  return {
    cells: list.map(({ total, ...c }) => ({ ...c, netPnl: toDec(total), winRate: c.winCount / c.tradeCount, intensity: ratio(total, max) ?? 0 })),
    maxAbsNetPnl: toDec(max),
  }
}

export function mockLongShort(input: BehaviorInput, q: StatsQuery): LongShort {
  const list = selected(input, q)
  const long = list.filter((t) => t.direction === 'long')
  return {
    long: summarize(long.map(asMock)),
    short: summarize(list.filter((t) => t.direction === 'short').map(asMock)),
    longShare: list.length ? long.length / list.length : null,
  }
}

export function mockRisk(input: BehaviorInput, q: StatsQuery): RiskReport {
  const ctx = context(input)
  const max = input.settings.maxRiskPercent
  const trades = selected(input, q).map((t) => {
    const balance = ctx.balanceAtEntry(t)
    const risk = t.figures.initialRisk === null ? null : toScaled(t.figures.initialRisk)
    return {
      tradeId: t.id, entryTime: t.entryTime, exitTime: t.exitTime, initialRisk: t.figures.initialRisk, balanceAtEntry: toDec(balance),
      riskPct: risk !== null && balance > 0n ? ratio(risk, balance) : null,
      withinLimit: risk === null || max === null || balance <= 0n ? null : risk * 100n * ONE <= toScaled(max) * balance,
    }
  })
  const pcts = trades.flatMap((t) => (t.riskPct === null ? [] : [t.riskPct])).sort((a, b) => a - b)
  const n = pcts.length
  let capital = input.accounts.reduce((a, acc) => a + toScaled(acc.initialCapital), 0n)
  for (const f of input.cashFlows) capital += (f.kind === 'deposit' ? 1n : -1n) * toScaled(f.amount)
  for (const c of ctx.closed) capital += toScaled(c.figures.netPnl)
  return {
    trades,
    tradeCount: trades.length,
    withoutStopCount: trades.filter((t) => t.initialRisk === null).length,
    avgRiskPct: mean(pcts),
    medianRiskPct: n ? (n % 2 ? pcts[(n - 1) / 2] : (pcts[n / 2 - 1] + pcts[n / 2]) / 2) : null,
    maxRiskPct: n ? pcts[n - 1] : null,
    maxRiskPercent: max,
    overLimitCount: max === null ? null : trades.filter((t) => t.withinLimit === false).length,
    currentCapital: toDec(capital),
    limitAmount: max === null ? null : toDec((toScaled(max) * capital) / (100n * ONE)),
  }
}

// --- Lot 8 bis : facteurs externes, après 2 pertes, taille après une perte, simulation du plan ---

import type { JournalEntry } from '../types/journal'
import type { Outcome } from '../types/trade'
import type { Summary } from '../types/stats'
import type {
  AfterLossesReport,
  Comparison,
  ExposureBasis,
  ExternalFactorReport,
  FactorKey,
  FactorSide,
  PlanSimulation,
  Scenario,
  SequenceGroup,
  SimulatedResult,
  SizeChangeCase,
  SizeChangeGroup,
  SizeChangeReport,
} from '../types/behavior'

const MIN_FACTOR_DAYS = 5
const MIN_R_TRADES = 5
const MIN_SEQUENCE_TRADES = 5
const MIN_SIZE_CASES = 5
const FACTORS: [FactorKey, (e: JournalEntry) => boolean | null][] = [
  ['poorSleep', (e) => (e.sleepQuality == null ? null : e.sleepQuality <= 2)],
  ['highFatigue', (e) => (e.fatigue == null ? null : e.fatigue >= 4)],
  ['lateHours', (e) => e.lateHours],
  ['lowMood', (e) => (e.mood == null ? null : e.mood <= 2)],
]

/** Les trades du compte de `t` clôturés au plus tard à son entrée, du plus récent au plus ancien. */
const historyOf = (ctx: Ctx, t: TradeView) =>
  ctx.closed.filter((c) => c.accountId === t.accountId && c.exitTime <= t.entryTime && c.id !== t.id).reverse()

const compare = (present: number | null, absent: number | null, enough: boolean, gap: number): Comparison => {
  const difference = present !== null && absent !== null && enough ? present - absent : null
  const verdict = difference === null ? 'notEnoughData' : difference <= -gap ? 'lower' : difference >= gap ? 'higher' : 'similar'
  return { present, absent, difference, verdict }
}
const withR = (s: Summary, min: number) => (s.rTradeCount >= min ? s.expectancyR : null)
const decGap = (a: Decimal | null, b: Decimal | null, enough: boolean) => (a !== null && b !== null && enough ? toDec(toScaled(a) - toScaled(b)) : null)

export function mockExternalFactors(input: BehaviorInput, q: StatsQuery, entries: JournalEntry[]): ExternalFactorReport {
  const ctx = context(input)
  const list = selected(input, q)
  const journal = new Map(entries.map((e) => [e.day, e]))
  const dayOf = (t: Closed) => dayKey(t.entryTime, t.tzOffsetMin)
  const days = new Set(list.map(dayOf))
  const side = (trades: Closed[]): FactorSide => {
    const { score, count } = meanScore(trades.map((t) => disciplineOf(ctx, input.settings, t)))
    return { dayCount: new Set(trades.map(dayOf)).size, summary: summarize(trades.map(asMock)), disciplineScore: score, scoredTradeCount: count, tradeIds: trades.map((t) => t.id) }
  }
  return {
    factors: FACTORS.map(([key, state]) => {
      const pick = (t: Closed) => {
        const e = journal.get(dayOf(t))
        return e ? state(e) : null
      }
      const present = side(list.filter((t) => pick(t) === true))
      const absent = side(list.filter((t) => pick(t) === false))
      const undeclared = list.filter((t) => pick(t) === null)
      const enough = present.dayCount >= MIN_FACTOR_DAYS && absent.dayCount >= MIN_FACTOR_DAYS
      return {
        key,
        present,
        absent,
        undeclaredDayCount: new Set(undeclared.map(dayOf)).size,
        undeclaredTradeCount: undeclared.length,
        discipline: compare(present.disciplineScore, absent.disciplineScore, enough, 10),
        expectancyR: compare(withR(present.summary, MIN_R_TRADES), withR(absent.summary, MIN_R_TRADES), enough, 0.25),
        avgNetPnlDifference: decGap(present.summary.avgNetPnl, absent.summary.avgNetPnl, enough),
      }
    }),
    tradeCount: list.length,
    tradingDayCount: days.size,
    journalDayCount: [...days].filter((d) => journal.has(d)).length,
    minDayCount: MIN_FACTOR_DAYS,
    minRTradeCount: MIN_R_TRADES,
  }
}

export function mockAfterLosses(input: BehaviorInput, q: StatsQuery): AfterLossesReport {
  const ctx = context(input)
  const list = selected(input, q)
  const isAfter = (t: Closed) => {
    const last = historyOf(ctx, t).slice(0, 2)
    return last.length === 2 && last.every((c) => c.figures.outcome === 'loss')
  }
  const group = (trades: Closed[]): SequenceGroup => {
    const { score, count } = meanScore(trades.map((t) => disciplineOf(ctx, input.settings, t)))
    return { summary: summarize(trades.map(asMock)), disciplineScore: score, scoredTradeCount: count, tradeIds: trades.map((t) => t.id) }
  }
  const after = group(list.filter(isAfter))
  const others = group(list.filter((t) => !isAfter(t)))
  const [a, o] = [after.summary, others.summary]
  const sampleTooSmall = a.tradeCount < MIN_SEQUENCE_TRADES || o.tradeCount < MIN_SEQUENCE_TRADES
  const gap = (x: number | null, y: number | null) => (x !== null && y !== null && !sampleTooSmall ? x - y : null)
  return {
    afterTwoLosses: after,
    others,
    minTradeCount: MIN_SEQUENCE_TRADES,
    sampleTooSmall,
    winRateDifference: gap(a.winRate, o.winRate),
    avgNetPnlDifference: decGap(a.avgNetPnl, o.avgNetPnl, !sampleTooSmall),
    expectancyRDifference: gap(withR(a, MIN_SEQUENCE_TRADES), withR(o, MIN_SEQUENCE_TRADES)),
    disciplineDifference: gap(after.disciplineScore, others.disciplineScore),
  }
}

export function mockSizeChange(input: BehaviorInput, q: StatsQuery): SizeChangeReport {
  const ctx = context(input)
  const list = selected(input, q)
  const outcomes: Outcome[] = ['loss', 'win', 'breakeven']
  const cases: SizeChangeCase[][] = [[], [], []]
  const notComparable = [0, 0, 0]
  let noPreviousCount = 0
  for (const t of list) {
    const p = historyOf(ctx, t)[0]
    if (!p) {
      noPreviousCount++
      continue
    }
    const k = outcomes.indexOf(p.figures.outcome)
    let basis: ExposureBasis
    let mine: bigint
    let theirs: bigint
    if (t.figures.initialRisk !== null && p.figures.initialRisk !== null) {
      ;[basis, mine, theirs] = ['risk', toScaled(t.figures.initialRisk), toScaled(p.figures.initialRisk)]
    } else if (t.instrumentId === p.instrumentId) {
      ;[basis, mine, theirs] = ['size', toScaled(t.size) * toScaled(t.multiplier ?? '1'), toScaled(p.size) * toScaled(p.multiplier ?? '1')]
    } else {
      notComparable[k]++
      continue
    }
    const r = ratio(mine, theirs)
    if (r === null) notComparable[k]++
    else cases[k].push({ tradeId: t.id, previousTradeId: p.id, basis, change: r - 1 })
  }
  const group = (k: number): SizeChangeGroup => {
    const changes = cases[k].map((c) => c.change)
    const sorted = [...changes].sort((x, y) => x - y)
    const n = sorted.length
    const enough = n >= MIN_SIZE_CASES
    return {
      previousOutcome: outcomes[k],
      caseCount: n,
      notComparableCount: notComparable[k],
      increasedCount: changes.filter((c) => c > 0).length,
      meanChange: enough ? mean(changes) : null,
      medianChange: enough ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null,
      cases: cases[k],
    }
  }
  const [afterLoss, afterWin, afterBreakeven] = [group(0), group(1), group(2)]
  return {
    afterLoss,
    afterWin,
    afterBreakeven,
    noPreviousCount,
    tradeCount: list.length,
    minCaseCount: MIN_SIZE_CASES,
    lossVsWin: afterLoss.meanChange !== null && afterWin.meanChange !== null ? afterLoss.meanChange - afterWin.meanChange : null,
  }
}

export function mockPlanSimulation(input: BehaviorInput, q: StatsQuery): PlanSimulation {
  const list = selected(input, q)
  const declaredTradeCount = list.filter((t) => t.planFollowed != null).length
  const result = (trades: Closed[]): SimulatedResult => {
    const s = summarize(trades.map(asMock))
    return {
      tradeCount: s.tradeCount, netPnl: s.netPnl, winRate: s.winRate, expectancyR: s.expectancyR, rTradeCount: s.rTradeCount,
      profitFactor: s.profitFactor, totalGains: s.totalGains, totalLosses: s.totalLosses, maxDrawdown: s.maxDrawdown,
    }
  }
  const actual = result(list)
  const scenario = (excluded: string[]): Scenario => {
    const out = list.filter((t) => t.planFollowed != null && excluded.includes(t.planFollowed))
    const kept = result(list.filter((t) => !out.includes(t)))
    return {
      excludedTradeCount: out.length,
      excludedNetPnl: sum(out.map((t) => t.figures.netPnl)),
      result: kept,
      difference: declaredTradeCount ? toDec(toScaled(kept.netPnl) - toScaled(actual.netPnl)) : null,
      excludedTradeIds: out.map((t) => t.id),
    }
  }
  return { declaredTradeCount, actual, withoutOffPlan: scenario(['no']), withoutOffPlanOrPartial: scenario(['no', 'partial']) }
}

// --- Lot 12 : alertes à seuils ---
/** La détection de revanche du lot 8, telle quelle, pour les alertes du faux backend (`mockAlerts.ts`). */
export function mockRevengeOf(input: BehaviorInput, t: TradeView): Revenge | null {
  return context(input).revenge(t)
}

// --- Lot 31 : trades liés à une idée ou à une analyse, comparés aux autres (miroir de `analysis::report`) ---
import type { LinkedComparison, LinkedSide } from '../types/analysis'

/** Score de discipline et expectancy R déjà calculés ci-dessus, aucune formule nouvelle ; 5 trades par côté au moins. */
export function mockLinkedComparison(input: BehaviorInput, q: StatsQuery, linked: Set<number>): LinkedComparison {
  const ctx = context(input)
  const list = selected(input, q)
  const side = (trades: Closed[]): LinkedSide => {
    const { score } = meanScore(trades.map((t) => disciplineOf(ctx, input.settings, t)))
    const summary = summarize(trades.map(asMock))
    return { tradeCount: trades.length, disciplineScore: score, expectancyR: withR(summary, MIN_R_TRADES), rTradeCount: summary.rTradeCount }
  }
  const a = side(list.filter((t) => linked.has(t.id)))
  const b = side(list.filter((t) => !linked.has(t.id)))
  const enough = a.tradeCount >= 5 && b.tradeCount >= 5
  return {
    linked: a,
    unlinked: b,
    discipline: compare(a.disciplineScore, b.disciplineScore, enough, 10),
    expectancyR: compare(a.expectancyR, b.expectancyR, enough, 0.25),
    minTradeCount: 5,
  }
}
// --- Lot 35 : pause volontaire (miroir de `pause::pause_report`) ---
import type { Pause, PauseGroup, PauseReport } from '../types/pause'

const MIN_PAUSE_SAMPLE = 5

/** Fin réelle : l'heure de fin choisie, sinon l'heure prévue. */
export const pauseEffectiveEnd = (p: Pause) => p.endedAt ?? p.plannedEndAt
/** Instant d'ENTRÉE dans [début ; fin réelle) : pile au début = pendant, pile à la fin = hors. */
export const pauseContains = (p: Pause, instant: number) => instant >= p.startedAt && instant < pauseEffectiveEnd(p)

export function mockPauseReport(input: BehaviorInput, q: StatsQuery, pauses: Pause[]): PauseReport {
  const ctx = context(input)
  const list = selected(input, q)
  const group = (trades: Closed[]): PauseGroup => {
    const { score, count } = meanScore(trades.map((t) => disciplineOf(ctx, input.settings, t)))
    return { summary: summarize(trades.map(asMock)), disciplineScore: score, scoredTradeCount: count, tradeIds: trades.map((t) => t.id) }
  }
  const isDuring = (t: Closed) => pauses.some((p) => pauseContains(p, t.entryTime))
  const during = group(list.filter(isDuring))
  const others = group(list.filter((t) => !isDuring(t)))
  const [d, o] = [during.summary, others.summary]
  const enough = d.tradeCount >= MIN_PAUSE_SAMPLE && o.tradeCount >= MIN_PAUSE_SAMPLE
  return {
    pauseCount: pauses.filter((p) => (q.from == null || p.startedAt >= q.from) && (q.to == null || p.startedAt < q.to)).length,
    tradeCount: list.length,
    during,
    others,
    shareDuring: list.length ? d.tradeCount / list.length : null,
    minTradeCount: MIN_PAUSE_SAMPLE,
    sampleTooSmall: !enough,
    avgNetPnlDifference: decGap(d.avgNetPnl, o.avgNetPnl, enough),
    expectancyR: compare(withR(d, MIN_R_TRADES), withR(o, MIN_R_TRADES), enough, 0.25),
    discipline: compare(during.disciplineScore, others.disciplineScore, enough, 10),
  }
}

/** Résumé des trades clôturés de la période (lot 36, bilan hebdomadaire) : le même `summarize` que les autres rapports. */
export function mockPeriodSummary(input: BehaviorInput, q: StatsQuery): Summary {
  return summarize(selected(input, q).map(asMock))
}
