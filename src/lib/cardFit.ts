/**
 * Logique pure de l'ajustement des cartes du tableau de bord (`components/ui/fit.tsx`) : une carte a une hauteur fixée par la
 * grille ; si son contenu déborde, on le resserre (densité), puis on retire les textes facultatifs, puis on raccourcit les listes
 * (lien « Voir les N autres »). Jamais de contenu coupé, jamais de barre de défilement tant qu'un réglage plus serré suffit.
 */

/** 0 = normal, 1 = serré (marges et lignes réduites), 2 = très serré (textes facultatifs masqués). */
export const MAX_DENSITY = 2

/** Densité suivante : un cran de plus seulement si ça déborde encore et qu'il en reste. */
export function nextDensity(level: number, overflows: boolean): number {
  return overflows && level < MAX_DENSITY ? level + 1 : level
}

/**
 * Nombre de lignes (du début de la liste) qui tiennent entièrement dans `available` pixels : `bottoms` = bas de chaque ligne,
 * mesuré depuis le haut de la zone. Au moins une ligne est gardée si la liste n'est pas vide (elle ne disparaît jamais).
 */
export function rowsThatFit(bottoms: number[], available: number): number {
  if (bottoms.length === 0) return 0
  let n = 0
  while (n < bottoms.length && bottoms[n] <= available + 0.5) n += 1
  return Math.max(n, 1)
}

/** Hauteur réservée à la ligne « Voir les N autres » quand toute la liste ne tient pas. */
export const MORE_LINE_HEIGHT = 28

/** Combien de lignes garder : toutes si elles tiennent, sinon celles qui tiennent en laissant la place du lien. */
export function visibleRows(bottoms: number[], available: number): number {
  if (bottoms.length === 0) return 0
  if (bottoms[bottoms.length - 1] <= available + 0.5) return bottoms.length
  return rowsThatFit(bottoms, available - MORE_LINE_HEIGHT)
}
