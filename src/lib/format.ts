import type { Decimal } from '../types/money'

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
