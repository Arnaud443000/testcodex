import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useAccounts } from '../lib/accounts'
import { canSend, coachBlocker, coachErrorMessage, isClosed, questionLength, toolLabel } from '../lib/coachView'
import { localTzOffsetMin } from '../lib/period'
import type { CoachStatus, Conversation, ConversationSummary } from '../types/coach'
import { PageHeader } from '../components/PageHeader'
import { Notice } from '../components/ui'
import { CoachConsentDialog } from '../components/coach/CoachConsentDialog'
import { ConversationList } from '../components/coach/ConversationList'
import { TurnView } from '../components/coach/TurnView'

/**
 * Coach IA conversationnel (3.5.5, lot 21) : optionnel, à la demande. L'IA ne calcule rien : elle appelle
 * des outils locaux en lecture seule qui renvoient les chiffres de pulse-core. Rien ne part avant
 * « Envoyer » ; ce qui part est montré sous chaque réponse (« Données envoyées »).
 */
export function CoachPage() {
  const t = useT()
  const c = t.coach
  const { selectedId: accountId } = useAccounts()
  const [status, setStatus] = useState<CoachStatus | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const errTexts = { aiErrors: t.ai.errors, coachErrors: c.errors, unknownError: t.ai.unknownError }

  const reloadList = useCallback(async () => {
    const [st, list] = await Promise.all([api.getCoachStatus(), api.listCoachConversations()])
    setStatus(st)
    setConversations(list)
  }, [])

  useEffect(() => {
    reloadList().catch((e) => setLoadError(c.loadError(String(e instanceof Error ? e.message : e))))
  }, [reloadList, c])

  useEffect(() => {
    setConfirmDelete(false)
    setRenaming(null)
    if (selectedId == null) {
      setConversation(null)
      return
    }
    api.getCoachConversation(selectedId).then(setConversation, (e) => setError(coachErrorMessage(e, errTexts)))
    // errTexts est recréé à chaque rendu mais ne dépend que de textes constants : seul selectedId compte.
  }, [selectedId])

  useEffect(() => {
    if (pending || conversation) endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [pending, conversation])

  if (loadError) return <div className="nt nt-bad" role="alert">{loadError}</div>
  if (!status) return null

  const blocker = coachBlocker(status)
  const summary = conversations.find((x) => x.id === selectedId) ?? null
  const closed = isClosed(summary)
  const max = status.limits.maxQuestionChars
  const busy = pending != null
  const sendable = canSend(question, max, { busy, blocked: blocker != null, closed })

  const send = async (q: string) => {
    setError(null)
    setNotice(null)
    setPending(q.trim())
    try {
      const turn = await api.askCoach({
        conversationId: selectedId,
        question: q,
        accountIds: accountId == null ? [] : [accountId],
        tzOffsetMin: localTzOffsetMin(),
        confirmed: true,
      })
      setQuestion('')
      await reloadList()
      if (turn.conversationId === selectedId) setConversation(await api.getCoachConversation(turn.conversationId))
      else setSelectedId(turn.conversationId)
    } catch (e) {
      setError(coachErrorMessage(e, errTexts))
      await reloadList().catch(() => undefined)
    } finally {
      setPending(null)
    }
  }
  const submit = () => {
    if (!sendable) return
    if (status.consentAt == null) setConsentOpen(true)
    else void send(question)
  }
  const accept = async () => {
    setConsentOpen(false)
    try {
      setStatus(await api.recordCoachConsent())
      await send(question)
    } catch (e) {
      setError(coachErrorMessage(e, errTexts))
    }
  }
  const rename = async () => {
    if (selectedId == null || renaming == null) return
    try {
      await api.renameCoachConversation(selectedId, renaming)
      setRenaming(null)
      await reloadList()
    } catch (e) {
      setError(coachErrorMessage(e, errTexts))
    }
  }
  const remove = async () => {
    if (selectedId == null) return
    try {
      await api.deleteCoachConversation(selectedId)
      setSelectedId(null)
      await reloadList()
    } catch (e) {
      setError(coachErrorMessage(e, errTexts))
    }
  }
  const removeAll = async () => {
    try {
      await api.deleteAllCoachConversations()
      setSelectedId(null)
      setNotice(c.list.deletedAll)
      await reloadList()
    } catch (e) {
      setError(coachErrorMessage(e, errTexts))
    }
  }

  const blockedTexts = {
    disabled: [c.blocked.disabledTitle, c.blocked.disabled],
    vault: [c.blocked.vaultTitle, c.blocked.vault],
    noKey: [c.blocked.noKeyTitle, c.blocked.noKey],
  } as const

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={c.title}
        subtitle={c.subtitle}
        actions={status.provider === 'simulation' ? <span className="badge badge-warn" title={c.simulationHint}>{c.simulation}</span> : undefined}
      />

      {/* Rappel permanent de ce qui part (et ne part jamais). */}
      <section className="glass-card flex flex-col gap-2 px-6 py-[18px] text-[13px] leading-relaxed" aria-labelledby="coach-reminder-title">
        <h2 id="coach-reminder-title" className="caption">{c.reminder.title}</h2>
        <p className="text-tx2">{c.reminder.sent}</p>
        <p className="text-tx2">{c.reminder.never}</p>
        <p className="text-tx2">{c.reminder.to(status.providerHost, status.model)} <strong className="font-medium text-tx">{c.reminder.notAutomatic}</strong></p>
        <p className="text-warn">{c.generated} · {c.notAdvice}</p>
        <details>
          <summary className="cursor-pointer font-medium text-tx-accent">{c.reminder.toolsSummary(status.tools.length)}</summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {status.tools.map((tool) => (
              <li key={tool.name} className="text-tx2">
                <span className="font-medium text-tx">{toolLabel(tool.name, c.tools)}</span> — {tool.description}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onNew={() => setSelectedId(null)}
          onDeleteAll={() => void removeAll()}
        />

        <section className="glass-card flex min-w-0 flex-col gap-5 px-6 py-[22px]" aria-labelledby="coach-chat-title" aria-busy={busy}>
          <header className="flex flex-wrap items-center justify-between gap-3">
            {renaming != null ? (
              <form className="flex flex-1 flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename() }}>
                <label className="sr-only" htmlFor="coach-rename">{c.conversation.renameLabel}</label>
                <input id="coach-rename" className="input max-w-md flex-1" value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-sm">{c.conversation.save}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(null)}>{t.common.cancel}</button>
              </form>
            ) : (
              <h2 id="coach-chat-title" className="text-[15px] font-semibold">{summary?.title ?? c.list.new}</h2>
            )}
            {summary && renaming == null && (
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(summary.title)}>{c.conversation.rename}</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>{c.conversation.delete}</button>
              </div>
            )}
          </header>
          {confirmDelete && (
            <div className="nt nt-bad flex-col" role="alertdialog" aria-label={c.conversation.delete}>
              <p>{c.conversation.confirmDelete}</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()}>{c.conversation.confirmDeleteYes}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</button>
              </div>
            </div>
          )}
          {notice && <Notice level="ok">{notice}</Notice>}

          {selectedId == null && !busy && (
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold">{c.empty.title}</h3>
              <p className="max-w-[75ch] text-sm leading-relaxed text-tx2">{c.empty.text}</p>
              <div className="flex flex-wrap gap-2">
                {c.empty.examples.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => setQuestion(ex)} disabled={blocker != null}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {conversation && conversation.id === selectedId && conversation.turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} canRetry={!closed && blocker == null && !busy} onRetry={(q) => setQuestion(q)} />
          ))}

          {pending && (
            <div className="flex flex-col gap-3">
              <div className="flex justify-end">
                <p className="max-w-[75ch] whitespace-pre-wrap rounded-inner border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-relaxed">{pending}</p>
              </div>
              <p role="status" className="flex items-center gap-2.5 text-sm text-tx2">
                <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet/40 border-t-violet" />
                {c.composer.running}
              </p>
            </div>
          )}
          <div ref={endRef} />

          {error && <Notice level="bad">{error}</Notice>}

          {blocker ? (
            <Notice level={blocker === 'vault' ? 'bad' : 'warn'} actions={<Link to="/settings#ia" className="btn btn-secondary btn-sm">{c.blocked.openSettings}</Link>}>
              <strong>{blockedTexts[blocker][0]}</strong> — {blockedTexts[blocker][1]}
            </Notice>
          ) : closed ? (
            <Notice level="warn" actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedId(null)}>{c.list.new}</button>}>
              {summary?.readOnly ? c.conversation.readOnly : c.conversation.full(status.limits.maxTurns)}
            </Notice>
          ) : (
            <form className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: 'var(--hairline)' }} onSubmit={(e) => { e.preventDefault(); submit() }}>
              <label htmlFor="coach-question" className="caption">{c.composer.label}</label>
              <textarea
                id="coach-question"
                className="input"
                rows={3}
                value={question}
                placeholder={c.composer.placeholder}
                disabled={busy}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`text-xs tabular-nums ${questionLength(question) > max ? 'text-loss' : 'text-tx3'}`}>
                  {c.composer.count(questionLength(question), max)}
                  {questionLength(question) > max && ` — ${c.composer.tooLong(max)}`}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-tx3">{c.reminder.notAutomatic}</span>
                  <button type="submit" className="btn btn-primary" disabled={!sendable}>{c.composer.send}</button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>

      {consentOpen && <CoachConsentDialog host={status.providerHost} model={status.model} onAccept={() => void accept()} onCancel={() => setConsentOpen(false)} />}
    </div>
  )
}
