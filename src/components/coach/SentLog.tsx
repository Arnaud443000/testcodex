import { useT } from '../../i18n'
import { prettyJson, toolLabel } from '../../lib/coachView'
import type { CoachTurn } from '../../types/coach'
import { Notice } from '../ui'

const pre = 'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-white/5 px-3 py-2 font-mono text-[12px] leading-relaxed text-tx2'

/** Journal local « données envoyées » d'un tour : exactement ce qui a quitté l'ordinateur (lot 21). */
export function SentLog({ turn }: { turn: CoachTurn }) {
  const t = useT()
  const s = t.coach.sent
  const log = turn.sent
  return (
    <details className="rounded-inner border px-[18px] py-3 text-[13px]" style={{ borderColor: 'var(--hairline)' }}>
      <summary className="cursor-pointer font-semibold text-tx2">{s.summary(log.toolCalls.length)}</summary>
      <div className="mt-3 flex flex-col gap-3">
        {turn.status === 'failed' && <p className="text-warn">{s.failedNote}</p>}
        <p className="text-tx3">{s.provider(log.provider, log.model)}</p>
        <div className="flex flex-col gap-1">
          <span className="caption">{s.question}</span>
          <blockquote className="whitespace-pre-wrap rounded-sm bg-white/5 px-3 py-2 leading-relaxed">{log.question}</blockquote>
        </div>
        <div className="flex flex-col gap-1">
          <span className="caption">{s.context}</span>
          <code className="rounded-sm bg-white/5 px-3 py-2 font-mono text-[12px] text-tx2">{log.context}</code>
        </div>
        <p className="text-tx2">{s.history(log.historyTurns)}</p>
        <p className="text-tx3">{s.fixed}</p>
        {log.limitReached && <Notice level="warn">{s.limitReached}</Notice>}
        {log.toolCalls.length === 0 ? (
          <p className="text-tx2">{s.noTool}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {log.toolCalls.map((c, i) => (
              <li key={i}>
                <details className="rounded-sm border px-3 py-2" style={{ borderColor: 'var(--hairline)' }}>
                  <summary className="cursor-pointer">
                    <span className="font-medium text-tx">{toolLabel(c.name, t.coach.tools)}</span>{' '}
                    <code className="font-mono text-[12px] text-tx3">{c.name}</code>
                    {c.isError && <span className="badge badge-warn ml-2">{s.error}</span>}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <span className="caption">{s.params}</span>
                    <pre className={pre}>{prettyJson(c.input)}</pre>
                    <span className="caption">{c.isError ? s.error : s.result}</span>
                    <pre className={pre}>{prettyJson(c.output)}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}
