const LOCALE = 'fr-FR'

/** « septembre 2026 » à partir de l'année et du mois (1–12). */
export function formatMonthTitle(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** « septembre » seul. */
export function formatMonthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(LOCALE, { month: 'long', timeZone: 'UTC' })
}

/** « lundi 28 septembre 2026 » à partir de « 2026-09-28 » (date civile, sans fuseau). */
export function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Mois précédent / suivant d'un couple (année, mois). */
export function shiftMonth(year: number, month: number, delta: -1 | 1): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** Palier de teinte de la heatmap (1 à 3) selon l'intensité de −1 à 1 ; 0 = jour à zéro. */
export function heatTier(intensity: number): number {
  const a = Math.abs(intensity)
  return a > 2 / 3 ? 3 : a > 1 / 3 ? 2 : 1
}
