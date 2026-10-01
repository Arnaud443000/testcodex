import { useT } from '../../i18n'
import { parseAnalysis } from '../../lib/aiView'
import { turnErrorMessage } from '../../lib/coachView'
import { formatDateTime } from '../../lib/format'
import type { CoachTurn } from '../../types/coach'
import { Notice } from '../ui'
import { SentLog } from './SentLog'

/** Une question et sa réponse. Le texte de l'IA est affiché comme du texte, jamais comme du HTML. */
export function TurnView({ turn, onRetry, canRetry }: { turn: CoachTurn; onRetry: (question: string) => void; canRetry: boolean }) {
  const t = useT()
  const c = t.coach
  const error = turnErrorMessage(turn, { aiErrors: t.ai.errors, coachErrors: c.errors, unknownError: t.ai.unknownError })
  return (
    <div className="flex flex-col gap-3" id={`coach-turn-${turn.id}`}>
      <div className="flex justify-end">
        <p className="max-w-[75ch] whitespace-pre-wrap rounded-inner border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-relaxed" aria-label={c.turn.you}>
          {turn.question}
        </p>
      </div>
      {turn.status === 'failed' ? (
        <article className="flex flex-col gap-3 rounded-inner border p-[18px]" style={{ borderColor: 'var(--hairline)' }} aria-label={c.turn.failed}>
          <Notice level="bad" actions={canRetry ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(turn.question)}>{c.turn.retry}</button> : undefined}>
            <strong>{c.turn.failed}</strong> — {error}
          </Notice>
          <SentLog turn={turn} />
        </article>
      ) : (
        <article className="flex flex-col gap-3 rounded-inner border border-violet/35 bg-violet/[0.06] p-[18px]" aria-label={c.generated}>
          <header className="flex flex-wrap items-center gap-2">
            <span className="badge bg-violet/20 text-tx-accent">{c.generated}</span>
            {turn.provider === 'simulation' && <span className="badge badge-warn">{c.simulation}</span>}
            <span className="text-xs text-tx3">{c.turn.meta(turn.model, formatDateTime(turn.createdAt))}</span>
          </header>
          <div className="flex max-w-[75ch] flex-col gap-1.5 text-sm leading-[1.6]">
            {parseAnalysis(turn.answer ?? '').map((b, i) =>
              b.kind === 'heading' ? (
                <h3 key={i} className="caption mt-2 first:mt-0">{b.text}</h3>
              ) : b.kind === 'bullet' ? (
                <p key={i} className="flex gap-2"><span aria-hidden="true" className="text-tx3">•</span><span>{b.text}</span></p>
              ) : (
                <p key={i}>{b.text}</p>
              ),
            )}
          </div>
          {turn.unverified.length > 0 && (
            <Notice level="warn">
              <strong>{c.turn.unverifiedTitle}</strong> — {c.turn.unverified(turn.unverified.join(', '))}
            </Notice>
          )}
          <p className="text-xs leading-relaxed text-warn">{c.notAdvice}</p>
          {turn.usage && turn.usage.inputTokens > 0 && <p className="text-xs text-tx3">{c.turn.usage(turn.usage.inputTokens, turn.usage.outputTokens, turn.usage.requests)}</p>}
          <SentLog turn={turn} />
        </article>
      )}
    </div>
  )
}
