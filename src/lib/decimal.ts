import type { Decimal } from '../types/money'

/**
 * Outils sur les décimaux exacts (chaînes) : comparaison et validation de saisie.
 * Aucune arithmétique monétaire ici : les montants sont calculés par pulse-core.
 */

/** Accepte la virgule française : "1,0842" → "1.0842". Ne touche à rien d'autre. */
export function normalizeDecimalInput(input: string): string {
  return input.trim().replace(',', '.')
}

/** Nombre décimal simple (pas d'exposant, pas de séparateur de milliers), comme pulse-core l'exige. */
export function isPlainDecimal(input: string, { allowNegative = false } = {}): boolean {
  const s = normalizeDecimalInput(input)
  return (allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(s)
}

export function isPositiveDecimal(input: string): boolean {
  return isPlainDecimal(input) && /[1-9]/.test(input)
}

function split(value: Decimal): { negative: boolean; int: string; frac: string } {
  const negative = value.startsWith('-')
  const [int = '0', frac = ''] = (negative ? value.slice(1) : value).split('.')
  const zero = !/[1-9]/.test(int + frac)
  return { negative: negative && !zero, int: int.replace(/^0+(?=\d)/, '') || '0', frac: frac.replace(/0+$/, '') }
}

/** Compare deux décimaux exacts sans passer par un flottant (−1, 0 ou 1). */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const x = split(a)
  const y = split(b)
  if (x.negative !== y.negative) return x.negative ? -1 : 1
  const sign = x.negative ? -1 : 1
  if (x.int.length !== y.int.length) return sign * (x.int.length < y.int.length ? -1 : 1)
  if (x.int !== y.int) return sign * (x.int < y.int ? -1 : 1)
  const len = Math.max(x.frac.length, y.frac.length)
  const fa = x.frac.padEnd(len, '0')
  const fb = y.frac.padEnd(len, '0')
  return fa === fb ? 0 : sign * (fa < fb ? -1 : 1)
}

/** −1, 0 ou 1 selon le signe. */
export function signOf(value: Decimal): -1 | 0 | 1 {
  return compareDecimal(value, '0') as -1 | 0 | 1
}

/** Retire les zéros de fin inutiles en gardant `minFraction` décimales ("341.600000" → "341.60"). Ne change pas la valeur. */
export function trimDecimal(value: Decimal, minFraction = 2): Decimal {
  const { negative, int, frac } = split(value)
  const fraction = frac.padEnd(minFraction, '0')
  return `${negative ? '-' : ''}${int}${fraction ? `.${fraction}` : ''}`
}
