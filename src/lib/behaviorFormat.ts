import type { Decimal } from '../types/money'
import type { RBin } from '../types/stats'
import { signOf } from './decimal'
import { formatDecimal, formatMoney, formatNumber, formatSignedMoney, formatSignedMoneyRounded, formatSignedNumber, formatSignedRatioPercent } from './format'

/** Formats de la page Comportement. Aucun calcul métier : uniquement de l'affichage (« — » quand la valeur manque). */

const MINUS = '−'

/** Score de 0 à 100 : entier, « — » s'il n'est pas établi (jamais 0 à la place). */
export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : String(Math.round(score))
}

/** Coût d'une erreur (somme positive des pertes) affiché comme une perte : « −1 620,00 $ » ; « 0,00 $ » si nul. */
export function formatLoss(cost: Decimal, currency: string): string {
  return signOf(cost) > 0 ? formatSignedMoney(`-${cost}`, currency) : formatMoney(cost, currency)
}

/** Pourcentage exprimé en pourcents (« 1.5 » → « 1,5 % »), tel que stocké dans les réglages. */
export function formatPercentValue(percent: Decimal | null | undefined): string {
  return percent === null || percent === undefined ? '—' : `${formatDecimal(percent)}\u00a0%`
}

/** Valeur d'une borne de classe de R : « −3 », « 0,5 ». */
const edge = (v: number) => `${v < 0 ? MINUS : ''}${formatNumber(Math.abs(v), Number.isInteger(v) ? 0 : 1)}`

/** Étiquette d'une classe de R : « < −3 », « −0,5 », « ≥ 5 » (borne basse de la classe). */
export function rBinLabel(bin: RBin): string {
  if (bin.from === null) return `< ${edge(bin.to ?? 0)}`
  if (bin.to === null) return `≥ ${edge(bin.from)}`
  return edge(bin.from)
}

/** Une classe de R est du côté perte si elle est entièrement sous zéro ; le breakeven (R = 0) tombe dans [0 ; 0,5). */
export const isLossBin = (bin: RBin): boolean => bin.to !== null && bin.to <= 0

/** Palier de teinte (1 à 3) d'une intensité de −1 à 1 ; 0 = case neutre. Les seuils suivent les paliers du calendrier. */
export function heatTier(intensity: number): { tone: 'gain' | 'loss' | 'none'; tier: 1 | 2 | 3 } {
  const a = Math.abs(intensity)
  if (a === 0) return { tone: 'none', tier: 1 }
  return { tone: intensity > 0 ? 'gain' : 'loss', tier: a <= 1 / 3 ? 1 : a <= 2 / 3 ? 2 : 3 }
}

/** Jour « AAAA-MM-JJ » en axe de graphique : « 29/09 ». Valeur inattendue renvoyée telle quelle. */
export function formatDayShort(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${m[2]}/${m[1]}` : day
}

/** Mois « AAAA-MM » en clair : « sept. 2026 ». Valeur inattendue renvoyée telle quelle. */
export function formatMonthKey(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Nombre minimal de coches pour qu'une règle ait une tendance (`MIN_CHECKS_FOR_TREND` de pulse-core), pour le message d'aide. */
export const MIN_CHECKS_FOR_TREND = 4

// --- Lot 8 bis : affichage des compléments (aucun calcul, uniquement du format ; « — » quand la valeur manque) ---

/** Variation de taille (0,23 → « +23 % ») ; « — » si non établie. */
export function formatSizeChange(change: number | null | undefined): string {
  return change === null || change === undefined ? '—' : formatSignedRatioPercent(change, 0)
}

/** Écart de score de discipline, en points sur 100 : « −14 pts » (« pt » au singulier) ; « — » s'il manque. */
export function formatScoreGap(gap: number | null | undefined): string {
  if (gap === null || gap === undefined) return '—'
  const rounded = Math.round(gap)
  const unit = Math.abs(rounded) >= 2 ? 'pts' : 'pt'
  return `${formatSignedNumber(rounded, 0)} ${unit}`
}

/** Écart d'expectancy en R : « −0,42 R » ; « — » s'il manque. */
export function formatRGap(gap: number | null | undefined): string {
  return gap === null || gap === undefined ? '—' : `${formatSignedNumber(gap, 2)} R`
}

/** Différence d'argent arrondie, signe explicite ; « — » si absente. */
export function formatMoneyGap(gap: Decimal | null | undefined, currency: string): string {
  return gap === null || gap === undefined ? '—' : formatSignedMoneyRounded(gap, currency)
}
