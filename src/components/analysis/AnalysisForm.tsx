import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { draftAnswers, draftOf, formatTimeOfDay, hasAnswer, instantOf, parseTimeInput, type Draft } from '../../lib/analysisView'
import type { Analysis, AnalysisInput, NewsBlock, Question } from '../../types/analysis'
import type { Tag } from '../../types/trade'
import { EmptyState } from '../EmptyState'
import { Notice } from '../ui'
import { QuestionField } from './QuestionFields'

/**
 * Formulaire d'une analyse de séance (création ou modification). Aucun chronomètre, aucun blocage : une question
 * sans réponse reste vide, et seule une analyse entièrement vide est refusée.
 */
export function AnalysisForm({
  questions,
  tags,
  news,
  day,
  tz,
  editing,
  onSubmit,
  onCancel,
}: {
  questions: Question[]
  tags: Tag[]
  news: NewsBlock | null
  /** Jour local de l'analyse (aujourd'hui, ou celui de l'analyse modifiée). */
  day: string
  tz: number
  editing: Analysis | null
  onSubmit: (input: AnalysisInput) => Promise<void>
  onCancel?: () => void
}) {
  const t = useT()
  const a = t.analysis
  const s = a.session
  const active = useMemo(() => questions.filter((q) => !q.archived).sort((x, y) => x.position - y.position || x.id - y.id), [questions])
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : {}))
  const [time, setTime] = useState(() => formatTimeOfDay(editing ? editing.createdAt : Date.now(), editing ? editing.tzOffsetMin : tz))
  const [note, setNote] = useState(editing?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ctx = useMemo(
    () => ({ setups: tags.filter((g) => g.kind === 'setup' && !g.archived), emotions: tags.filter((g) => g.kind === 'emotion' && !g.archived), news }),
    [tags, news],
  )

  if (active.length === 0) {
    return (
      <EmptyState icon="settings" title={s.noQuestionsTitle} action={<Link className="btn btn-secondary btn-sm" to="/settings#analysis">{s.editQuestions}</Link>}>
        {s.noQuestionsText}
      </EmptyState>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!hasAnswer(questions, draft)) return setError(s.empty)
    const minutes = parseTimeInput(time)
    if (minutes === null) return setError(s.timeInvalid)
    const itz = editing ? editing.tzOffsetMin : tz
    setSaving(true)
    try {
      await onSubmit({
        createdAt: instantOf(editing ? editing.day : day, minutes, itz),
        tzOffsetMin: itz,
        note: note.trim() ? note : null,
        answers: draftAnswers(questions, draft),
      })
      if (!editing) {
        setDraft({})
        setNote('')
        setTime(formatTimeOfDay(Date.now(), tz))
      }
    } catch (err) {
      setError(a.actionError(String(err instanceof Error ? err.message : err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <h2 className="text-lg font-semibold">{editing ? s.editTitle(formatTimeOfDay(editing.createdAt, editing.tzOffsetMin)) : s.formTitle}</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-tx2">{s.intro}</p>
      </div>

      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="analysis-time" className="caption">{s.time}</label>
          <input
            id="analysis-time"
            className="control h-[42px] px-3.5 tabular-nums"
            value={time}
            inputMode="numeric"
            aria-describedby="analysis-time-help"
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <p id="analysis-time-help" className="self-end pb-2 text-[13px] text-tx3">{s.timeHelp}</p>
      </div>

      {active.map((q) => (
        <QuestionField key={q.id} q={q} ctx={ctx} value={draft[q.id]} onChange={(v) => setDraft((d) => ({ ...d, [q.id]: v }))} />
      ))}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="analysis-note" className="caption">{s.note}</label>
        <textarea id="analysis-note" className="input" rows={2} value={note} placeholder={s.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && <Notice level="bad">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? s.saving : editing ? s.saveChanges : s.save}
        </button>
        {editing ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>{s.cancelEdit}</button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => { setDraft({}); setNote(''); setError(null) }}>{s.clear}</button>
        )}
        <Link className="btn-link ml-auto" to="/settings#analysis">{s.editQuestions}</Link>
      </div>
    </form>
  )
}
