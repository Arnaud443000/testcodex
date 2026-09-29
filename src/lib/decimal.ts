import type { Decimal } from '../types/money'

/**
 * Lit un montant saisi à la française et le renvoie sous forme de chaîne décimale
 * exacte (jamais un `number`) : "100 000" → "100000", "10 000,50" → "10000.50".
 * Accepte espaces (normales, insécables), virgule ou point décimal.
 * Renvoie `null` si la saisie n'est pas un nombre positif ou nul valide.
 * Une saisie vide vaut "0".
 */
export function parseDecimalInput(input: string): Decimal | null {
  const cleaned = input.replace(/[\s  ]/g, '').replace(',', '.')
  if (cleaned === '') return '0'
  return /^\d+(\.\d+)?$/.test(cleaned) ? cleaned : null
}
