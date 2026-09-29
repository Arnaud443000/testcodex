import type { Decimal } from '../types/money'
import type { TradeView } from '../types/trade'
import type { Comparison, OpportunityReport, OpportunityTrade, StatsQuery, YearComparison, YearComparisonQuery } from '../types/stats'
import { summary as summaryOf } from './mockAnalyses'
import { localDay, ratio, toDec, toScaled } from './mockStats'
import type { BehaviorInput } from './mockBehavior'

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
