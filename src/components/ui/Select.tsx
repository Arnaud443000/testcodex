import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import {
  firstEnabled,
  lastEnabled,
  moveActive,
  placePanel,
  sectionize,
  selectedLabel,
  startIndex,
  typeAhead,
  type SelectOption,
} from '../../lib/listboxModel'
import { Icon } from '../Icon'

export type { SelectOption }

type Box = { left: number; top?: number; bottom?: number; width: number; maxHeight: number; side: 'below' | 'above' }

const ITEM_H = 36
const GROUP_H = 30
const WANTED_MAX = 320

/**
 * Menu déroulant unique de Pulse (lot 29) : remplace tout `<select>` natif. Bouton `role="combobox"` + panneau
 * `role="listbox"` rendu dans un portail (jamais coupé par un conteneur), s'ouvre vers le haut s'il n'y a pas de place en bas,
 * clavier complet (flèches, Début / Fin, Page ↑ / ↓, Entrée, Espace, Échap, frappe pour sauter à une option), ferme au clic dehors.
 * Les valeurs sont des chaînes ; l'option vide d'un ancien `<select>` (`value=""`) est une option comme une autre.
 */
export function Select({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  className = '',
  disabled = false,
  error = false,
  variant = 'field',
}: {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Nom accessible quand aucun `<label htmlFor>` ne désigne ce menu. */
  ariaLabel?: string
  /** Affiché quand la valeur ne correspond à aucune option. */
  placeholder?: string
  /** Classes du bouton (largeur minimale, hauteur…). */
  className?: string
  disabled?: boolean
  error?: boolean
  /** `field` : champ de formulaire ; `inline` : texte simple avec chevron (barre du haut). */
  variant?: 'field' | 'inline'
}) {
  const t = useT().common.select
  const autoId = useId()
  const baseId = id ?? autoId
  const listId = `${baseId}-list`
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [box, setBox] = useState<Box | null>(null)

  const sections = useMemo(() => sectionize(options), [options])
  const label = selectedLabel(options, value)
  const groupCount = sections.filter((s) => s.group !== null).length

  const place = useCallback(() => {
    const el = buttonRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const wanted = Math.min(WANTED_MAX, Math.max(options.length, 1) * ITEM_H + groupCount * GROUP_H + 8)
    const p = placePanel(window.innerHeight - r.bottom - 6, r.top - 6, wanted)
    const width = Math.max(r.width, 160)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setBox(
      p.side === 'below'
        ? { left, top: r.bottom + 6, width, maxHeight: p.maxHeight, side: 'below' }
        : { left, bottom: window.innerHeight - r.top + 6, width, maxHeight: p.maxHeight, side: 'above' },
    )
  }, [options.length, groupCount])

  const openMenu = () => {
    if (disabled) return
    setActive(startIndex(options, value))
    setOpen(true)
  }
  const close = useCallback(() => setOpen(false), [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    const again = () => place()
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [open, place])

  // Clic dehors : ferme (le panneau est dans un portail, donc hors du bouton).
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  // Garde l'option active visible (défilement du panneau seul, jamais de la page).
  useEffect(() => {
    if (!open || active < 0) return
    const panel = panelRef.current
    const item = document.getElementById(`${baseId}-opt-${active}`)
    if (!panel || !item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < panel.scrollTop) panel.scrollTop = active <= 0 ? 0 : top
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight
  }, [active, open, baseId, box])

  const choose = (index: number) => {
    const o = options[index]
    if (!o || o.disabled) return
    setOpen(false)
    if (o.value !== value) onChange(o.value)
    buttonRef.current?.focus()
  }

  const typeInto = (char: string, from: number): number => {
    const now = Date.now()
    const state = typed.current
    state.text = now - state.at > 900 ? char : state.text + char
    state.at = now
    return typeAhead(options, from, state.text)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const current = options.findIndex((o) => o.value === value)
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Fermé : la frappe change directement la valeur, comme un <select>.
        const hit = typeInto(e.key, current)
        if (hit >= 0 && options[hit].value !== value) onChange(options[hit].value)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => (a < 0 ? firstEnabled(options) : moveActive(options, a, 1)))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => (a < 0 ? lastEnabled(options) : moveActive(options, a, -1)))
        break
      case 'PageDown':
        e.preventDefault()
        setActive((a) => moveActive(options, Math.max(a, 0), 1, 8))
        break
      case 'PageUp':
        e.preventDefault()
        setActive((a) => moveActive(options, Math.max(a, 0), -1, 8))
        break
      case 'Home':
        e.preventDefault()
        setActive(firstEnabled(options))
        break
      case 'End':
        e.preventDefault()
        setActive(lastEnabled(options))
        break
      case 'Enter':
      case ' ':
        e.preventDefault() // ne pas envoyer le formulaire
        if (active >= 0) choose(active)
        else close()
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation() // une boîte de dialogue autour ne se ferme pas avec le menu
        close()
        break
      case 'Tab':
        close()
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const hit = typeInto(e.key, active)
          if (hit >= 0) setActive(hit)
        }
    }
  }

  const triggerClass =
    variant === 'inline'
      ? 'select-inline'
      : `input select-trigger ${error ? 'input-error' : ''}`

  return (
    <>
      <button
        ref={buttonRef}
        id={baseId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        disabled={disabled}
        className={`${triggerClass} ${className}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`min-w-0 flex-1 truncate text-left ${label === null ? 'text-tx3' : ''}`}>{label ?? placeholder ?? t.placeholder}</span>
        <span className={`shrink-0 text-tx3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel ?? document.querySelector(`label[for="${CSS.escape(baseId)}"]`)?.textContent ?? undefined}
            data-placement={box.side}
            className="popover-panel pop-scroll"
            style={{ position: 'fixed', left: box.left, top: box.top, bottom: box.bottom, minWidth: box.width, maxWidth: 'min(480px, calc(100vw - 16px))', maxHeight: box.maxHeight }}
            onMouseDown={(e) => e.preventDefault()} // garde le focus sur le bouton
            onClick={(e) => e.stopPropagation()}
          >
            {options.length === 0 && <div className="px-4 py-3 text-sm text-tx2">{t.empty}</div>}
            {sections.map((s, n) => (
              <div key={`${s.group ?? '-'}-${n}`} role={s.group ? 'group' : 'presentation'} aria-label={s.group ?? undefined}>
                {s.group && <div role="presentation" className="caption px-4 pb-1 pt-2.5">{s.group}</div>}
                {s.items.map(({ option, index }) => {
                  const selected = option.value === value
                  return (
                    <div
                      key={`${option.value}-${index}`}
                      id={`${baseId}-opt-${index}`}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={option.disabled || undefined}
                      className={`popover-option ${index === active ? 'is-active' : ''} ${selected ? 'is-selected' : ''} ${option.disabled ? 'is-disabled' : ''}`}
                      onMouseEnter={() => !option.disabled && setActive(index)}
                      onClick={() => choose(index)}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {selected && (
                        <span className="shrink-0 text-tx-accent" aria-hidden="true">
                          <Icon name="check" size={16} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
