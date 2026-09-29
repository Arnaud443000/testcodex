import type { Decimal } from '../types/money'
import type { Goal, GoalDirection, GoalMetric, GoalProgress, GoalStatus } from '../types/goals'
import type { Level, LevelKind, ReplayFilter, ReplayItem } from '../types/replay'
import type { Summary } from '../types/stats'
import type { TradeView } from '../types/trade'

/**
 * MOCK des objectifs et du replay — uniquement pour `npm run dev` dans un navigateur.
 * Il reproduit les règles de pulse-core (goals.rs, replay.rs) pour développer l'interface
 * sans Rust ; il ne fait pas foi : dans l'application, tous les chiffres viennent de pulse-core.
 */

export const directionOf = (m: GoalMetric): GoalDirection => (m === 'max_drawdown' ? 'at_most' : 'at_least')

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/** Contrôles de `goals::set` : mois valide, cible > 0, taux ≤ 100, qualité ≤ 5. */
export function checkGoal(month: string, metric: GoalMetric, target: Decimal): void {
  if (!isMonth(month)) throw new Error(`invalid input: invalid month "${month}" (expected YYYY-MM)`)
  const n = Number(target)
  if (!/^\d+(\.\d+)?$/.test(target) || !(n > 0)) throw new Error('invalid input: target must be greater than zero')
  if (metric === 'win_rate' && n > 100) throw new Error('invalid input: a win-rate target is a percentage: at most 100')
  if (metric === 'discipline_score' && n > 100) throw new Error('invalid input: a discipline-score target is between 1 and 100')
  if (metric === 'execution_quality' && n > 5) throw new Error('invalid input: an execution-quality target is between 1 and 5 stars')
}

/** Même logique de statut que `goals::progress`, à partir du résumé du mois. */
export function mockProgress(
  goals: Goal[],
  summary: Summary,
  currency: string | null,
  averageStars: number | null,
  disciplineScore: number | null,
  month: string,
  today: string,
): GoalProgress[] {
  const [y, m] = month.split('-').map(Number)
  const monthOver = today > `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`
  return goals.map((goal) => {
    const has = summary.tradeCount > 0
    let actualMoney: Decimal | null = null
    let actualRatio: number | null = null
    if (has) {
      if (goal.metric === 'net_pnl') actualMoney = summary.netPnl
      else if (goal.metric === 'max_drawdown') actualMoney = summary.maxDrawdown
      else if (goal.metric === 'win_rate') actualRatio = summary.winRate === null ? null : summary.winRate * 100
      else if (goal.metric === 'profit_factor') actualRatio = summary.profitFactor
      else if (goal.metric === 'expectancy_r') actualRatio = summary.expectancyR
      else if (goal.metric === 'discipline_score') actualRatio = disciplineScore
      else actualRatio = averageStars
    }
    const direction = directionOf(goal.metric)
    const unbounded = goal.metric === 'profit_factor' && has && summary.profitFactor === null && Number(summary.totalGains) > 0
    const target = Number(goal.target)
    const raw = actualMoney !== null ? Number(actualMoney) / target : actualRatio !== null ? actualRatio / target : unbounded ? 1 : null
    const fraction = raw === null ? null : Math.max(0, raw)
    let status: GoalStatus
    if (fraction === null) status = 'no_data'
    else if (direction === 'at_least') status = fraction >= 1 ? 'reached' : monthOver ? 'missed' : 'in_progress'
    else status = fraction > 1 ? 'exceeded' : monthOver ? 'reached' : 'in_progress'
    return { goal, direction, tradeCount: summary.tradeCount, currency, actualMoney, actualRatio, fraction, status }
  })
}

export function replayItem(v: TradeView): ReplayItem {
  return {
    tradeId: v.id,
    symbol: v.symbol,
    direction: v.direction,
    currency: v.currency,
    entryTime: v.entryTime,
    exitTime: v.exitTime ?? null,
    netPnl: v.figures?.netPnl ?? null,
    rMultiple: v.figures?.rMultiple ?? null,
    outcome: v.figures?.outcome ?? null,
    rating: v.rating ?? null,
    hasScreenshot: !!v.screenshotPath,
    hasThesis: v.thesis.trim() !== '',
    hasPostMortem: v.postMortem.trim() !== '',
  }
}

export function replayPasses(v: TradeView, f: ReplayFilter): boolean {
  const rating = v.rating ?? null
  const outcomeOk =
    !f.outcome || (f.outcome === 'open' ? v.figures === null : v.figures !== null && v.figures.outcome === f.outcome)
  return (
    outcomeOk &&
    (f.minRating == null || (rating !== null && rating >= f.minRating)) &&
    (f.maxRating == null || (rating !== null && rating <= f.maxRating)) &&
    (!f.unratedOnly || rating === null) &&
    (f.instrumentId == null || v.instrumentId === f.instrumentId) &&
    (!f.withScreenshot || !!v.screenshotPath) &&
    (!f.withNotes || v.thesis.trim() !== '' || v.postMortem.trim() !== '')
  )
}

/** Échelle des prix d'un trade, comme `replay::ladder` (flottants : c'est un mock). */
export function mockLadder(v: TradeView): Level[] {
  const sign = v.direction === 'long' ? 1 : -1
  const entry = Number(v.entryPrice)
  const risk = v.plannedSl != null ? (entry - Number(v.plannedSl)) * sign : null
  const level = (kind: LevelKind, price: Decimal): Level => ({
    kind,
    price,
    r: risk !== null && risk > 0 ? ((Number(price) - entry) * sign) / risk : null,
  })
  const optional: [LevelKind, Decimal | null | undefined][] = [
    ['planned_sl', v.plannedSl],
    ['planned_tp', v.plannedTp],
    ['actual_sl', v.actualSl],
    ['actual_tp', v.actualTp],
    ['exit', v.exitPrice],
    ['price_after_exit', v.priceAfterExit],
  ]
  const levels = [level('entry', v.entryPrice)]
  for (const [kind, price] of optional) if (price != null) levels.push(level(kind, price))
  return levels.sort((a, b) => Number(b.price) - Number(a.price))
}
