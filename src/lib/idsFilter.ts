/**
 * Liste de trades précise dans l'adresse de la liste des trades : `/trades?ids=12,15,31` (lot 34 : « Voir les
 * trades » d'un objectif de comportement). Simple filtre d'affichage sur les trades déjà chargés.
 */
export const IDS_PARAM = 'ids'
const MAX_IDS = 500

/** « 12,15,31 » → [12, 15, 31] ; `null` si l'adresse n'en porte pas ou n'est pas lisible. */
export function parseIdsParam(value: string | null): number[] | null {
  if (!value) return null
  const ids = value.split(',').map((s) => s.trim())
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((s) => /^[1-9]\d{0,14}$/.test(s))) return null
  return [...new Set(ids.map(Number))]
}

/** Adresse de la liste filtrée ; `null` sans trade (pas de lien vers une liste vide). */
export function tradesHref(ids: number[]): string | null {
  if (ids.length === 0) return null
  return `/trades?${IDS_PARAM}=${[...new Set(ids)].slice(0, MAX_IDS).join(',')}`
}
