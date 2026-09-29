import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { WidgetHost } from './WidgetHost'
import { useT } from '../../i18n'
import type { ScopeEnv } from '../../lib/widgetScope'
import type { WidgetDefinition, WidgetInstance } from '../../types/dashboardLayout'

/** Taille de référence (en pixels) à laquelle l'aperçu est dessiné avant d'être réduit. */
const PREVIEW_COL = 32
const PREVIEW_ROW = 28
const PREVIEW_WIDTH = 360

/** Aperçu d'un widget : le vrai widget, à sa taille par défaut, réduit. Il lit les mêmes données que sur le dashboard. */
function Preview({ def, env }: { def: WidgetDefinition; env: ScopeEnv }) {
  const width = def.defaultW * PREVIEW_COL
  const height = def.defaultH * PREVIEW_ROW
  const scale = Math.min(1, PREVIEW_WIDTH / width)
  const instance: WidgetInstance = { uid: 'preview', kind: def.kind, x: 0, y: 0, w: def.defaultW, h: def.defaultH, period: null, accountId: null, mode: def.modes[0] ?? null }
  return (
    <div className="overflow-hidden rounded-inner" style={{ width: width * scale, height: height * scale }} aria-hidden="true">
      <div inert style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        <WidgetHost instance={instance} env={env} />
      </div>
    </div>
  )
}

/** Bibliothèque des widgets (3.8.3) : par thème, avec aperçu avant ajout. Un widget retiré du dashboard reste ici. */
export function WidgetLibrary({
  catalog,
  counts,
  env,
  onAdd,
  onClose,
}: {
  catalog: WidgetDefinition[]
  counts: Record<string, number>
  env: ScopeEnv
  onAdd: (def: WidgetDefinition) => void
  onClose: () => void
}) {
  const t = useT().dashboardBuilder
  const categories = useMemo(() => [...new Set(catalog.map((d) => d.category))], [catalog])
  const [category, setCategory] = useState<string>(categories[0] ?? 'all')
  const shown = category === 'all' ? catalog : catalog.filter((d) => d.category === category)
  // Panneau non modal (le tableau reste utilisable à côté), mais le focus y entre à l'ouverture et revient à la fermeture.
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby="widget-library-title"
      tabIndex={-1}
      className="glass-card fixed bg-bg bottom-4 right-4 top-[88px] z-40 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden outline-none"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex items-start justify-between gap-3 border-b p-5" style={{ borderColor: 'var(--hairline)' }}>
        <div>
          <h2 id="widget-library-title" className="text-base font-semibold">{t.library.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-tx3">{t.library.intro}</p>
        </div>
        <button type="button" className="btn-icon !h-8 !w-8 !border-transparent !bg-transparent" aria-label={t.library.close} title={t.library.close} onClick={onClose}>
          <Icon name="cross" size={16} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 px-5 pt-4" role="group" aria-label={t.library.title}>
        {['all', ...categories].map((c) => (
          <button key={c} type="button" aria-pressed={category === c} className={`chip !px-3 !py-1 !text-xs ${category === c ? 'chip-on' : ''}`} onClick={() => setCategory(c)}>
            {c === 'all' ? t.library.allCategories : t.categories[c]}
          </button>
        ))}
      </div>
      <ul className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        {shown.map((d) => {
          const w = t.widgets[d.kind]
          return (
            <li key={d.kind} className="flex flex-col gap-2.5">
              <Preview def={d} env={env} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{w?.title ?? d.kind}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-tx2">{w?.description}</p>
                  <p className="mt-1 text-[11.5px] text-tx3">{t.library.onDashboard(counts[d.kind] ?? 0)} · {t.library.size(d.defaultW, d.defaultH)}</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm shrink-0" aria-label={`${t.library.add} ${w?.title ?? d.kind}`} onClick={() => onAdd(d)}>
                  <Icon name="plus" size={14} />
                  {t.library.add}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
