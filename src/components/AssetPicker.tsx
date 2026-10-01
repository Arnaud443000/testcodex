import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from './ui/Tooltip'
import { useT } from '../i18n'
import { searchInstruments } from '../lib/assetSearch'
import type { Instrument } from '../types/trade'
import { Icon } from './Icon'
import { useFloatingBox } from './ui/useFloatingBox'

/**
 * Sélecteur d'actif avec recherche (symbole ou nom), résultats groupés par classe, utilisable au clavier.
 * Le champ affiche « SYMBOLE — nom » sur une seule ligne coupée par « … » (une seule valeur dans le champ, rien ne se superpose) ;
 * quand la liste s'ouvre, le champ se vide pour la recherche et l'actif choisi reste lisible en grisé. Panneau dans un portail.
 */
export function AssetPicker({
  id,
  instruments,
  value,
  onChange,
  onAddCustom,
  error = false,
}: {
  id: string
  instruments: Instrument[]
  value: number | null
  onChange: (instrument: Instrument) => void
  /** Sans cette fonction, le lien « ajouter un actif personnalisé » n'est pas proposé. */
  onAddCustom?: () => void
  error?: boolean
}) {
  const t = useT()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = instruments.find((i) => i.id === value) ?? null
  const selectedLabel = selected ? `${selected.symbol}${selected.name ? ` — ${selected.name}` : ''}` : ''
  const groups = useMemo(() => searchInstruments(instruments, query), [instruments, query])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const box = useFloatingBox(inputRef, open, 320, 340)

  useEffect(() => setActive(0), [query])
  // À l'ouverture, la liste se place sur l'actif déjà choisi (et le défilement le rend visible).
  useEffect(() => {
    if (open && query === '') setActive(Math.max(flat.findIndex((i) => i.id === value), 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  // Garde l'option active visible pendant la navigation au clavier.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, listId])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (!inputRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const choose = (i: Instrument) => {
    onChange(i)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Home' && open) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && open) {
      e.preventDefault()
      setActive(Math.max(flat.length - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault() // ne pas envoyer le formulaire
      if (flat[active]) choose(flat[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation() // une boîte de dialogue autour ne se ferme pas avec la liste
      setOpen(false)
      setQuery('')
    } else if (e.key === 'Tab') {
      setOpen(false)
      setQuery('')
    }
  }

  let index = -1
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${listId}-${active}` : undefined}
        aria-invalid={error || undefined}
        autoComplete="off"
        spellCheck={false}
        className={`input truncate pr-9 ${error ? 'input-error' : ''}`}
        placeholder={open && selected ? selectedLabel : t.form.assetSearchPlaceholder}
        value={open ? query : selectedLabel}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            data-placement={box.side}
            className="popover-panel flex flex-col overflow-hidden"
            style={{ position: 'fixed', left: box.left, top: box.top, bottom: box.bottom, minWidth: box.width, maxWidth: 'min(520px, calc(100vw - 16px))', maxHeight: box.maxHeight }}
            onMouseDown={(e) => e.preventDefault()} // garde le focus dans le champ
            onClick={(e) => e.stopPropagation()}
          >
            <ul id={listId} role="listbox" aria-label={t.form.fields.asset} className="pop-scroll min-h-0 flex-1 py-1">
              {groups.map((g) => (
                <li key={g.assetClass} role="presentation">
                  <div className="caption px-3 pb-1 pt-3">{t.common.assetClasses[g.assetClass]}</div>
                  <ul role="group" aria-label={t.common.assetClasses[g.assetClass]}>
                    {g.items.map((i) => {
                      index += 1
                      const n = index
                      return (
                        <li
                          key={i.id}
                          id={`${listId}-${n}`}
                          role="option"
                          aria-selected={i.id === value}
                          className={`popover-option ${n === active ? 'is-active' : ''} ${i.id === value ? 'is-selected' : ''}`}
                          onMouseEnter={() => setActive(n)}
                          onClick={() => choose(i)}
                        >
                          <span className="w-24 shrink-0 font-semibold text-tx">{i.symbol}</span>
                          <Tooltip content={i.name}>
                            <span className="min-w-0 flex-1 truncate">{i.name}</span>
                          </Tooltip>
                          {i.id === value && (
                            <span className="shrink-0 text-tx-accent" aria-hidden="true">
                              <Icon name="check" size={16} />
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
              {flat.length === 0 && (
                <li role="presentation" className="px-4 py-4 text-sm text-tx2">{t.form.assetNoResult(query.trim())}</li>
              )}
            </ul>
            {onAddCustom && (
              <button
                type="button"
                className="shrink-0 border-t px-4 py-3 text-left text-sm text-tx-accent hover:bg-white/5"
                style={{ borderColor: 'var(--hairline)' }}
                onClick={() => {
                  setOpen(false)
                  setQuery('')
                  onAddCustom()
                }}
              >
                {t.form.addCustomAsset}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
