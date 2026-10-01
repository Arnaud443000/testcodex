import type { Decimal } from '../types/money'
import type { TradeView } from '../types/trade'
import type {
  AssetRow,
  ExecutionBlock,
  ExecutionReport,
  FeeGranularity,
  FeePeriod,
  FeePoint,
  FeeReport,
  StatsQuery,
  StrategyRow,
  Summary,
} from '../types/stats'
import { dayKey, localDay, summarize, toDec, toScaled, type MockClosed } from './mockStats'
import type { BehaviorInput } from './mockBehavior'

/**
 * MOCK des analyses d'étape 3 (lot 14) — uniquement pour `npm run dev` dans un navigateur.
 * Il suit CLAUDE.md (« Statistiques d'étape 3 ») et est testé contre le journal F du test Rust
 * `stats::analyses_tests` (résultats calculés à la main) ; il ne fait pas foi : dans l'application,
 * tout vient de pulse-core. Montants en BigInt exacts (8 décimales), jamais en flottants.
 */

const DAY = 86_400_000
const MIN_SAMPLE = 5

export type Closed = TradeView & { exitTime: number; figures: NonNullable<TradeView['figures']> }
const isClosed = (t: TradeView): t is Closed => t.figures !== null && t.exitTime != null
const byExit = (a: Closed, b: Closed) => a.exitTime - b.exitTime || a.id - b.id
const asMock = (t: Closed): MockClosed => ({
  id: t.id, symbol: t.symbol, direction: t.direction, exitTime: t.exitTime, tzOffsetMin: t.tzOffsetMin,
  netPnl: t.figures.netPnl, rMultiple: t.figures.rMultiple, outcome: t.figures.outcome,
})
const weekday = (ms: number, tz: number) => (((localDay(ms, tz) + 3) % 7) + 7) % 7 + 1
const sum = (values: Decimal[]) => values.reduce((a, v) => a + toScaled(v), 0n)

/** Trades clôturés dans la fenêtre, filtrés comme `StatsQuery`, dans l'ordre de sortie. */
function selected(input: BehaviorInput, q: StatsQuery): Closed[] {
  return input.trades
    .filter(isClosed)
    .filter((t) => (q.from == null || t.exitTime >= q.from) && (q.to == null || t.exitTime < q.to))
    .filter((t) => q.direction == null || t.direction === q.direction)
    .filter((t) => !q.instrumentIds?.length || q.instrumentIds.includes(t.instrumentId))
    .filter((t) => (q.tagIds ?? []).every((id) => t.tagIds.includes(id)))
    .sort(byExit)
}

/** Résumé d'un groupe : `summarize` du mock, avec le vrai brut et les vrais frais. */
export function summary(list: Closed[]): Summary {
  return {
    ...summarize(list.map(asMock)),
    grossPnl: toDec(sum(list.map((t) => t.figures.grossPnl))),
    fees: toDec(sum(list.map((t) => t.figures.fees))),
  }
}

/** frais / brut, seulement si le brut est positif (division entière à 15 chiffres, puis flottant). */
const feesShare = (fees: bigint, gross: bigint): number | null => (gross > 0n ? Number((fees * 10n ** 15n) / gross) / 1e15 : null)
const isLow = (s: Summary) => s.tradeCount < MIN_SAMPLE

export function mockAssets(input: BehaviorInput, q: StatsQuery): AssetRow[] {
  const groups = new Map<number, Closed[]>()
  for (const t of selected(input, q)) groups.set(t.instrumentId, [...(groups.get(t.instrumentId) ?? []), t])
  return [...groups.entries()]
    .map(([instrumentId, list]): AssetRow => {
      const s = summary(list)
      return {
        instrumentId, symbol: list[0].symbol, assetClass: list[0].assetClass, summary: s,
        feesShareOfGross: feesShare(toScaled(s.fees), toScaled(s.grossPnl)), lowSample: isLow(s),
      }
    })
    .sort((a, b) => {
      const d = toScaled(b.summary.netPnl) - toScaled(a.summary.netPnl)
      return d !== 0n ? (d > 0n ? 1 : -1) : a.symbol.toUpperCase().localeCompare(b.symbol.toUpperCase())
    })
}

function periodKey(t: Closed, by: FeeGranularity): string {
  const day = dayKey(t.exitTime, t.tzOffsetMin)
  if (by === 'day') return day
  if (by === 'month') return day.slice(0, 7)
  return dayKey(t.exitTime - (weekday(t.exitTime, t.tzOffsetMin) - 1) * DAY, t.tzOffsetMin)
}

export function mockFees(input: BehaviorInput, q: StatsQuery, by: FeeGranularity = 'month'): FeeReport {
  const list = selected(input, q)
  let fees = 0n
  let gross = 0n
  let net = 0n
  const curve: FeePoint[] = []
  const periods = new Map<string, { n: number; gross: bigint; fees: bigint; net: bigint }>()
  for (const t of list) {
    const f = t.figures
    gross += toScaled(f.grossPnl)
    fees += toScaled(f.fees)
    net += toScaled(f.netPnl)
    curve.push({ tradeId: t.id, time: t.exitTime, cumulativeFees: toDec(fees), cumulativeGrossPnl: toDec(gross), cumulativeNetPnl: toDec(net) })
    const key = periodKey(t, by)
    const p = periods.get(key) ?? { n: 0, gross: 0n, fees: 0n, net: 0n }
    p.n++
    p.gross += toScaled(f.grossPnl)
    p.fees += toScaled(f.fees)
    p.net += toScaled(f.netPnl)
    periods.set(key, p)
  }
  let running = 0n
  const rows: FeePeriod[] = [...periods.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, p]) => {
      running += p.fees
      return {
        key, tradeCount: p.n, grossPnl: toDec(p.gross), fees: toDec(p.fees), netPnl: toDec(p.net),
        feesShareOfGross: feesShare(p.fees, p.gross), cumulativeFees: toDec(running),
      }
    })
  return {
    tradeCount: list.length,
    tradesWithFees: list.filter((t) => toScaled(t.figures.fees) !== 0n).length,
    grossPnl: toDec(gross), fees: toDec(fees), netPnl: toDec(net),
    feesShareOfGross: feesShare(fees, gross),
    feesPerTrade: list.length ? toDec(fees / BigInt(list.length)) : null,
    curve, periods: rows,
  }
}

export function mockStrategies(input: BehaviorInput, q: StatsQuery): StrategyRow[] {
  const setupIds = new Set(input.tags.filter((g) => g.kind === 'setup').map((g) => g.id))
  const list = selected(input, q)
  const groups = new Map<number | null, Closed[]>()
  for (const t of list) {
    const tagId = t.tagIds.find((id) => setupIds.has(id)) ?? null
    groups.set(tagId, [...(groups.get(tagId) ?? []), t])
  }
  const nameOf = (id: number | null) => input.tags.find((g) => g.id === id)?.name ?? 'None'
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a === null) - Number(b === null) || nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase()))
    .map(([tagId, trades]): StrategyRow => {
      const s = summary(trades)
      let cumulative = 0n
      return {
        tagId, name: nameOf(tagId), summary: s, lowSample: isLow(s),
        shareOfTrades: list.length ? trades.length / list.length : null,
        curve: trades.map((t) => {
          cumulative += toScaled(t.figures.netPnl)
          return { tradeId: t.id, time: t.exitTime, cumulativeNetPnl: toDec(cumulative) }
        }),
      }
    })
}

export function mockExecutions(input: BehaviorInput, q: StatsQuery): ExecutionReport {
  const list = selected(input, q)
  const block = (kind: 'system' | 'discretionary' | null): ExecutionBlock => {
    const s = summary(list.filter((t) => (t.executionType ?? null) === kind))
    return { summary: s, lowSample: isLow(s) }
  }
  const system = block('system')
  const discretionary = block('discretionary')
  const comparable = !system.lowSample && !discretionary.lowSample
  const diff = (a: number | null, b: number | null) => (comparable && a !== null && b !== null ? a - b : null)
  const [sa, da] = [system.summary.avgNetPnl, discretionary.summary.avgNetPnl]
  return {
    system, discretionary, unclassified: block(null), minSample: MIN_SAMPLE, comparable,
    winRateDelta: diff(system.summary.winRate, discretionary.summary.winRate),
    expectancyRDelta: diff(system.summary.expectancyR, discretionary.summary.expectancyR),
    avgNetPnlDelta: comparable && sa !== null && da !== null ? toDec(toScaled(sa) - toScaled(da)) : null,
  }
}
