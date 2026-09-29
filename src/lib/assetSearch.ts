import type { AssetClass, Instrument } from '../types/trade'

/** Ordre d'affichage des groupes : indices, crypto, devises, matières premières, actions, puis le reste. */
export const ASSET_CLASS_ORDER: AssetClass[] = ['index', 'crypto', 'forex', 'commodity', 'stock', 'future', 'other']

/** Minuscules, sans accents. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Comme `fold`, sans espaces ni ponctuation : « eur/usd » et « EURUSD » se rejoignent. */
const compact = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '')

export interface AssetGroup {
  assetClass: AssetClass
  items: Instrument[]
}

/** 0 = meilleur. null = pas de correspondance. */
function rank(i: Instrument, q: string, qc: string): number | null {
  const sym = compact(i.symbol)
  const name = fold(i.name)
  if (sym === qc) return 0
  if (sym.startsWith(qc)) return 1
  if (name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2
  if (sym.includes(qc) || (qc !== '' && compact(i.name).includes(qc))) return 3
  return null
}

/**
 * Recherche par symbole OU nom, insensible à la casse et aux accents, résultats groupés par classe d'actif.
 * Une requête vide renvoie tout le catalogue, groupé.
 */
export function searchInstruments(all: Instrument[], query: string): AssetGroup[] {
  const q = fold(query).trim()
  const qc = compact(query)
  const scored: { i: Instrument; r: number }[] = []
  for (const i of all) {
    const r = q === '' ? 0 : rank(i, q, qc)
    if (r !== null) scored.push({ i, r })
  }
  scored.sort((a, b) => a.r - b.r || a.i.symbol.localeCompare(b.i.symbol))
  const groups: AssetGroup[] = []
  for (const assetClass of ASSET_CLASS_ORDER) {
    const items = scored.filter((s) => s.i.assetClass === assetClass).map((s) => s.i)
    if (items.length > 0) groups.push({ assetClass, items })
  }
  return groups
}
