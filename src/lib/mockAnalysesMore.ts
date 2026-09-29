import type { Decimal } from '../types/money'
import type { TradeView } from '../types/trade'
import type { Comparison, DurationGroup, DurationReport, OpportunityReport, ScalingHalf, ScalingPoint, ScalingReport, OpportunityTrade, StatsQuery, YearComparison, YearComparisonQuery } from '../types/stats'
import { summary as summaryOf } from './mockAnalyses'
import { localDay, ratio, toDec, toScaled } from './mockStats'
import { mockRisk, type BehaviorInput } from './mockBehavior'

/**
 * MOCK des analyses complémentaires (lot 16) — uniquement pour `npm run dev` dans un navigateur.
 * Il suit CLAUDE.md (« Analyses complémentaires (lot 16) ») et est testé contre les journaux K à N du test Rust
 * `stats::analyses_tests` (résultats calculés à la main) ; il ne fait pas foi : dans l'application, tout vient de
 * pulse-core. Montants en BigInt exacts (8 décimales), jamais en flottants.
 */

const ONE = 10n ** 8n
const MIN_SAMPLE = 5

type Closed = TradeView & { exitTime: number; figures: NonNullable<TradeView['figures']> }
const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null
const byExit = (a: Closed, b: Closed) => a.exitTime - b.exitTime || a.id - b.id
/** Produit de deux montants à 8 décimales. */
const mulS = (a: bigint, b: bigint) => (a * b) / ONE
const signed = (t: { direction: string }) => (t.direction === 'long' ? 1n : -1n)

/** Trades clôturés dans la fenêtre, filtrés comme `StatsQuery`, dans l'ordre de sortie. */
export function selectedClosed(input: BehaviorInput, q: StatsQuery): Closed[] {
  return input.trades
    .filter(isClosed)
    .filter((t) => (q.from == null || t.exitTime >= q.from) && (q.to == null || t.exitTime < q.to))
    .filter((t) => q.direction == null || t.direction === q.direction)
    .filter((t) => !q.instrumentIds?.length || q.instrumentIds.includes(t.instrumentId))
    .filter((t) => (q.tagIds ?? []).every((id) => t.tagIds.includes(id)))
    .sort(byExit)
}

// --- coût d'opportunité (3.3.18) -------------------------------------------------------

export function mockOpportunity(input: BehaviorInput, q: StatsQuery): OpportunityReport {
  const list = selectedClosed(input, q)
  let withoutTarget = 0
  let withoutAfter = 0
  let leftTotal = 0n
  let avoidedTotal = 0n
  let netTotal = 0n
  let leftCount = 0
  let avoidedCount = 0
  const trades: OpportunityTrade[] = []
  for (const t of list) {
    const entry = toScaled(t.entryPrice)
    const sign = signed(t)
    const tp = t.plannedTp != null && (toScaled(t.plannedTp) - entry) * sign > 0n ? toScaled(t.plannedTp) : null
    const after = t.priceAfterExit != null ? toScaled(t.priceAfterExit) : null
    if (tp === null) withoutTarget++
    if (after === null) withoutAfter++
    if (tp === null || after === null || t.exitPrice == null) continue
    const exit = toScaled(t.exitPrice)
    const size = toScaled(t.size)
    const mult = toScaled(t.multiplier ?? '1')
    const cost = (to: bigint) => mulS(mulS((to - exit) * sign, size), mult)
    const moved = cost(after)
    const capped = sign > 0n ? (after < tp ? after : tp) : after > tp ? after : tp
    const left = cost(capped) > 0n ? cost(capped) : 0n
    leftTotal += left
    netTotal += toScaled(t.figures.netPnl)
    if (left > 0n) leftCount++
    if (moved < 0n) {
      avoidedCount++
      avoidedTotal -= moved
    }
    trades.push({
      tradeId: t.id, symbol: t.symbol, direction: t.direction, exitPrice: t.exitPrice, plannedTp: toDec(tp), priceAfterExit: toDec(after),
      moveAfterExit: toDec(moved), leftOnTable: toDec(left), netPnl: t.figures.netPnl,
    })
  }
  trades.sort((a, b) => {
    const d = toScaled(b.leftOnTable) - toScaled(a.leftOnTable)
    return d !== 0n ? (d > 0n ? 1 : -1) : a.tradeId - b.tradeId
  })
  const dec = (n: bigint): Decimal => toDec(n)
  return {
    tradeCount: list.length,
    eligibleCount: trades.length,
    excludedCount: list.length - trades.length,
    withoutTargetCount: withoutTarget,
    withoutPriceAfterCount: withoutAfter,
    minSample: MIN_SAMPLE,
    lowSample: trades.length < MIN_SAMPLE,
    totalLeftOnTable: dec(leftTotal),
    leftCount,
    leftPerEarlyExit: leftCount === 0 ? null : dec(leftTotal / BigInt(leftCount)),
    avoidedCount,
    totalAvoided: dec(avoidedTotal),
    netPnlOfEligible: dec(netTotal),
    trades,
  }
}

// --- même période un an plus tôt (3.3.19) ------------------------------------------------

const DAY = 86_400_000
const PERIOD_DAYS = { day: 1, week: 7, month: 30, quarter: 90, year: 365, all: null } as const

/** Jour local (jours depuis 1970) un an plus tôt : le 29 février devient le 28 février. */
function dayMinusOneYear(day: number): number {
  const d = new Date(day * DAY)
  const y = d.getUTCFullYear() - 1
  const m = d.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / DAY
}

export function mockYearComparison(input: BehaviorInput, q: YearComparisonQuery): YearComparison {
  const closed = input.trades.filter(isClosed).sort(byExit)
  const inWindow = (from: number | null, to: number | null) => closed.filter((t) => (from === null || t.exitTime >= from) && (to === null || t.exitTime < to))
  const n = PERIOD_DAYS[q.period]
  const base = { minSample: MIN_SAMPLE }
  if (n === null) {
    const current = summaryOf(closed)
    return {
      ...base, available: false, from: null, to: null, previousFrom: null, previousTo: null, current, currentEmpty: current.tradeCount === 0,
      currentLowSample: current.tradeCount < MIN_SAMPLE, previous: null, previousEmpty: false, previousLowSample: false, previousReason: null, comparison: null,
    }
  }
  const midnight = (day: number) => day * DAY - q.tzOffsetMin * 60_000
  const today = localDay(q.nowMs, q.tzOffsetMin)
  const [first, last] = [today + 1 - n, today]
  const [from, to] = [midnight(first), midnight(last + 1)]
  const [previousFrom, previousTo] = [midnight(dayMinusOneYear(first)), midnight(dayMinusOneYear(last) + 1)]
  const current = summaryOf(inWindow(from, to))
  const previous = summaryOf(inWindow(previousFrom, previousTo))
  const previousEmpty = previous.tradeCount === 0
  const firstEntry = input.trades.length ? Math.min(...input.trades.map((t) => t.entryTime)) : null
  const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null)
  const delta = toScaled(current.netPnl) - toScaled(previous.netPnl)
  const comparison: Comparison | null = previousEmpty
    ? null
    : {
        tradeCount: current.tradeCount - previous.tradeCount,
        netPnl: toDec(delta),
        netPnlPct: ratio(delta, toScaled(previous.netPnl) < 0n ? -toScaled(previous.netPnl) : toScaled(previous.netPnl)),
        winRate: diff(current.winRate, previous.winRate),
        profitFactor: diff(current.profitFactor, previous.profitFactor),
        avgWinLossRatio: diff(current.avgWinLossRatio, previous.avgWinLossRatio),
        expectancyR: diff(current.expectancyR, previous.expectancyR),
        maxDrawdown: toDec(toScaled(current.maxDrawdown) - toScaled(previous.maxDrawdown)),
      }
  return {
    ...base, available: true, from, to, previousFrom, previousTo, current, currentEmpty: current.tradeCount === 0,
    currentLowSample: current.tradeCount < MIN_SAMPLE, previous, previousEmpty, previousLowSample: previous.tradeCount < MIN_SAMPLE,
    previousReason: previousEmpty ? (firstEntry !== null && firstEntry >= previousTo ? 'historyTooShort' : 'noTrades') : null, comparison,
  }
}

// --- temps en position (3.3.20) ----------------------------------------------------------

function durationGroup(ms: number[]): DurationGroup {
  const sorted = [...ms].sort((a, b) => a - b)
  const n = sorted.length
  return {
    tradeCount: n,
    avgMs: n ? sorted.reduce((a, v) => a + v, 0) / n : null,
    medianMs: n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null,
    lowSample: n < MIN_SAMPLE,
  }
}

export function mockDurations(input: BehaviorInput, q: StatsQuery): DurationReport {
  const list = selectedClosed(input, q)
  const win: number[] = []
  const loss: number[] = []
  const flat: number[] = []
  let invalid = 0
  for (const t of list) {
    const held = t.exitTime - t.entryTime
    if (held < 0) {
      invalid++
      continue
    }
    ;(t.figures.outcome === 'win' ? win : t.figures.outcome === 'loss' ? loss : flat).push(held)
  }
  const open = input.trades.filter((t) => t.exitTime == null && (q.direction == null || t.direction === q.direction) &&
    (!q.instrumentIds?.length || q.instrumentIds.includes(t.instrumentId)) && (q.tagIds ?? []).every((id) => t.tagIds.includes(id))).length
  const winners = durationGroup(win)
  const losers = durationGroup(loss)
  const comparable = !winners.lowSample && !losers.lowSample
  const quotient = (a: number | null, b: number | null) => (comparable && a !== null && b !== null && b > 0 ? a / b : null)
  return {
    tradeCount: list.length, measuredCount: list.length - invalid, openTradeCount: open, invalidCount: invalid, minSample: MIN_SAMPLE,
    winners, losers, breakevens: durationGroup(flat), comparable,
    avgRatio: quotient(winners.avgMs, losers.avgMs), medianRatio: quotient(winners.medianMs, losers.medianMs),
  }
}

// --- scaling du capital (3.3.21) ---------------------------------------------------------

const SCALING_MIN_PER_HALF = MIN_SAMPLE
const SCALING_CAPITAL_MOVE = 0.1
const SCALING_VERDICT_BAND = 0.2
const EPSILON = 1e-9

function scalingHalf(points: ScalingPoint[]): ScalingHalf {
  const n = BigInt(points.length)
  return {
    tradeCount: points.length,
    avgBalance: toDec(points.reduce((a, p) => a + toScaled(p.balanceAtEntry), 0n) / n),
    avgRisk: toDec(points.reduce((a, p) => a + toScaled(p.initialRisk), 0n) / n),
    avgRiskPct: points.reduce((a, p) => a + p.riskPct, 0) / points.length,
    from: points[0].exitTime,
    to: points[points.length - 1].exitTime,
  }
}

export function mockScaling(input: BehaviorInput, q: StatsQuery): ScalingReport {
  const risk = mockRisk(input, q)
  const points: ScalingPoint[] = risk.trades.flatMap((t) =>
    t.initialRisk === null || t.riskPct === null
      ? []
      : [{ tradeId: t.tradeId, exitTime: t.exitTime, balanceAtEntry: t.balanceAtEntry, initialRisk: t.initialRisk, riskPct: t.riskPct }],
  )
  const half = Math.floor(points.length / 2)
  const report: ScalingReport = {
    tradeCount: risk.tradeCount, usableCount: points.length, excludedCount: risk.tradeCount - points.length, withoutStopCount: risk.withoutStopCount,
    minPerHalf: SCALING_MIN_PER_HALF, capitalMoveThreshold: SCALING_CAPITAL_MOVE, verdictBand: SCALING_VERDICT_BAND, currentCapital: risk.currentCapital,
    points, older: null, recent: null, capitalChange: null, riskChange: null, riskPctChange: null, capitalMoved: false, verdict: 'notEnoughData',
  }
  if (half >= SCALING_MIN_PER_HALF) {
    const older = scalingHalf(points.slice(0, half))
    const recent = scalingHalf(points.slice(points.length - half))
    const change = (a: Decimal, b: Decimal) => ratio(toScaled(b) - toScaled(a), toScaled(a))
    report.older = older
    report.recent = recent
    report.capitalChange = change(older.avgBalance, recent.avgBalance)
    report.riskChange = change(older.avgRisk, recent.avgRisk)
    report.riskPctChange = older.avgRiskPct > 0 ? recent.avgRiskPct / older.avgRiskPct - 1 : null
    report.capitalMoved = report.capitalChange !== null && Math.abs(report.capitalChange) >= SCALING_CAPITAL_MOVE - EPSILON
    const c = report.riskPctChange
    report.verdict = c === null ? 'notEnoughData' : c >= SCALING_VERDICT_BAND - EPSILON ? 'oversized' : c <= -SCALING_VERDICT_BAND + EPSILON ? 'undersized' : 'stable'
  }
  return report
}
