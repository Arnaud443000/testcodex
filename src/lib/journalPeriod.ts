import type { PeriodKey } from '../types/stats'
import type { PeriodQuery } from '../types/journal'

/** Nombre de jours locaux de la période, jour courant inclus (cahier : 1J = aujourd'hui, 1S = 7 jours…). */
export const PERIOD_DAYS: Record<PeriodKey, number | null> = { '1D': 1, '1W': 7, '1M': 30, '3M': 90, '1Y': 365, ALL: null }

/**
 * Fenêtre `[from, to)` envoyée à pulse-core pour une période de la barre du haut :
 * de minuit (heure locale) il y a N − 1 jours jusqu'à maintenant ; « Tout » n'a pas de borne.
 */
export function periodWindow(period: PeriodKey, now: Date = new Date()): Pick<PeriodQuery, 'from' | 'to'> {
  const days = PERIOD_DAYS[period]
  if (days === null) return { from: null, to: null }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: start.getTime(), to: null }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Jour local « AAAA-MM-JJ » d'une date. */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Décale un jour « AAAA-MM-JJ » de `delta` jours (midi local : jamais de saut d'heure d'été). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + delta, 12))
}

/** Affichage long d'un jour : « mardi 29 septembre 2026 ». */
export function formatDayTitle(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
