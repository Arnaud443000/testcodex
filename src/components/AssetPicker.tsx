import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { searchInstruments } from '../lib/assetSearch'
import type { Instrument } from '../types/trade'
import { Icon } from './Icon'

/** Sélecteur d'actif avec recherche (symbole ou nom), résultats groupés par classe, utilisable au clavier. */
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
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = instruments.find((i) => i.id === value) ?? null
  const groups = useMemo(() => searchInstruments(instruments, query), [instruments, query])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  useEffect(() => setActive(0), [query])
  // Garde l'option active visible pendant la navigation au clavier.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, listId])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
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
      setOpen(false)
    }
  }

  let index = -1
  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${listId}-${active}` : undefined}
        aria-invalid={error || undefined}
        autoComplete="off"
        className={`input pr-9 ${error ? 'input-error' : ''}`}
        placeholder={selected ? `${selected.symbol}${selected.name ? ` · ${selected.name}` : ''}` : t.form.assetSearchPlaceholder}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {selected && !query && !open && (
        // Le symbole choisi reste lisible comme valeur, pas comme simple placeholder grisé.
        <span className="pointer-events-none absolute inset-y-0 left-4 right-9 flex items-center gap-2 truncate text-sm text-tx">
          <span className="font-semibold">{selected.symbol}</span>
          {selected.name && <span className="truncate text-tx2">{selected.name}</span>}
        </span>
      )}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>

      {open && (
        <div
          className="absolute left-0 right-0 z-30 mt-2 flex max-h-80 min-w-[340px] flex-col overflow-hidden rounded-inner border shadow-card"
          style={{ borderColor: 'var(--hairline)', background: '#12163A' }}
        >
          <ul id={listId} role="listbox" aria-label={t.form.fields.asset} className="min-h-0 flex-1 overflow-y-auto py-1">
            {groups.map((g) => (
              <li key={g.assetClass} role="presentation">
                <div className="caption px-4 pb-1 pt-3">{t.common.assetClasses[g.assetClass]}</div>
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
                        className={`flex cursor-pointer items-baseline gap-3 px-4 py-2 text-sm ${n === active ? 'bg-white/10' : ''}`}
                        onMouseEnter={() => setActive(n)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(i)}
                      >
                        <span className="w-24 shrink-0 font-semibold text-tx">{i.symbol}</span>
                        <span className="min-w-0 flex-1 truncate text-tx2">{i.name}</span>
                        {i.id === value && <span className="text-tx-accent" aria-hidden="true">✓</span>}
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
              className="border-t px-4 py-3 text-left text-sm text-tx-accent hover:bg-white/5"
              style={{ borderColor: 'var(--hairline)' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                onAddCustom()
              }}
            >
              {t.form.addCustomAsset}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
