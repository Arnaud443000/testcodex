import { compareDecimal, roundDecimal, signOf } from './decimal'
import { formatMoney, formatNumber, formatSignedMoney } from './format'
import type { CurvePoint } from '../components/charts'
import type { Decimal } from '../types/money'
import type { AssetRow, FeeGranularity, StrategyRow, Summary } from '../types/stats'

/**
 * Affichage des analyses d'étape 3 (lot 14). Rien n'est calculé ici : ce fichier ordonne des lignes
 * déjà chiffrées par pulse-core, écrit des libellés et prépare des points à dessiner.
 */

export type SortDir = 'asc' | 'desc'
export type AssetSortKey = 'symbol' | 'trades' | 'winRate' | 'avgR' | 'netPnl' | 'fees' | 'feesShare'
export type StrategySortKey = 'name' | 'trades' | 'share' | 'winRate' | 'avgR' | 'profitFactor' | 'netPnl' | 'maxDrawdown'

/** Valeur triable : texte, nombre, montant exact (chaîne décimale) ou absente. */
type Value = { text: string } | { num: number } | { money: Decimal } | null

function compareValues(a: NonNullable<Value>, b: NonNullable<Value>): number {
  if ('text' in a && 'text' in b) return a.text.localeCompare(b.text, 'fr')
  if ('money' in a && 'money' in b) return compareDecimal(a.money, b.money)
  if ('num' in a && 'num' in b) return a.num - b.num
  return 0
}

/** Tri stable ; une valeur absente (« — ») reste en dernier quel que soit le sens. */
function sortRows<T>(rows: T[], value: (r: T) => Value, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((x, y) => {
      if (x.v === null && y.v === null) return x.index - y.index
      if (x.v === null) return 1
      if (y.v === null) return -1
      return sign * compareValues(x.v, y.v) || x.index - y.index
    })
    .map((x) => x.row)
}

export function sortAssets(rows: AssetRow[], key: AssetSortKey, dir: SortDir): AssetRow[] {
  return sortRows(
    rows,
    (r): Value => {
      switch (key) {
        case 'symbol': return { text: r.symbol }
        case 'trades': return { num: r.summary.tradeCount }
        case 'winRate': return r.summary.winRate === null ? null : { num: r.summary.winRate }
        case 'avgR': return r.summary.expectancyR === null ? null : { num: r.summary.expectancyR }
        case 'netPnl': return { money: r.summary.netPnl }
        case 'fees': return { money: r.summary.fees }
        case 'feesShare': return r.feesShareOfGross === null ? null : { num: r.feesShareOfGross }
      }
    },
    dir,
  )
}

export function sortStrategies(rows: StrategyRow[], key: StrategySortKey, dir: SortDir): StrategyRow[] {
  return sortRows(
    rows,
    (r): Value => {
      switch (key) {
        case 'name': return { text: r.name }
        case 'trades': return { num: r.summary.tradeCount }
        case 'share': return r.shareOfTrades === null ? null : { num: r.shareOfTrades }
        case 'winRate': return r.summary.winRate === null ? null : { num: r.summary.winRate }
        case 'avgR': return r.summary.expectancyR === null ? null : { num: r.summary.expectancyR }
        case 'profitFactor': return r.summary.profitFactor === null ? null : { num: r.summary.profitFactor }
        case 'netPnl': return { money: r.summary.netPnl }
        case 'maxDrawdown': return { money: r.summary.maxDrawdown }
      }
    },
    dir,
  )
}

// --- liens vers la liste des trades ---------------------------------------------------

export const INSTRUMENT_PARAM = 'instrument'
export const SETUP_PARAM = 'setup'

export const instrumentLink = (instrumentId: number) => `/trades?${INSTRUMENT_PARAM}=${instrumentId}`
export const setupLink = (tagId: number) => `/trades?${SETUP_PARAM}=${tagId}`

/** Identifiant lu dans l'adresse ; toute valeur mal formée est ignorée (pas de filtre) plutôt que de casser la page. */
export function parseIdParam(value: string | null): number | null {
  return /^\d{1,15}$/.test(value ?? '') ? Number(value) : null
}

// --- libellés -----------------------------------------------------------------------------

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const fmt = (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options })

/** Période d'un tableau de frais : « sept. 2026 », « 1 sept. 2026 » ou, pour une semaine, son lundi. */
export function feePeriodLabel(key: string, by: FeeGranularity, weekOf: (date: string) => string): string {
  const [y, m, d = '1'] = key.split('-')
  if (by === 'month') return fmt(utcDate(Number(y), Number(m), 1), { month: 'short', year: 'numeric' })
  const label = fmt(utcDate(Number(y), Number(m), Number(d)), { day: 'numeric', month: 'short', year: 'numeric' })
  return by === 'week' ? weekOf(label) : label
}

/** Frais : un coût s'écrit sans signe (« 12,00 $ »), un crédit (swap positif) avec un vrai signe moins. */
export function formatFee(value: Decimal, currency: string): string {
  return signOf(value) < 0 ? formatSignedMoney(value, currency) : formatMoney(value, currency)
}

/** Frais agrégés, arrondis au centime pour l'affichage seulement (la valeur exacte reste celle de pulse-core). */
export const formatFeeRounded = (value: Decimal, currency: string): string => formatFee(roundDecimal(value, 2), currency)

/** Points à tracer : la conversion en nombre ne sert qu'au dessin, jamais à un calcul. */
export function toCurve<P extends { time: number }>(points: P[], pick: (p: P) => Decimal): CurvePoint[] {
  return points.map((p) => ({ time: p.time, value: Number(pick(p)) }))
}

/** Facteur de profit : « ∞ » quand il y a des gains et aucune perte (pulse-core renvoie alors « indéfini »), « — » sinon. */
export function formatProfitFactor(s: Pick<Summary, 'profitFactor' | 'totalGains' | 'totalLosses'>): string {
  if (s.profitFactor === null && signOf(s.totalGains) > 0 && signOf(s.totalLosses) === 0) return '∞'
  return formatNumber(s.profitFactor, 2)
}
