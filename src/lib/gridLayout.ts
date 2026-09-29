/**
 * Disposition d'un dashboard sur une grille : uniquement de la géométrie (aucune statistique).
 * Règle (cahier 3.8.2) : la grille se réorganise seule pour éviter les chevauchements. Les widgets
 * « tombent » vers le haut (compaction verticale) ; le widget que l'utilisateur déplace ou agrandit
 * garde sa place et pousse les autres vers le bas.
 */

export interface Box {
  uid: string
  x: number
  y: number
  w: number
  h: number
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Fait remonter chaque widget tant que la case au-dessus est libre, dans l'ordre haut → bas puis gauche → droite. */
function floatUp<T extends Box>(items: T[]): T[] {
  const placed: T[] = []
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const it of sorted) {
    let y = it.y
    while (y > 0 && !placed.some((p) => overlaps(p, { ...it, y: y - 1 }))) y--
    placed.push({ ...it, y })
  }
  return items.map((it) => placed.find((p) => p.uid === it.uid)!)
}

/**
 * Résout les chevauchements. `priority` : le widget qui garde sa position demandée (les autres sont
 * poussés vers le bas s'ils le gênent, puis tout remonte pour boucher les vides).
 */
export function settle<T extends Box>(items: T[], priority?: string): T[] {
  const anchor = priority === undefined ? undefined : items.find((i) => i.uid === priority)
  const others = items.filter((i) => i !== anchor).sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: T[] = anchor ? [{ ...anchor }] : []
  for (const it of others) {
    let y = it.y
    while (placed.some((p) => overlaps(p, { ...it, y }))) y++
    placed.push({ ...it, y })
  }
  return floatUp(items.map((it) => placed.find((p) => p.uid === it.uid)!))
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Déplace un widget à (x, y) — borné à la grille — et réorganise les autres. */
export function moveTo<T extends Box>(items: T[], uid: string, x: number, y: number, cols: number): T[] {
  return settle(
    items.map((it) => (it.uid === uid ? { ...it, x: clamp(Math.round(x), 0, cols - it.w), y: Math.max(0, Math.round(y)) } : it)),
    uid,
  )
}

/** Redimensionne un widget (jamais sous son minimum, jamais hors de la grille) et réorganise les autres. */
export function resizeTo<T extends Box>(items: T[], uid: string, w: number, h: number, min: { w: number; h: number }, cols: number): T[] {
  return settle(
    items.map((it) => (it.uid === uid ? { ...it, w: clamp(Math.round(w), min.w, cols - it.x), h: Math.max(min.h, Math.round(h)) } : it)),
    uid,
  )
}

/** Première place libre (de haut en bas, de gauche à droite) pour un widget de taille w × h. */
export function firstFreeSpot(items: Box[], w: number, h: number, cols: number): { x: number; y: number } {
  const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!items.some((i) => overlaps(i, { uid: '', x, y, w, h }))) return { x, y }
    }
  }
  return { x: 0, y: bottom }
}

/** Ajoute un widget à la première place libre. */
export function addAt<T extends Box>(items: T[], item: Omit<T, 'x' | 'y'>, cols: number): T[] {
  return [...items, { ...item, ...firstFreeSpot(items, item.w, item.h, cols) } as T]
}

/** Case de la grille sous un point de l'écran (cellules sans marge : chaque widget est rentré dans sa cellule). */
export function cellAt(px: number, py: number, grid: { left: number; top: number; width: number }, cols: number, rowHeight: number): { col: number; row: number } {
  const colW = grid.width / cols
  return { col: Math.floor((px - grid.left) / colW), row: Math.floor((py - grid.top) / rowHeight) }
}

/** Nombre de colonnes / de lignes dont un déplacement de souris de (dx, dy) pixels fait avancer. */
export function cellDelta(dx: number, dy: number, gridWidth: number, cols: number, rowHeight: number): { dCols: number; dRows: number } {
  return { dCols: Math.round(dx / (gridWidth / cols)), dRows: Math.round(dy / rowHeight) }
}

/** Ordre de lecture (haut → bas, gauche → droite) : sert à empiler les widgets sur une fenêtre étroite. */
export function readingOrder<T extends Box>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Nombre de lignes occupées. */
export const rowCount = (items: Box[]): number => items.reduce((m, i) => Math.max(m, i.y + i.h), 0)
