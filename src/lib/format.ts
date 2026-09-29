/** Formatage à la française : espace insécable comme séparateur de milliers, virgule décimale. */
const LOCALE = 'fr-FR'
const MINUS = '−' // vrai signe moins (charte 3)
const NBSP = ' '

function money(abs: number, currency: string): string {
  return abs.toLocaleString(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Montant non signé : 10 000,00 $ */
export function formatAmount(value: number, currency = 'USD'): string {
  return money(value, currency)
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
