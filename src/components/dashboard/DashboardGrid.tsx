import { useCallback, useRef, useState } from 'react'
import { readingOrder } from '../../lib/gridLayout'
import { GRID_COLUMNS, type WidgetInstance } from '../../types/dashboardLayout'
import type { ScopeEnv } from '../../lib/widgetScope'
import { WidgetHost } from './WidgetHost'

/** Hauteur d'une ligne de la grille, en pixels. Chaque widget est rentré de MARGIN px dans sa cellule (écart de 24 px entre cartes, charte). */
export const ROW_HEIGHT = 28
export const MARGIN = 12
/** En dessous de cette largeur, les widgets s'empilent (lecture seule). */
export const STACK_BELOW = 760

/** Largeur d'un élément, suivie avec un ResizeObserver. Le ref est une fonction : l'élément peut apparaître après le premier rendu. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.current.observe(el)
  }, [])
  return [ref, width]
}

/** Le dashboard en lecture : chaque widget à sa place sur la grille de 30 colonnes. */
export function ReadOnlyGrid({ items, env }: { items: WidgetInstance[]; env: ScopeEnv }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const stacked = width > 0 && width < STACK_BELOW
  if (stacked) {
    return (
      <div ref={ref} className="flex flex-col gap-6">
        {readingOrder(items).map((it) => (
          <div key={it.uid} style={{ height: it.h * ROW_HEIGHT - 2 * MARGIN }}>
            <WidgetHost instance={it} env={env} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div ref={ref}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: ROW_HEIGHT, margin: -MARGIN }}>
        {items.map((it) => (
          <div key={it.uid} style={{ gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}`, padding: MARGIN, minWidth: 0, minHeight: 0 }}>
            <WidgetHost instance={it} env={env} />
          </div>
        ))}
      </div>
    </div>
  )
}
