import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { catalogView, EMOTION_NAME_MAX, myList, nameProblem, removalChoice, type NameProblem } from '../lib/emotionList'
import type { EmotionCatalogGroup, EmotionUsage, Tag } from '../types/trade'

/**
 * « Ma liste » d'émotions (lot 30) : les émotions proposées par défaut dans le formulaire de trade.
 * Partagé entre le formulaire et Paramètres. Retirer = archiver (jamais une suppression de l'historique) ;
 * la suppression définitive n'est proposée que pour une émotion jamais utilisée.
 * Le menu déroulant n'est pas utilisé : le lot 29 remplacera les sélecteurs, ce composant n'en a pas.
 */
export function EmotionListPanel({
  tags,
  onAdd,
  onRemove,
  onDelete,
  catalogOpenAtStart = false,
}: {
  /** Tous les tags (archivés compris) : le panneau ne garde que les émotions. */
  tags: Tag[]
  onAdd: (name: string) => Promise<Tag>
  onRemove: (tagId: number) => Promise<Tag>
  onDelete: (tagId: number) => Promise<void>
  catalogOpenAtStart?: boolean
}) {
  const t = useT()
  const tx = t.emotions
  const [catalog, setCatalog] = useState<EmotionCatalogGroup[]>([])
  const [usage, setUsage] = useState<EmotionUsage[]>([])
  const [catalogOpen, setCatalogOpen] = useState(catalogOpenAtStart)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<NameProblem | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadUsage = useCallback(() => api.getEmotionUsage().then(setUsage).catch(() => setUsage([])), [])
  useEffect(() => {
    api.getEmotionCatalog().then(setCatalog).catch((e) => setError(tx.loadError(String(e instanceof Error ? e.message : e))))
    void reloadUsage()
  }, [reloadUsage, tx])

  const list = myList(tags)
  const view = catalogView(catalog, tags)

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setStatus(done)
      await reloadUsage()
    } catch (e) {
      setStatus(null)
      setError(tx.errServer(String(e instanceof Error ? e.message : e).replace(/^invalid input: /, '')))
    } finally {
      setBusy(false)
    }
  }

  const addSuggestion = (name: string, restored: boolean) =>
    void run(async () => void (await onAdd(name)), restored ? tx.restoredStatus(name) : tx.addedStatus(name))

  // Pas de <form> : le panneau vit dans le formulaire de trade, et un formulaire imbriqué soumettrait le trade.
  const submitOther = () => {
    const p = nameProblem(draft, tags)
    setProblem(p)
    if (p) return
    const name = draft.split(/\s+/).filter(Boolean).join(' ')
    const wasRemoved = tags.some((g) => g.kind === 'emotion' && g.archived && g.name.toLowerCase() === name.toLowerCase())
    void run(async () => {
      await onAdd(name)
      setDraft('')
    }, wasRemoved ? tx.restoredStatus(name) : tx.addedStatus(name))
  }

  const problemText = (p: NameProblem) => (p === 'empty' ? tx.errEmpty : p === 'tooLong' ? tx.errTooLong(EMOTION_NAME_MAX) : tx.errInList)
  const confirmingTag = list.find((g) => g.id === confirming) ?? null
  const choice = confirmingTag ? removalChoice(confirmingTag.id, usage) : null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">{tx.myListTitle} <span className="font-normal text-tx3">({list.length})</span></h3>
        <p className="mt-1 max-w-[80ch] text-[13px] text-tx2">{tx.myListIntro}</p>
      </div>

      {list.length === 0 ? (
        <p className="rounded-inner border border-dashed px-4 py-5 text-center text-sm text-tx2" style={{ borderColor: 'var(--glass-border)' }}>
          {tx.empty}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={tx.myListTitle}>
          {list.map((g) => {
            const n = usage.find((u) => u.tagId === g.id)?.tradeCount ?? 0
            return (
              <li key={g.id} className="chip chip-static !gap-2.5">
                <span>{g.name}</span>
                <span className="text-[11px] text-tx3">{tx.tradesCount(n)}</span>
                <button
                  type="button"
                  className="btn-link !text-[12px]"
                  aria-label={tx.removeLabel(g.name)}
                  aria-expanded={confirming === g.id}
                  disabled={busy}
                  onClick={() => setConfirming(confirming === g.id ? null : g.id)}
                >
                  {tx.remove}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {confirmingTag && choice && (
        <div role="group" aria-label={tx.removeTitle(confirmingTag.name)} className="nt nt-warn flex flex-col gap-2.5">
          <p className="text-sm font-semibold">{tx.removeTitle(confirmingTag.name)}</p>
          <p className="text-[13px]">{tx.removeExplain}</p>
          <p className="text-[13px]">{choice.canDelete ? tx.deleteExplain : tx.onlyRemove(choice.tradeCount)}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                const { id, name } = confirmingTag
                setConfirming(null)
                void run(async () => void (await onRemove(id)), tx.removedStatus(name))
              }}
            >
              {tx.removeConfirm}
            </button>
            {choice.canDelete && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => {
                  const { id, name } = confirmingTag
                  setConfirming(null)
                  void run(() => onDelete(id), tx.deletedStatus(name))
                }}
              >
                {tx.deleteForever}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(null)}>
              {tx.cancel}
            </button>
          </div>
        </div>
      )}

      <div>
        <button type="button" className="btn btn-secondary btn-sm" aria-expanded={catalogOpen} onClick={() => setCatalogOpen((o) => !o)}>
          {catalogOpen ? tx.closeCatalog : tx.addButton}
        </button>
      </div>

      {catalogOpen && (
        <div id="emotions-catalogue" className="flex flex-col gap-4 rounded-inner border p-4" style={{ borderColor: 'var(--glass-border)' }}>
          <div>
            <h4 className="text-sm font-semibold">{tx.catalogTitle}</h4>
            <p className="mt-1 text-[13px] text-tx2">{tx.catalogIntro}</p>
          </div>
          {view.map((g) => (
            <div key={g.key} role="group" aria-label={g.label} className="flex flex-col gap-2">
              <p className="caption">{g.label}</p>
              <div className="flex flex-wrap gap-2">
                {g.entries.map((e) =>
                  e.state === 'inList' ? (
                    <span key={e.name} className="chip chip-static !gap-1.5 opacity-70" aria-label={`${e.name} — ${tx.inList}`}>
                      <span aria-hidden="true">✓ </span>
                      {e.name}
                    </span>
                  ) : (
                    <button
                      key={e.name}
                      type="button"
                      className="chip"
                      disabled={busy}
                      aria-label={e.state === 'archived' ? tx.restoreLabel(e.name) : tx.add(e.name)}
                      title={e.state === 'archived' ? tx.restore : undefined}
                      onClick={() => addSuggestion(e.name, e.state === 'archived')}
                    >
                      + {e.name}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <span className="caption">{tx.otherTitle}</span>
            <div className="flex flex-wrap items-start gap-2">
              <input
                className="input !h-[36px] w-[240px]"
                aria-label={tx.otherLabel}
                aria-invalid={problem !== null}
                placeholder={tx.otherPlaceholder}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setProblem(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitOther()
                  }
                }}
              />
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={submitOther}>
                {tx.otherAdd}
              </button>
            </div>
            {problem && <p role="alert" className="text-xs text-[#F5A198]">{problemText(problem)}</p>}
          </div>
        </div>
      )}

      <p role="status" className="text-[13px] text-tx2 empty:hidden">{status}</p>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
    </div>
  )
}
