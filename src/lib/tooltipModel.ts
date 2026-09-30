/** Placement pur de l'infobulle (`components/ui/Tooltip.tsx`) : aucun accès au DOM, testé sous Node. */

export type Rect = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

export type TooltipPlacement = {
  side: 'top' | 'bottom'
  left: number
  top: number
  /** Position de la flèche par rapport au bord gauche de l'infobulle. */
  arrowLeft: number
}

/** Délai d'apparition (ms) : assez long pour ne pas clignoter au passage de la souris. */
export const TOOLTIP_DELAY_MS = 250

/**
 * Au-dessus de la cible par défaut ; en dessous s'il n'y a pas assez de place en haut (et qu'il y en a plus en bas).
 * Horizontalement centrée sur la cible puis ramenée dans la fenêtre ; la flèche reste pointée vers le centre de la cible.
 */
export function placeTooltip(target: Rect, tip: Size, viewport: Size, gap = 8, margin = 8): TooltipPlacement {
  const spaceTop = target.top - margin
  const spaceBottom = viewport.height - (target.top + target.height) - margin
  const need = tip.height + gap
  const side: 'top' | 'bottom' = spaceTop >= need || spaceTop >= spaceBottom ? 'top' : 'bottom'
  const top = side === 'top' ? target.top - gap - tip.height : target.top + target.height + gap
  const center = target.left + target.width / 2
  const maxLeft = Math.max(margin, viewport.width - tip.width - margin)
  const left = Math.min(Math.max(center - tip.width / 2, margin), maxLeft)
  const arrowLeft = Math.min(Math.max(center - left, 12), Math.max(tip.width - 12, 12))
  return { side, left, top: Math.max(top, margin), arrowLeft }
}

/** Y a-t-il quelque chose à afficher ? (`title={cond ? x : undefined}` passe par ici : pas de contenu, pas d'infobulle). */
export function hasContent(content: unknown): boolean {
  if (content === null || content === undefined || content === false) return false
  if (typeof content === 'string') return content.trim() !== ''
  return true
}
