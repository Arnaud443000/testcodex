import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'

/** Menu « Configuration » : dupliquer, exporter, importer (3.8.7). Échap ou un clic à côté le ferme. */
export function ConfigMenu({
  onDuplicate,
  onExport,
  onImport,
  busy,
}: {
  onDuplicate: () => void
  onExport: () => void
  onImport: () => void
  busy: boolean
}) {
  const t = useT().dashboardBuilder.transfer
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const items: { label: string; hint: string; run: () => void }[] = [
    { label: t.duplicate, hint: t.duplicateHint, run: onDuplicate },
    { label: t.export, hint: t.exportHint, run: onExport },
    { label: t.import, hint: t.importHint, run: onImport },
  ]
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <Tooltip content={t.menu}>
        <button
          type="button"
          className={`btn-icon ${open ? '!bg-white/10 !text-tx' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${t.menu} : ${t.menuLabel}`}
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="more" size={18} />
        </button>
      </Tooltip>
      {open && (
        <div role="menu" aria-label={t.menuLabel} className="glass-card bg-bg absolute right-0 z-40 mt-2 flex w-[320px] flex-col p-2">
          {items.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className="flex flex-col items-start gap-0.5 rounded-[10px] px-3 py-2.5 text-left hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
              onClick={() => {
                setOpen(false)
                i.run()
              }}
            >
              <span className="text-sm font-medium">{i.label}</span>
              <span className="text-xs text-tx3">{i.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
