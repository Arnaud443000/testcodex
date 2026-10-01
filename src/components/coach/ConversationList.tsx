import { useState } from 'react'
import { useT } from '../../i18n'
import { formatDateTime } from '../../lib/format'
import type { ConversationSummary } from '../../types/coach'

/** Liste des conversations, les plus récentes d'abord ; « Tout supprimer » demande une confirmation. */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNew,
  onDeleteAll,
}: {
  conversations: ConversationSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onDeleteAll: () => void
}) {
  const t = useT()
  const l = t.coach.list
  const [confirm, setConfirm] = useState(false)
  return (
    <nav className="glass-card flex flex-col gap-3 self-start px-4 py-[18px]" aria-labelledby="coach-list-title">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="coach-list-title" className="text-[15px] font-semibold">{l.title}</h2>
      </div>
      <button type="button" className={`btn btn-sm ${selectedId == null ? 'btn-primary' : 'btn-secondary'}`} onClick={onNew} aria-pressed={selectedId == null}>
        + {l.new}
      </button>
      {conversations.length === 0 ? (
        <p className="px-1 text-[13px] text-tx3">{l.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selectedId ? 'true' : undefined}
                className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition ${
                  c.id === selectedId ? 'bg-gradient-to-br from-blue/30 to-violet/20 text-white' : 'text-tx2 hover:bg-white/5 hover:text-tx'
                }`}
              >
                <span className="line-clamp-2 text-sm font-medium">{c.title}</span>
                <span className="text-xs text-tx3">
                  {formatDateTime(c.updatedAt)} · {l.turns(c.turnCount)}
                  {c.readOnly ? ` · ${l.readOnly}` : c.full ? ` · ${l.full}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {conversations.length > 0 &&
        (confirm ? (
          <div className="nt nt-bad flex-col" role="alertdialog" aria-label={l.deleteAll}>
            <p>{l.confirmDeleteAll(conversations.length)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-danger btn-sm" onClick={() => { setConfirm(false); onDeleteAll() }}>{l.confirmDeleteAllYes}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>{t.common.cancel}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>{l.deleteAll}</button>
        ))}
    </nav>
  )
}
