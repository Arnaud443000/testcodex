import { trimDecimal } from './decimal'
import { formatMoney, formatNumber, formatR, formatSignedMoney } from './format'
import type { Decimal } from '../types/money'
import type { GoalMetric, GoalProgress } from '../types/goals'

/** Mois « AAAA-MM » décalé de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** « septembre 2026 ». */
export function formatMonthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1, 12).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

/** La cible telle que l'utilisateur l'a saisie : « 500,00 $ », « 55 % », « 2,5 R »… */
export function formatTarget(metric: GoalMetric, target: Decimal, currency: string): string {
  switch (metric) {
    case 'net_pnl':
    case 'max_drawdown':
      return formatMoney(target, currency)
    case 'win_rate':
      return `${formatNumber(Number(target), Number.isInteger(Number(target)) ? 0 : 1)}\u00a0%`
    case 'execution_quality':
      return `${formatNumber(Number(target), 1)} / 5`
    case 'discipline_score':
      return `${formatNumber(Number(target), Number.isInteger(Number(target)) ? 0 : 1)} / 100`
    case 'expectancy_r':
      return formatR(Number(target)).replace(/^\+/, '')
    case 'profit_factor':
      return formatNumber(Number(trimDecimal(target, 0)), 2)
  }
}

/** Ce qui a été réalisé : « +25,00 $ », « 75,0 % », « ∞ » (profit factor sans aucune perte)… « — » si rien n'est mesurable. */
export function formatActual(p: GoalProgress, currency: string): string {
  const { metric } = p.goal
  if (p.actualMoney !== null) return metric === 'net_pnl' ? formatSignedMoney(p.actualMoney, currency) : formatMoney(p.actualMoney, currency)
  if (p.actualRatio === null) return metric === 'profit_factor' && p.fraction !== null ? '∞' : '—'
  switch (metric) {
    case 'win_rate':
      return `${formatNumber(p.actualRatio, 1)}\u00a0%`
    case 'execution_quality':
      return `${formatNumber(p.actualRatio, 1)} / 5`
    case 'discipline_score':
      return `${formatNumber(p.actualRatio, 0)} / 100`
    case 'expectancy_r':
      return formatR(p.actualRatio, 2)
    default:
      return formatNumber(p.actualRatio, 2)
  }
}
