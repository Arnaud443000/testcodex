import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from '../EmptyState'
import { Notice } from '../ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { dayOfInstant } from '../../lib/analysisView'
import { useLocalDay } from '../../lib/useLocalDay'
import { useReferenceData } from '../../lib/referenceData'
import type { Analysis, AnalysisInput, NewsBlock, Question } from '../../types/analysis'
import { AnalysisCard } from './AnalysisCard'
import { AnalysisForm } from './AnalysisForm'

/** Onglet « Séance » : le formulaire du jour, et les analyses d'aujourd'hui (puis d'hier) avec leur heure. */
export function SessionTab() {
  const t = useT()
  const a = t.analysis
  const s = a.session
  const { day, tz } = useLocalDay()
  const ref = useReferenceData()
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [news, setNews] = useState<NewsBlock | null>(null)
  const [today, setToday] = useState<Analysis[] | null>(null)
  const [yesterday, setYesterday] = useState<Analysis[]>([])
  const [editing, setEditing] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const yesterdayKey = dayOfInstant(Date.parse(`${day}T12:00:00Z`) - 86_400_000, 0)
    try {
      const [q, n, td, yd] = await Promise.all([api.getAnalysisQuestions(true), api.getNewsBlock(null), api.listAnalysesOfDay(day), api.listAnalysesOfDay(yesterdayKey)])
      setQuestions(q)
      setNews(n)
      setToday(td)
      setYesterday(yd)
      setError(null)
    } catch (e) {
      setError(a.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [day, a])
  useEffect(() => {
    void load()
  }, [load])

  const save = async (input: AnalysisInput) => {
    if (editing) await api.updateAnalysis(editing.id, input)
    else await api.createAnalysis(input)
    setEditing(null)
    setSavedNote(true)
    await load()
    // Le formulaire est long : après l'enregistrement, on ramène la liste du jour (avec la nouvelle analyse) à l'écran.
    setTimeout(() => document.getElementById('today-title')?.scrollIntoView({ block: 'start' }), 0)
  }
  const remove = async (id: number) => {
    try {
      await api.deleteAnalysis(id)
      if (editing?.id === id) setEditing(null)
      await load()
    } catch (e) {
      setError(a.actionError(String(e instanceof Error ? e.message : e)))
    }
  }
  const edit = (x: Analysis) => {
    setEditing(x)
    setSavedNote(false)
    setTimeout(() => formRef.current?.scrollIntoView({ block: 'start' }), 0)
  }

  if (error) return <Notice level="bad">{error}</Notice>
  if (!questions || !today || ref.loading) return <p className="text-sm text-tx3" role="status">…</p>

  const list = (items: Analysis[]) => (
    <ul className="flex flex-col gap-3">
      {items.map((x) => (
        <AnalysisCard key={x.id} analysis={x} questions={questions} tags={ref.allTags} onEdit={() => edit(x)} onDelete={() => remove(x.id)} />
      ))}
    </ul>
  )

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div ref={formRef} className="glass-card scroll-mt-4 p-6">
        <AnalysisForm
          key={editing ? `edit-${editing.id}` : `new-${day}`}
          questions={questions}
          tags={ref.allTags}
          news={news}
          day={day}
          tz={tz}
          editing={editing}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
        {savedNote && !editing && <div className="mt-4"><Notice level="ok">{s.saved}</Notice></div>}
      </div>

      <div className="flex flex-col gap-5">
        <section aria-labelledby="today-title" className="flex flex-col gap-3">
          <h2 id="today-title" className="scroll-mt-4 text-base font-semibold">
            {s.todayTitle} <span className="ml-1 text-sm font-normal text-tx3">{today.length > 0 ? s.count(today.length) : ''}</span>
          </h2>
          {today.length === 0 ? (
            <div className="glass-card">
              <EmptyState icon="analysis" title={s.emptyTitle}>{s.emptyText}</EmptyState>
            </div>
          ) : (
            list(today)
          )}
        </section>
        {yesterday.length > 0 && (
          <section aria-labelledby="yesterday-title" className="flex flex-col gap-3">
            <h2 id="yesterday-title" className="text-base font-semibold">{s.yesterdayTitle}</h2>
            {list(yesterday)}
            <p className="text-[13px] text-tx3">{s.olderHint}</p>
          </section>
        )}
      </div>
    </div>
  )
}
