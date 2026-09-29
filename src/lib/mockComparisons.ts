import type { Account } from '../types/account'
import type { Decimal } from '../types/money'
import type { AssetClass, TradeView } from '../types/trade'
import type {
  AccountComparison,
  AccountHint,
  AccountRow,
  ComplianceTrend,
  ExposureReport,
  ExposureRow,
  RiskBenchmark,
  RiskMonth,
  RiskViolation,
  StatsQuery,
  Summary,
} from '../types/stats'
import { mockRisk, type BehaviorInput } from './mockBehavior'
import { dayKey, summarize, toDec, toScaled, type MockClosed } from './mockStats'

/**
 * MOCK des analyses du lot 17 — uniquement pour `npm run dev` dans un navigateur.
 * Il suit CLAUDE.md (« Comparaisons et exposition (lot 17) ») et est testé contre les journaux C, R et E
 * du test Rust `stats::comparisons_tests` (résultats calculés à la main) ; il ne fait pas foi : dans
 * l'application, tout vient de pulse-core. Montants en BigInt exacts (8 décimales), jamais en flottants.
 */

const MIN_SAMPLE = 5
const FEES_GAP = 0.1
const R_GAP = 0.25
const MIN_TREND = 4
const TREND_GAP = 0.1
const EPS = 1e-12
const SCALE = 10n ** 8n

type Closed = TradeView & { exitTime: number; figures: NonNullable<TradeView['figures']> }
const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null
const byExit = (a: Closed, b: Closed) => a.exitTime - b.exitTime || a.id - b.id
const asMock = (t: Closed): MockClosed => ({
  id: t.id, symbol: t.symbol, direction: t.direction, exitTime: t.exitTime, tzOffsetMin: t.tzOffsetMin,
  netPnl: t.figures.netPnl, rMultiple: t.figures.rMultiple, outcome: t.figures.outcome,
})
const sum = (values: Decimal[]) => values.reduce((a, v) => a + toScaled(v), 0n)
/** a / b sur 15 chiffres (division entière), puis flottant ; null si b = 0. */
const frac = (a: bigint, b: bigint): number | null => (b === 0n ? null : Number((a * 10n ** 15n) / b) / 1e15)

function selected(input: BehaviorInput, q: StatsQuery): Closed[] {
  return input.trades
    .filter(isClosed)
    .filter((t) => (q.from == null || t.exitTime >= q.from) && (q.to == null || t.exitTime < q.to))
    .filter((t) => q.direction == null || t.direction === q.direction)
    .filter((t) => !q.instrumentIds?.length || q.instrumentIds.includes(t.instrumentId))
    .filter((t) => (q.tagIds ?? []).every((id) => t.tagIds.includes(id)))
    .sort(byExit)
}

function summary(list: Closed[]): Summary {
  return {
    ...summarize(list.map(asMock)),
    grossPnl: toDec(sum(list.map((t) => t.figures.grossPnl))),
    fees: toDec(sum(list.map((t) => t.figures.fees))),
  }
}

// --- comparaison de comptes (3.7.6) ------------------------------------------------

export interface AccountInput {
  account: Account
  input: BehaviorInput
}

export function mockCompareAccounts(list: AccountInput[], q: StatsQuery): AccountComparison {
  const sorted = [...list].sort((a, b) => a.account.name.toLowerCase().localeCompare(b.account.name.toLowerCase()) || a.account.id - b.account.id)
  const rows: AccountRow[] = []
  const instruments: Set<number>[] = []
  for (const { account, input } of sorted) {
    const trades = selected(input, q)
    const s = summary(trades)
    instruments.push(new Set(trades.map((t) => t.instrumentId)))
    rows.push({
      accountId: account.id, name: account.name, broker: account.broker, currency: account.currency, summary: s,
      feesPerTrade: s.tradeCount === 0 ? null : toDec(toScaled(s.fees) / BigInt(s.tradeCount)),
      feesShareOfGross: toScaled(s.grossPnl) > 0n ? frac(toScaled(s.fees), toScaled(s.grossPnl)) : null,
      lowSample: s.tradeCount < MIN_SAMPLE,
    })
  }
  const hints: AccountHint[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [a, b] = [rows[i], rows[j]]
      const shared = [...instruments[i]].filter((id) => instruments[j].has(id)).length
      if (a.lowSample || b.lowSample || shared === 0) continue
      const [fa, fb] = [a.feesShareOfGross, b.feesShareOfGross]
      if (fa !== null && fb !== null && Math.abs(fa - fb) >= FEES_GAP - EPS) {
        const [hi, lo] = fa > fb ? [a, b] : [b, a]
        hints.push({ kind: 'fees', accountId: hi.accountId, otherAccountId: lo.accountId, gap: Math.abs(fa - fb), sharedInstruments: shared })
      }
      const [ra, rb] = [a.summary.expectancyR, b.summary.expectancyR]
      if (a.summary.rTradeCount >= MIN_SAMPLE && b.summary.rTradeCount >= MIN_SAMPLE && ra !== null && rb !== null && Math.abs(ra - rb) >= R_GAP - EPS) {
        const [lo, hi] = ra < rb ? [a, b] : [b, a]
        hints.push({ kind: 'execution', accountId: lo.accountId, otherAccountId: hi.accountId, gap: Math.abs(ra - rb), sharedInstruments: shared })
      }
    }
  }
  const order = { fees: 0, execution: 1 }
  hints.sort((x, y) => order[x.kind] - order[y.kind] || x.accountId - y.accountId || x.otherAccountId - y.otherAccountId)
  const currencies = [...new Set(rows.map((r) => r.currency))].sort()
  return { rows, currencies, mixedCurrencies: currencies.length > 1, minSample: MIN_SAMPLE, feesGapThreshold: FEES_GAP, rGapThreshold: R_GAP, hints }
}

// --- benchmark du risque max (3.4.11) ----------------------------------------------

const rate = (ok: number, n: number) => (n > 0 ? ok / n : null)

export function mockRiskBenchmark(input: BehaviorInput, q: StatsQuery): RiskBenchmark {
  const trades = selected(input, q)
  const report = mockRisk(input, q)
  const limit = input.settings.maxRiskPercent
  const limitFraction = limit === null ? null : Number(limit) / 100
  const points: RiskBenchmark['points'] = []
  const violations: RiskViolation[] = []
  const months = new Map<string, [number, number]>()
  trades.forEach((t, i) => {
    const r = report.trades[i]
    if (r.withinLimit === null) return
    // Fraction à 15 chiffres, plus fine que le riskPct à 8 chiffres du rapport du lot 8.
    const riskPct = frac(toScaled(r.initialRisk!), toScaled(r.balanceAtEntry))
    points.push({ ...r, riskPct })
    const key = dayKey(t.exitTime, t.tzOffsetMin).slice(0, 7)
    const m = months.get(key) ?? [0, 0]
    m[0]++
    months.set(key, m)
    if (r.withinLimit || riskPct === null || limit === null || limitFraction === null) return
    m[1]++
    violations.push({
      tradeId: t.id, accountId: t.accountId, symbol: t.symbol, direction: t.direction, exitTime: t.exitTime,
      initialRisk: r.initialRisk!, balanceAtEntry: r.balanceAtEntry, riskPct,
      limitAmount: toDec((toScaled(limit) * toScaled(r.balanceAtEntry)) / (100n * SCALE)),
      excessPct: riskPct - limitFraction, overFactor: riskPct / limitFraction,
    })
  })
  violations.reverse()
  const evaluated = points.length
  const half = Math.floor(evaluated / 2)
  const ok = (s: typeof points) => s.filter((p) => p.withinLimit === true).length
  const [olderRate, recentRate] =
    evaluated >= MIN_TREND ? [rate(ok(points.slice(0, half)), half), rate(ok(points.slice(evaluated - half)), half)] : [null, null]
  let trend: ComplianceTrend = 'notEnoughData'
  if (olderRate !== null && recentRate !== null) {
    trend = recentRate - olderRate >= TREND_GAP - EPS ? 'improving' : olderRate - recentRate >= TREND_GAP - EPS ? 'worsening' : 'stable'
  }
  const over = violations.length
  return {
    limitPercent: limit, tradeCount: report.tradeCount, evaluatedCount: evaluated, withoutStopCount: report.withoutStopCount,
    respectedCount: evaluated - over, overCount: over, complianceRate: rate(evaluated - over, evaluated),
    avgRiskPct: report.avgRiskPct, maxRiskPct: report.maxRiskPct, trend, olderRate, recentRate, minTrendTrades: MIN_TREND,
    months: [...months.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, [n, o]]): RiskMonth => ({ key, evaluatedCount: n, overCount: o, complianceRate: rate(n - o, n) })),
    points, violations,
  }
}

// --- exposition par catégorie d'actif (3.7.9) --------------------------------------

export function mockExposure(input: BehaviorInput, q: StatsQuery): ExposureReport {
  const trades = selected(input, q)
  const report = mockRisk(input, q)
  const classes = new Map<AssetClass, { n: number; withRisk: number; noStop: number; amount: bigint; pct: number; pctN: number }>()
  let total = 0n
  let totalPct = 0
  let totalPctN = 0
  trades.forEach((t, i) => {
    const r = report.trades[i]
    const a = classes.get(t.assetClass) ?? { n: 0, withRisk: 0, noStop: 0, amount: 0n, pct: 0, pctN: 0 }
    a.n++
    if (r.initialRisk !== null) {
      a.withRisk++
      a.amount += toScaled(r.initialRisk)
      total += toScaled(r.initialRisk)
    } else a.noStop++
    const pct = r.initialRisk !== null && toScaled(r.balanceAtEntry) > 0n ? frac(toScaled(r.initialRisk), toScaled(r.balanceAtEntry)) : null
    if (pct !== null) {
      a.pct += pct
      a.pctN++
      totalPct += pct
      totalPctN++
    }
    classes.set(t.assetClass, a)
  })
  const rows = [...classes.entries()]
    .map(([assetClass, a]): ExposureRow => ({
      assetClass, tradeCount: a.n, riskTradeCount: a.withRisk, withoutStopCount: a.noStop, riskAmount: toDec(a.amount),
      shareOfRisk: a.withRisk > 0 ? frac(a.amount, total) : null,
      riskPctOfCapital: a.pctN > 0 ? a.pct : null, avgRiskPct: a.pctN > 0 ? a.pct / a.pctN : null,
    }))
    .sort((a, b) => {
      const d = toScaled(b.riskAmount) - toScaled(a.riskAmount)
      return d !== 0n ? (d > 0n ? 1 : -1) : a.assetClass.localeCompare(b.assetClass)
    })
  return {
    currency: input.accounts[0]?.currency ?? null, tradeCount: trades.length, withoutStopCount: report.withoutStopCount,
    totalRisk: toDec(total), totalRiskPct: totalPctN > 0 ? totalPct : null, rows,
  }
}
