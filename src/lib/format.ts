import type { Decimal } from '../types/money'

const MINUS = '−' // real minus sign, per charte 3

/**
 * Groups thousands of an exact decimal string without going through a float:
 * "12345.6" → "12,345.60" (minFractionDigits = 2). Never rounds: extra
 * fraction digits are kept. Negative values use the real minus sign.
 */
export function formatDecimal(value: Decimal, minFractionDigits = 0): string {
  const negative = value.startsWith('-')
  const [intPart, frac = ''] = (negative ? value.slice(1) : value).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = frac.padEnd(minFractionDigits, '0')
  const body = fraction ? `${grouped}.${fraction}` : grouped
  return negative && /[1-9]/.test(body) ? `${MINUS}${body}` : body
}

/** Signed money amount: +$1,234.50 / −$80.00 (charte: explicit signs, real minus). */
export function formatPnl(value: number, currency = 'USD'): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (value > 0) return `+${abs}`
  if (value < 0) return `${MINUS}${abs}`
  return abs
}

/** Signed percentage with one decimal: +8.4% / −6.2%. */
export function formatPercent(value: number, digits = 1): string {
  const abs = Math.abs(value).toFixed(digits)
  if (value > 0) return `+${abs}%`
  if (value < 0) return `${MINUS}${abs}%`
  return `${abs}%`
}
