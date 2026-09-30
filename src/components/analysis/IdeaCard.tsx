import { useState } from 'react'
import { useT } from '../../i18n'
import { SNOOZE_CHOICES, formatDayShort, showSnoozeCount, snoozeDays, threadLine, threadOf } from '../../lib/analysisView'
import { api } from '../../lib/api'
import { formatDateTime, formatDecimal } from '../../lib/format'
import { notifyReviewChanged } from '../../lib/reviewEvents'
import type { IdeaInput, IdeaOutcome, IdeaView } from '../../types/analysis'
import type { Instrument } from '../../types/trade'
import { Icon } from '../Icon'
import { Notice, Segmented } from '../ui'
import { Select } from '../ui/Select'
import { IdeaForm } from './IdeaForm'

type Panel = null | 'complete' | 'snooze' | 'close' | 'delete' | 'edit'

const places = (v: string) => v.split('.')[1]?.length ?? 0

/** Niveau ou zone, tel que saisi (chaînes décimales : jamais un flottant). */
function levelText(idea: IdeaView, a: ReturnType<typeof useT>['analysis']['ideas']): string | null {
  const low = idea.levelLow ? formatDecimal(idea.levelLow, places(idea.levelLow)) : ''
  const high = idea.levelHigh ? formatDecimal(idea.levelHigh, places(idea.levelHigh)) : ''
  return low || high ? a.level(low, high) : null
}

/**
 * Une idée à surveiller, avec ses cinq actions (Toujours valable, Compléter, Redemander dans…, Clôturer, Supprimer),
 * son fil de notes daté et, si besoin, la mention d'ancienneté. Les règles (revue, report, ancienneté) viennent de pulse-core.
 */
export function IdeaCard({
  idea,
  tz,
  instruments,
  onChanged,
  emphasis = false,
}: {
  idea: IdeaView
  tz: number
  instruments: Instrument[]
  onChanged: () => Promise<void>
  /** Dans la revue du matin : carte plus marquée. */
  emphasis?: boolean
}) {
  const t = useT()
  const a = t.analysis.ideas
  const [panel, setPanel] = useState<Panel>(null)
  const [thread, setThread] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [body, setBody] = useState('')
  const [choice, setChoice] = useState<string>('1')
  const [custom, setCustom] = useState('')
  const [outcome, setOutcome] = useState<IdeaOutcome | null>(null)
  const [reason, setReason] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setPanel(null)
      setBody('')
      setReason('')
      notifyReviewChanged()
      await onChanged()
    } catch (e) {
      setError(t.analysis.actionError(String(e instanceof Error ? e.message : e)))
    } finally {
      setBusy(false)
    }
  }
  const open = (p: Panel) => {
    setError(null)
    setFieldError(null)
    setPanel(panel === p ? null : p)
  }
  const level = levelText(idea, a)
  const labels = { thread: a.thread, snooze: a.threadSnooze, closed: a.threadClosed, outcomes: a.outcomes }
  const entries = threadOf(idea)
  const title = `${idea.symbol}${idea.timeframes.length ? ` · ${idea.timeframes.map((f) => t.analysis.timeframes[f]).join(', ')}` : ''}`

  return (
    <li className={`glass-card flex flex-col gap-3 px-5 py-4 ${emphasis ? 'ring-1 ring-violet/40' : ''}`} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{idea.symbol}</h3>
          {idea.timeframes.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-1.5" aria-label={t.analysis.ideas.timeframes}>
              {idea.timeframes.map((f) => (
                <span key={f} className="badge badge-neutral">{t.analysis.timeframes[f]}</span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {idea.stale && <span className="badge badge-warn">{a.staleBadge}</span>}
          {idea.snoozed && idea.snoozedUntilDay && <span className="badge badge-neutral">{a.returnsOn(formatDayShort(idea.snoozedUntilDay))}</span>}
          {showSnoozeCount(idea.snoozeCount) && <span className="text-xs text-tx3">{a.snoozedTimes(idea.snoozeCount)}</span>}
        </div>
      </div>

      {idea.stale && <p className="text-[13px] font-medium text-[#F0CE8E]">{a.staleMention(idea.ageDays)}</p>}

      {panel === 'edit' ? (
        <IdeaForm
          instruments={instruments}
          idea={idea}
          onCancel={() => setPanel(null)}
          onSubmit={async (input: IdeaInput) => {
            await api.updateIdea(idea.id, input)
            setPanel(null)
            notifyReviewChanged()
            await onChanged()
          }}
        />
      ) : (
        <>
          <p className="whitespace-pre-line text-sm leading-relaxed">{idea.note}</p>
          {level && <p className="text-[13px] tabular-nums text-tx2">{level}</p>}
          {idea.invalidation && (
            <p className="text-[13px] text-tx2">
              <span className="text-tx3">{a.invalidatedBy}{' '}: </span>
              {idea.invalidation}
            </p>
          )}
          <p className="text-xs text-tx3">{a.age(idea.ageDays)}</p>
        </>
      )}

      {error && <Notice level="bad">{error}</Notice>}

      {panel === 'complete' && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`c-${idea.id}`} className="sr-only">{a.complete}</label>
          <textarea id={`c-${idea.id}`} className="input" rows={2} value={body} placeholder={a.completePlaceholder} onChange={(e) => setBody(e.target.value)} />
          {fieldError && <p role="alert" className="text-xs text-[#F5A198]">{fieldError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => (body.trim() ? void run(() => api.ideaComplete(idea.id, body, tz)) : setFieldError(a.completeEmpty))}
            >
              {a.completeSave}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>{a.cancel}</button>
          </div>
        </div>
      )}

      {panel === 'snooze' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`s-${idea.id}`} className="caption">{a.snoozeLabel}</label>
            <Select
              id={`s-${idea.id}`}
              value={choice}
              onChange={setChoice}
              className="min-w-[200px]"
              options={SNOOZE_CHOICES.map((c) => ({ value: c, label: a.snoozeChoices[c] }))}
            />
          </div>
          {choice === 'custom' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`sd-${idea.id}`} className="caption">{a.snoozeDays}</label>
              <input id={`sd-${idea.id}`} className="control h-[42px] w-[120px] px-3.5 tabular-nums" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => {
              const days = snoozeDays(choice, custom)
              if (days === null) return setFieldError(a.snoozeInvalid)
              setFieldError(null)
              void run(() => api.ideaSnooze(idea.id, days, tz))
            }}
          >
            {a.snoozeSave}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>{a.cancel}</button>
          {fieldError && <p role="alert" className="basis-full text-xs text-[#F5A198]">{fieldError}</p>}
        </div>
      )}

      {panel === 'close' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="caption" id={`o-${idea.id}`}>{a.closeTitle}</span>
            <Segmented<IdeaOutcome>
              label={a.closeTitle}
              value={outcome}
              onChange={setOutcome}
              options={(['worked', 'invalidated', 'noFollowUp'] as const).map((o) => ({ value: o, label: a.outcomes[o] }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`r-${idea.id}`} className="caption">{a.closeReason}</label>
            <input id={`r-${idea.id}`} className="control h-[42px] px-3.5" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || outcome === null} onClick={() => outcome && void run(() => api.ideaClose(idea.id, outcome, reason.trim() || null, tz))}>
              {a.closeSave}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>{a.cancel}</button>
          </div>
        </div>
      )}

      {panel === 'delete' && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-tx2">{a.deleteConfirm}</span>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void run(() => api.ideaDelete(idea.id, tz))}>{a.deleteYes}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(null)}>{a.cancel}</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run(() => api.ideaKeep(idea.id, tz))}>
          {a.keep}
        </button>
        <button type="button" className="btn-link" aria-expanded={panel === 'complete'} onClick={() => open('complete')}>{a.complete}</button>
        <button type="button" className="btn-link" aria-expanded={panel === 'snooze'} onClick={() => open('snooze')}>{a.snooze}</button>
        <button type="button" className="btn-link" aria-expanded={panel === 'close'} onClick={() => open('close')}>{a.close}</button>
        <button type="button" className="btn-link" aria-expanded={panel === 'edit'} onClick={() => open('edit')}>{a.edit}</button>
        <button type="button" className="btn-link btn-link-danger" aria-expanded={panel === 'delete'} onClick={() => open('delete')}>{a.delete}</button>
      </div>

      <div>
        <button type="button" className="btn-link" aria-expanded={thread} onClick={() => setThread(!thread)}>
          <span className={`mr-1 inline-block transition ${thread ? 'rotate-180' : ''}`}><Icon name="chevron" size={14} /></span>
          {thread ? a.threadHide : a.threadTitle(entries.length)}
        </button>
        {thread && <Thread idea={idea} labels={labels} />}
      </div>
    </li>
  )
}

/** Le fil chronologique d'une idée : chaque modification ou complément est une entrée datée, l'ancienne n'est jamais réécrite. */
export function Thread({ idea, labels }: { idea: IdeaView | { notes: IdeaView['notes'] }; labels: Parameters<typeof threadLine>[1] }) {
  const entries = [...idea.notes].sort((x, y) => x.createdAt - y.createdAt || x.id - y.id)
  return (
    <ol className="mt-2 flex flex-col gap-2 border-l pl-4" style={{ borderColor: 'var(--hairline)' }}>
      {entries.map((n) => {
        const line = threadLine(n, labels)
        return (
          <li key={n.id} className="text-[13px]">
            <p className="text-xs tabular-nums text-tx3">{formatDateTime(n.createdAt)}</p>
            <p className="font-medium">{line.title}</p>
            {line.body && <p className="whitespace-pre-line text-tx2">{line.body}</p>}
          </li>
        )
      })}
    </ol>
  )
}

