const MINUS = '−' // real minus sign, per charte 3

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
