import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { aiErrorMessage, parseAnalysis, splitNotes } from '../lib/aiView'
import { formatDateTime } from '../lib/format'
import type { AiSendPreview, AiStatus, ScreenshotNote } from '../types/ai'
import { AiSendDialog } from './AiSendDialog'
import { Notice } from './ui'

/**
 * Analyse du screenshot par IA (3.5.4), dans le détail d'un trade. À la demande seulement ; le
 * résultat est un commentaire à lire, supprimable, qui ne modifie aucune statistique.
 */
export function ScreenshotAiCard({ tradeId, hasScreenshot }: { tradeId: number; hasScreenshot: boolean }) {
  const t = useT()
  const c = t.ai.card
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [notes, setNotes] = useState<ScreenshotNote[] | null>(null)
  const [preview, setPreview] = useState<AiSendPreview | null>(null)
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'running'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([api.getAiStatus(), api.listScreenshotNotes(tradeId)])
      setStatus(st)
      setNotes(list)
    } catch (e) {
      setLoadError(c.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [tradeId, c])

  useEffect(() => {
    setNotes(null)
    setError(null)
    setPreview(null)
    void reload()
  }, [reload])

  if (loadError) return <section className="glass-card px-6 py-[22px]"><div className="nt nt-bad" role="alert">{loadError}</div></section>
  if (!status || !notes) return null

  const enabled = status.settings.enabled
  const { latest, older } = splitNotes(notes)

  // Rien à montrer quand l'IA est éteinte et qu'aucun commentaire n'existe : une ligne discrète suffit.
  if (!enabled && !latest) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-inner border px-[22px] py-3.5 text-[13px]" style={{ borderColor: 'var(--hairline)' }} aria-label={c.title}>
        <span className="text-tx2"><strong className="text-tx">{c.offTitle}</strong> — {c.offText}</span>
        <Link to="/settings#ia" className="btn-link">{c.openSettings}</Link>
      </section>
    )
  }

  const ask = async () => {
    setError(null)
    setPhase('preparing')
    try {
      setPreview(await api.previewScreenshotAnalysis(tradeId))
    } catch (e) {
      setError(aiErrorMessage(e, t.ai))
    } finally {
      setPhase('idle')
    }
  }
  const send = async () => {
    const firstUse = preview?.firstUse
    setPreview(null)
    setPhase('running')
    try {
      if (firstUse) await api.recordAiConsent()
      await api.analyzeScreenshot(tradeId, true)
      await reload()
    } catch (e) {
      setError(aiErrorMessage(e, t.ai))
      await reload()
    } finally {
      setPhase('idle')
    }
  }
  const remove = async (id: number) => {
    setError(null)
    try {
      await api.deleteScreenshotNote(id)
      await reload()
    } catch (e) {
      setError(aiErrorMessage(e, t.ai))
    }
  }

  const blocker = !enabled
    ? null
    : !hasScreenshot
      ? 'noScreenshot'
      : !status.vaultAvailable
        ? 'vault'
        : !status.keyStored
          ? 'noKey'
          : null
  const canRun = enabled && !blocker && phase === 'idle'

  return (
    <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="ai-card-title" aria-busy={phase !== 'idle'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ai-card-title" className="text-[15px] font-semibold">{c.title}</h2>
          <p className="mt-0.5 text-[13px] text-tx2">{c.subtitle}</p>
        </div>
        {enabled && (
          <button type="button" className={`btn ${latest ? 'btn-secondary' : 'btn-primary'}`} disabled={!canRun} onClick={() => void ask()}>
            {phase === 'preparing' ? c.preparing : latest ? c.rerun : c.analyze}
          </button>
        )}
      </div>

      {blocker === 'noScreenshot' && (
        <p className="flex flex-wrap items-center justify-between gap-3 text-sm text-tx2">
          {c.noScreenshot} <Link to={`/trades/${tradeId}/edit`} className="btn-link">{c.addScreenshot}</Link>
        </p>
      )}
      {blocker === 'noKey' && <Notice level="warn" actions={<Link to="/settings#ia" className="btn btn-secondary btn-sm">{c.openSettings}</Link>}>{c.noKey}</Notice>}
      {blocker === 'vault' && <Notice level="bad">{c.vaultUnavailable}</Notice>}
      {!enabled && <p className="text-[13px] text-tx3">{c.offText} <Link to="/settings#ia" className="btn-link">{c.openSettings}</Link></p>}

      {phase === 'running' && (
        <p role="status" className="flex items-center gap-2.5 text-sm text-tx2">
          <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet/40 border-t-violet" />
          {c.running}
        </p>
      )}
      {error && <Notice level="bad">{error}</Notice>}

      {latest && <NoteView note={latest} onDelete={() => void remove(latest.id)} />}
      {older.length > 0 && (
        <details className="rounded-inner border px-[18px] py-3" style={{ borderColor: 'var(--hairline)' }}>
          <summary className="cursor-pointer text-sm font-semibold">{c.older(older.length)}</summary>
          <div className="mt-3 flex flex-col gap-4">
            {older.map((n) => (
              <NoteView key={n.id} note={n} onDelete={() => void remove(n.id)} />
            ))}
          </div>
        </details>
      )}

      {preview && <AiSendDialog preview={preview} onSend={() => void send()} onCancel={() => setPreview(null)} />}
    </section>
  )
}

function NoteView({ note, onDelete }: { note: ScreenshotNote; onDelete: () => void }) {
  const t = useT()
  const c = t.ai.card
  const [confirm, setConfirm] = useState(false)
  const sent = note.sent.map((k) => t.ai.dialog.fields[k]?.toLowerCase() ?? k)
  return (
    <article className="flex flex-col gap-3 rounded-inner border border-violet/35 bg-violet/[0.06] p-[18px]" aria-label={c.generated}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-violet/20 text-tx-accent">{c.generated}</span>
          {note.provider === 'simulation' && <span className="badge badge-warn">{c.simulation}</span>}
          <span className="text-xs text-tx3">{c.meta(note.model, formatDateTime(note.createdAt))}</span>
        </div>
        {!confirm && (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>{c.delete}</button>
        )}
      </header>
      {confirm && (
        <div className="nt nt-bad flex-col" role="alertdialog" aria-label={c.delete}>
          <p>{c.confirmDelete}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>{c.confirmDeleteYes}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>{t.common.cancel}</button>
          </div>
        </div>
      )}
      <div className="flex max-w-[75ch] flex-col gap-1.5 text-sm leading-[1.6]">
        {parseAnalysis(note.content).map((b, i) =>
          b.kind === 'heading' ? (
            <h3 key={i} className="caption mt-2 first:mt-0">{b.text}</h3>
          ) : b.kind === 'bullet' ? (
            <p key={i} className="flex gap-2"><span aria-hidden="true" className="text-tx3">•</span><span>{b.text}</span></p>
          ) : (
            <p key={i}>{b.text}</p>
          ),
        )}
      </div>
      <p className="text-xs text-tx3">{sent.length ? c.sent(sent.join(', ')) : c.sentImageOnly}</p>
      <p className="text-xs leading-relaxed text-warn">{c.disclaimer}</p>
    </article>
  )
}
