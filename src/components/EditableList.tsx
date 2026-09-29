import { useState, type FormEvent } from 'react'
import { useT } from '../i18n'

export interface EditableItem {
  id: number
  text: string
  archived: boolean
}

/**
 * Liste de textes courts que l'on peut créer, renommer et archiver (règles personnelles,
 * éléments de checklist). Jamais de suppression : l'archivage garde l'historique des trades.
 */
export function EditableList({
  title,
  intro,
  placeholder,
  emptyText,
  addLabel,
  inputLabel,
  items,
  onCreate,
  onRename,
  onArchive,
}: {
  title: string
  intro: string
  placeholder: string
  emptyText: string
  addLabel: string
  inputLabel: string
  items: EditableItem[]
  onCreate: (text: string) => Promise<void>
  onRename: (id: number, text: string) => Promise<void>
  onArchive: (id: number, archived: boolean) => Promise<void>
}) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(t.settings.list.errSave(String(e instanceof Error ? e.message : e)))
    } finally {
      setBusy(false)
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return setError(t.settings.list.errRequired)
    void run(async () => {
      await onCreate(draft)
      setDraft('')
    })
  }
  const saveEdit = (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    if (!editing.text.trim()) return setError(t.settings.list.errRequired)
    void run(async () => {
      await onRename(editing.id, editing.text)
      setEditing(null)
    })
  }

  const archivedCount = items.filter((i) => i.archived).length
  const visible = items.filter((i) => showArchived || !i.archived)

  return (
    <section className="glass-card p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mb-4 mt-1 max-w-[80ch] text-sm text-tx2">{intro}</p>
      {visible.length === 0 ? (
        <p className="mb-4 rounded-inner border border-dashed px-4 py-5 text-center text-sm text-tx2" style={{ borderColor: 'var(--glass-border)' }}>
          {emptyText}
        </p>
      ) : (
        <ul className="mb-4 divide-y" style={{ borderColor: 'var(--hairline)' }}>
          {visible.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              {editing?.id === item.id ? (
                <form onSubmit={saveEdit} className="flex flex-1 items-center gap-2">
                  <input
                    className="input !h-[36px] flex-1"
                    aria-label={t.settings.list.editLabel}
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t.settings.list.save}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>{t.settings.list.cancel}</button>
                </form>
              ) : (
                <>
                  <span className={`flex items-center gap-3 ${item.archived ? 'text-tx3' : ''}`}>
                    {item.text}
                    {item.archived && <span className="badge badge-neutral">{t.settings.list.archivedBadge}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    {!item.archived && (
                      <button type="button" className="btn-link" onClick={() => setEditing({ id: item.id, text: item.text })}>
                        {t.settings.list.rename}
                      </button>
                    )}
                    <button type="button" className="btn-link" disabled={busy} onClick={() => void run(() => onArchive(item.id, !item.archived))}>
                      {item.archived ? t.settings.list.restore : t.settings.list.archive}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="caption">{inputLabel}</span>
          <input className="input" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{addLabel}</button>
      </form>
      {archivedCount > 0 && (
        <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-tx2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t.settings.list.showArchived} ({archivedCount})
        </label>
      )}
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
