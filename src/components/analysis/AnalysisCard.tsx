import { useState } from 'react'
import { useT } from '../../i18n'
import { analysisTexts, formatTimeOfDay, type Names } from '../../lib/analysisView'
import type { Analysis, Question } from '../../types/analysis'
import type { Tag } from '../../types/trade'
import { Icon } from '../Icon'

export function useNames(): Names {
  const a = useT().analysis
  return { questions: a.questions, timeframes: a.timeframes, trends: a.trends, conviction: a.convictionValue }
}

/** Une analyse enregistrée : son heure et ses réponses (les questions archivées restent lisibles). */
export function AnalysisCard({
  analysis,
  questions,
  tags,
  onEdit,
  onDelete,
  compact = false,
}: {
  analysis: Analysis
  questions: Question[]
  tags: Tag[]
  onEdit?: () => void
  onDelete?: () => Promise<void>
  compact?: boolean
}) {
  const a = useT().analysis
  const s = a.session
  const names = useNames()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const texts = analysisTexts(analysis, questions, names, tags)
  const limit = compact ? 2 : 4
  const shown = open ? texts : texts.slice(0, limit)
  const time = formatTimeOfDay(analysis.createdAt, analysis.tzOffsetMin)
  return (
    <li className="glass-card flex flex-col gap-3 px-5 py-4" aria-label={s.cardTitle(time)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold tabular-nums">{s.cardTitle(time)}</h3>
        {(onEdit || onDelete) && !confirming && (
          <div className="flex items-center gap-3">
            {onEdit && <button type="button" className="btn-link" onClick={onEdit}>{s.edit}</button>}
            {onDelete && <button type="button" className="btn-link btn-link-danger" onClick={() => setConfirming(true)}>{s.delete}</button>}
          </div>
        )}
        {confirming && onDelete && (
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-tx2">{s.deleteConfirm}</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void onDelete()}>{s.deleteYes}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>{s.cancel}</button>
          </span>
        )}
      </div>
      {texts.length === 0 ? (
        <p className="text-sm text-tx3">{s.noAnswers}</p>
      ) : (
        <dl className="flex flex-col gap-2.5">
          {shown.map((x) => (
            <div key={x.label}>
              <dt className="text-xs text-tx3">
                {x.label}
                {x.archived ? ` (${s.archivedQuestion})` : ''}
              </dt>
              <dd className="flex flex-col text-sm leading-snug">
                {x.lines.map((line, i) => (
                  <span key={i} className="whitespace-pre-line">{line}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {analysis.note && <p className="whitespace-pre-line rounded-inner px-3 py-2 text-[13px] text-tx2" style={{ background: 'var(--control)' }}>{analysis.note}</p>}
      {texts.length > limit && (
        <button type="button" className="btn-link self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`mr-1 inline-block transition ${open ? 'rotate-180' : ''}`}><Icon name="chevron" size={14} /></span>
          {open ? s.collapse : s.expand}
        </button>
      )}
    </li>
  )
}
