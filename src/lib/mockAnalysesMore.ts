import type { Decimal } from '../types/money'
import type { TradeView } from '../types/trade'
import type { OpportunityReport, OpportunityTrade, StatsQuery } from '../types/stats'
import { toDec, toScaled } from './mockStats'
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
