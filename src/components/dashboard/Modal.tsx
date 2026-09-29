import { useEffect, useRef, type ReactNode } from 'react'

/** Boîte de dialogue : Échap ou clic sur le fond pour fermer, le focus y entre et revient à l'élément d'origine. */
export function Modal({ title, onClose, children, wide = false, maxWidth }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; maxWidth?: string }) {
  const ref = useRef<HTMLDivElement>(null)
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
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`glass-card bg-bg max-h-[90vh] w-full overflow-auto p-6 outline-none ${maxWidth ?? (wide ? 'max-w-[720px]' : 'max-w-[460px]')}`}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
