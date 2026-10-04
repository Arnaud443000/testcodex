/**
 * Formatage à la française, comme src/lib/format.ts de l'app : signe explicite, vrai signe
 * moins, virgule décimale. Séparateur de milliers : espace fine (U+2009, présente dans la
 * police embarquée ; l'espace fine insécable U+202F ne l'est pas).
 */
export const MINUS = '−'
const THIN = ' '
const NBSP = ' '

function group(int: string) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, THIN)
}

export function num(v: number, digits = 0) {
  const [i, f] = Math.abs(v).toFixed(digits).split('.')
  return (v < 0 && Number(Math.abs(v).toFixed(digits)) !== 0 ? MINUS : '') + group(i) + (f ? `,${f}` : '')
}

/** « +12 480,00 € » / « −380,00 € ». */
export function money(v: number, digits = 2, signed = true) {
  const abs = `${num(Math.abs(v), digits)}${NBSP}€`
  if (!signed) return abs
  return v > 0 ? `+${abs}` : v < 0 ? `${MINUS}${abs}` : abs
}

export function pct(v: number, digits = 0, signed = false) {
  const abs = `${num(Math.abs(v), digits)}${NBSP}%`
  if (!signed) return (v < 0 ? MINUS : '') + abs
  return v > 0 ? `+${abs}` : v < 0 ? `${MINUS}${abs}` : abs
}

export function rMul(v: number, digits = 2) {
  const abs = `${num(Math.abs(v), digits)}${NBSP}R`
  return v > 0 ? `+${abs}` : v < 0 ? `${MINUS}${abs}` : abs
}
