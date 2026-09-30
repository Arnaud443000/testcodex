import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { Notice } from '../ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { formatDayLong } from '../../lib/analysisView'
import { formatDateTime } from '../../lib/format'
import { useReferenceData } from '../../lib/referenceData'
import { useLocalDay } from '../../lib/useLocalDay'
import type { Analysis, IdeaView, Question } from '../../types/analysis'
import { AnalysisCard } from './AnalysisCard'
import { Thread } from './IdeaCard'
import { ReportBox } from './ReportBox'

const LIMIT = 200

function ClosedIdea({ idea }: { idea: IdeaView }) {
  const a = useT().analysis.ideas
  const [open, setOpen] = useState(false)
  const labels = { thread: a.thread, snooze: a.threadSnooze, closed: a.threadClosed, outcomes: a.outcomes }
  const tone = idea.outcome === 'worked' ? 'badge-gain' : idea.outcome === 'invalidated' ? 'badge-loss' : 'badge-neutral'
  return (
    <li className="glass-card flex flex-col gap-2 px-5 py-4" aria-label={idea.symbol}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{idea.symbol}</h3>
        <div className="flex items-center gap-3">
          {idea.outcome && <span className={`badge ${tone}`}>{a.outcomes[idea.outcome]}</span>}
          {idea.closedAt !== null && <span className="text-xs tabular-nums text-tx3">{a.closedOn(formatDateTime(idea.closedAt))}</span>}
        </div>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{idea.note}</p>
      <div>
        <button type="button" className="btn-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`mr-1 inline-block transition ${open ? 'rotate-180' : ''}`}><Icon name="chevron" size={14} /></span>
          {open ? a.threadHide : a.threadTitle(idea.notes.length)}
        </button>
        {open && <Thread idea={idea} labels={labels} />}
      </div>
    </li>
  )
}

function DayGroup({ day, items, questions, tags }: { day: string; items: Analysis[]; questions: Question[]; tags: ReturnType<typeof useReferenceData>['allTags'] }) {
  const a = useT().analysis
  const [open, setOpen] = useState(false)
  return (
    <section className="glass-card px-5 py-3">
      <button type="button" className="flex min-h-[32px] w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="text-sm font-semibold first-letter:uppercase">{a.archives.dayHeading(formatDayLong(day), items.length)}</span>
        <span className={`text-tx3 transition ${open ? 'rotate-180' : ''}`}><Icon name="chevron" size={16} /></span>
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((x) => (
            <AnalysisCard key={x.id} analysis={x} questions={questions} tags={tags} compact />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Onglet « Archives » : le constat, les idées clôturées, et les analyses passées, jour par jour (repliées). */
export function ArchivesTab() {
  const t = useT()
  const a = t.analysis
  const { day, tz } = useLocalDay()
  const ref = useReferenceData()
  const [closed, setClosed] = useState<IdeaView[] | null>(null)
  const [past, setPast] = useState<Analysis[] | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [c, p, q] = await Promise.all([api.listIdeas('closed', null, tz), api.listAnalysesBefore(day, LIMIT), api.getAnalysisQuestions(true)])
      setClosed(c)
      setPast(p)
      setQuestions(q)
      setError(null)
    } catch (e) {
      setError(a.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [day, tz, a])
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <Notice level="bad">{error}</Notice>
  if (!closed || !past || ref.loading) return <p className="text-sm text-tx3" role="status">…</p>

  const days = [...new Set(past.map((x) => x.day))]
  return (
    <div className="flex flex-col gap-6">
      <ReportBox />
      <section aria-labelledby="closed-title" className="flex flex-col gap-3">
        <h2 id="closed-title" className="text-base font-semibold">{a.archives.closedTitle}</h2>
        {closed.length === 0 ? (
          <div className="glass-card">
            <EmptyState icon="library" title={a.archives.closedEmptyTitle}>{a.archives.closedEmptyText}</EmptyState>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">{closed.map((i) => <ClosedIdea key={i.id} idea={i} />)}</ul>
        )}
      </section>
      <section aria-labelledby="past-title" className="flex flex-col gap-3">
        <h2 id="past-title" className="text-base font-semibold">{a.archives.pastTitle}</h2>
        {past.length === 0 ? (
          <div className="glass-card">
            <EmptyState icon="analysis" title={a.archives.pastEmptyTitle}>{a.archives.pastEmptyText}</EmptyState>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {days.map((d) => (
              <DayGroup key={d} day={d} items={past.filter((x) => x.day === d)} questions={questions} tags={ref.allTags} />
            ))}
            {past.length >= LIMIT && <p className="text-[13px] text-tx3">{a.archives.truncated(LIMIT)}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
