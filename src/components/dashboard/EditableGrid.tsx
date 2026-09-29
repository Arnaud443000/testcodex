import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import { cellAt, cellDelta, moveTo, resizeTo, rowCount } from '../../lib/gridLayout'
import type { ScopeEnv } from '../../lib/widgetScope'
import { GRID_COLUMNS, type WidgetDefinition, type WidgetInstance } from '../../types/dashboardLayout'
import { MARGIN, ROW_HEIGHT } from './DashboardGrid'
import { WidgetHost } from './WidgetHost'

interface Drag {
  uid: string
  mode: 'move' | 'resize'
  startItems: WidgetInstance[]
  startX: number
  startY: number
  grabCol: number
  grabRow: number
  origin: WidgetInstance
}

/**
 * Le dashboard en mode modification : chaque widget se déplace par sa barre (souris) ou au clavier
 * (flèches ; Maj + flèches pour redimensionner ; Suppr pour retirer ; Entrée pour les réglages), et se
 * redimensionne par son coin. La disposition résultante est calculée par `lib/gridLayout` (aucun chevauchement).
 */
export function EditableGrid({
  items,
  defs,
  env,
  onChange,
  onRemove,
  onSettings,
  announce,
}: {
  items: WidgetInstance[]
  defs: Record<string, WidgetDefinition>
  env: ScopeEnv
  onChange: (items: WidgetInstance[]) => void
  onRemove: (uid: string) => void
  onSettings: (uid: string) => void
  announce: (message: string) => void
}) {
  const t = useT().dashboardBuilder
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const minOf = (kind: string) => ({ w: defs[kind]?.minW ?? 1, h: defs[kind]?.minH ?? 1 })
  const titleOf = (kind: string) => t.widgets[kind]?.title ?? kind
  /** Le titre du widget, suivi de son mode d'affichage quand il en a un (plusieurs indicateurs clés se ressemblent). */
  const labelOf = (it: WidgetInstance) => {
    const mode = it.mode ?? defs[it.kind]?.modes[0]
    const modeLabel = mode ? t.modes[it.kind]?.[mode] : undefined
    return modeLabel && (defs[it.kind]?.modes.length ?? 0) > 0 ? t.edit.titleWithMode(titleOf(it.kind), modeLabel) : titleOf(it.kind)
  }

  function begin(e: PointerEvent<HTMLElement>, it: WidgetInstance, mode: Drag['mode']) {
    if (e.button !== 0 || !gridRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const cell = cellAt(e.clientX, e.clientY, gridRef.current.getBoundingClientRect(), GRID_COLUMNS, ROW_HEIGHT)
    dragRef.current = { uid: it.uid, mode, startItems: items, startX: e.clientX, startY: e.clientY, grabCol: cell.col - it.x, grabRow: cell.row - it.y, origin: it }
    setActive(it.uid)
  }

  function drag(e: PointerEvent<HTMLElement>) {
    const d = dragRef.current
    if (!d || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    if (d.mode === 'move') {
      const cell = cellAt(e.clientX, e.clientY, rect, GRID_COLUMNS, ROW_HEIGHT)
      onChange(moveTo(d.startItems, d.uid, cell.col - d.grabCol, cell.row - d.grabRow, GRID_COLUMNS))
    } else {
      const { dCols, dRows } = cellDelta(e.clientX - d.startX, e.clientY - d.startY, rect.width, GRID_COLUMNS, ROW_HEIGHT)
      onChange(resizeTo(d.startItems, d.uid, d.origin.w + dCols, d.origin.h + dRows, minOf(d.origin.kind), GRID_COLUMNS))
    }
  }

  function end() {
    const d = dragRef.current
    dragRef.current = null
    setActive(null)
    if (!d) return
    const now = items.find((i) => i.uid === d.uid)
    if (!now) return
    announce(d.mode === 'move' ? t.edit.moved(titleOf(now.kind), now.x + 1, now.y + 1) : t.edit.resized(titleOf(now.kind), now.w, now.h))
  }

  function onKey(e: KeyboardEvent<HTMLElement>, it: WidgetInstance) {
    if (e.target !== e.currentTarget) return // les boutons du widget gardent leurs propres touches
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (e.key in arrows) {
      e.preventDefault()
      const [dx, dy] = arrows[e.key]
      const next = e.shiftKey
        ? resizeTo(items, it.uid, it.w + dx, it.h + dy, minOf(it.kind), GRID_COLUMNS)
        : moveTo(items, it.uid, it.x + dx, it.y + dy, GRID_COLUMNS)
      onChange(next)
      const now = next.find((i) => i.uid === it.uid)!
      announce(e.shiftKey ? t.edit.resized(titleOf(it.kind), now.w, now.h) : t.edit.moved(titleOf(it.kind), now.x + 1, now.y + 1))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove(it.uid)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onSettings(it.uid)
    }
  }

  return (
    <div
      ref={gridRef}
      data-testid="editable-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: ROW_HEIGHT,
        margin: -MARGIN,
        minHeight: (rowCount(items) + 8) * ROW_HEIGHT,
        // Repères : un point par case de la grille.
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.10) 1px, transparent 1.6px)',
        backgroundSize: `calc(100% / ${GRID_COLUMNS}) ${ROW_HEIGHT}px`,
      }}
    >
      {items.map((it) => {
        const title = labelOf(it)
        const isActive = active === it.uid
        return (
          <div key={it.uid} style={{ gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}`, padding: MARGIN, minWidth: 0, minHeight: 0, zIndex: isActive ? 20 : undefined }}>
            <div
              role="group"
              tabIndex={0}
              aria-label={t.edit.groupLabel(title)}
              onKeyDown={(e) => onKey(e, it)}
              className={`relative h-full rounded-card outline-dashed outline-2 outline-offset-2 transition-shadow focus-visible:outline focus-visible:outline-violet ${
                isActive ? 'outline-violet shadow-btn' : 'outline-white/20'
              }`}
            >
              <div className="h-full" inert>
                <WidgetHost instance={it} env={env} />
              </div>
              <div
                className="absolute inset-x-0 top-0 flex cursor-grab items-center gap-2 rounded-t-card border-b bg-bg/90 px-3 py-1.5 active:cursor-grabbing"
                style={{ borderColor: 'var(--hairline)', touchAction: 'none' }}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return
                  begin(e, it, 'move')
                }}
                onPointerMove={drag}
                onPointerUp={end}
                onPointerCancel={end}
                title={t.edit.dragHandle(title)}
              >
                <span className="text-tx3"><Icon name="grip" size={16} /></span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</span>
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-full text-tx2 hover:bg-white/10 hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
                  aria-label={t.edit.settings(title)}
                  title={t.edit.settings(title)}
                  onClick={() => onSettings(it.uid)}
                >
                  <Icon name="settings" size={16} />
                </button>
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-full text-tx2 hover:bg-loss/20 hover:text-[#F5A198] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
                  aria-label={t.edit.remove(title)}
                  title={t.edit.remove(title)}
                  onClick={() => onRemove(it.uid)}
                >
                  <Icon name="cross" size={16} />
                </button>
              </div>
              <span
                role="presentation"
                className="absolute bottom-1 right-1 grid h-6 w-6 cursor-nwse-resize place-items-center rounded-md bg-bg/80 text-tx2 hover:bg-white/10 hover:text-tx"
                style={{ touchAction: 'none' }}
                title={t.edit.resizeHandle(title)}
                onPointerDown={(e) => begin(e, it, 'resize')}
                onPointerMove={drag}
                onPointerUp={end}
                onPointerCancel={end}
              >
                <Icon name="resize" size={14} />
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
