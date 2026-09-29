import type { Decimal } from '../types/money'
import { signOf, trimDecimal } from './decimal'

/** Formatage à la française : espace insécable fine comme séparateur de milliers, virgule décimale. */
const LOCALE = 'fr-FR'
const MINUS = '−' // vrai signe moins (charte 3)
const NBSP = ' '
const THIN_NBSP = ' ' // séparateur de milliers de Intl fr-FR

/**
 * Formate un décimal exact (chaîne renvoyée par pulse-core) sans passer par un
 * flottant : "12345.6" → "12 345,60" (minFractionDigits = 2). N'arrondit jamais :
 * les décimales en trop sont conservées. Signe moins typographique, jamais de « −0 ».
 * L'interface n'additionne jamais d'argent : elle affiche (cf. CLAUDE.md, « Argent et prix »).
 */
export function formatDecimal(value: Decimal, minFractionDigits = 0): string {
  const negative = value.startsWith('-')
  const [intPart, frac = ''] = (negative ? value.slice(1) : value).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP)
  const fraction = frac.padEnd(minFractionDigits, '0')
  const body = fraction ? `${grouped},${fraction}` : grouped
  return negative && /[1-9]/.test(body) ? `${MINUS}${body}` : body
}

function money(abs: number, currency: string): string {
  return abs.toLocaleString(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** P&L signé : +1 234,50 $ / −80,00 $ (signe explicite, vrai signe moins). */
export function formatPnl(value: number, currency = 'USD'): string {
  const abs = money(Math.abs(value), currency)
  if (value > 0) return `+${abs}`
  if (value < 0) return `${MINUS}${abs}`
  return abs
}

/** Pourcentage signé avec une décimale : +8,4 % / −6,2 %. */
export function formatPercent(value: number, digits = 1): string {
  const abs = `${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}%`
  if (value > 0) return `+${abs}`
  if (value < 0) return `${MINUS}${abs}`
  return abs
}

const currencySymbols = new Map<string, string>()
function currencySymbol(currency: string): string {
  let s = currencySymbols.get(currency)
  if (s === undefined) {
    try {
      s = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value
    } catch {
      /* code de devise inconnu */
    }
    s ??= currency
    currencySymbols.set(currency, s)
  }
  return s
}

/**
 * Montant exact (chaîne de pulse-core) avec devise : « 341,60 $ ». Les zéros de fin
 * superflus sont retirés ("341.600000") sans jamais arrondir.
 */
export function formatMoney(value: Decimal, currency: string): string {
  return `${formatDecimal(trimDecimal(value, 2), 2)}${NBSP}${currencySymbol(currency)}`
}

/** P&L exact signé : « +341,60 $ » / « −80,00 $ » (signe explicite, vrai signe moins, jamais « −0 »). */
export function formatSignedMoney(value: Decimal, currency: string): string {
  const s = signOf(value)
  const abs = formatMoney(s < 0 ? value.slice(1) : value, currency)
  return s > 0 ? `+${abs}` : s < 0 ? `${MINUS}${abs}` : abs
}

/** Multiple de risque : « +2,1 R » / « −1,0 R » ; « — » quand il n'est pas défini (pas de stop). */
export function formatR(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  const abs = `${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}R`
  const rounded = Number(value.toFixed(digits))
  return rounded > 0 ? `+${abs}` : rounded < 0 ? `${MINUS}${abs}` : abs
}

/** Nombre non signé avec décimales fixes : « 2,6 ». */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Durée : « 1 h 12 min », « 45 min », « 2 j 3 h », « < 1 min ». */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '< 1 min'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`
  if (h > 0) return m > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`
  return `${m} min`
}

/** Date et heure locales : « 28 sept. 2026 · 09:42 ». */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} · ${time}`
}

/** Date locale courte : « 28 sept. 2026 ». */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}
