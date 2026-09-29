import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Boîte de dialogue : Échap ou clic sur le fond pour fermer, le focus y entre, **y reste** (Tab et Maj+Tab bouclent
 * dans la boîte) et revient à l'élément d'origine. Le titre nomme la boîte (`aria-labelledby`).
 */
export function Modal({ title, onClose, children, wide = false, maxWidth }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; maxWidth?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    ;(first ?? ref.current)?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg-deep/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        } else if (e.key === 'Tab') {
          const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null)
          if (items.length === 0) {
            e.preventDefault()
            return
          }
          const first = items[0]
          const last = items[items.length - 1]
          const active = document.activeElement
          if (e.shiftKey && (active === first || active === ref.current)) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && active === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glass-card bg-bg max-h-[90vh] w-full overflow-auto p-6 outline-none ${maxWidth ?? (wide ? 'max-w-[720px]' : 'max-w-[460px]')}`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
