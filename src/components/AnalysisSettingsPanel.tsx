import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { questionLabel } from '../lib/analysisView'
import { api } from '../lib/api'
import type { AnalysisSettings, Question, QuestionKind, Timeframe } from '../types/analysis'
import { MAX_STALE_DAYS, MIN_STALE_DAYS, TIMEFRAMES } from '../types/analysis'
import { Icon } from './Icon'
import { ChipButton, Field, Notice, Switch } from './ui'
import { Select } from './ui/Select'
import { Tooltip } from './ui/Tooltip'

const ADDABLE: QuestionKind[] = ['shortText', 'longText', 'choice', 'trend', 'conviction', 'setups', 'emotions']

const parseChoices = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

function QuestionRow({ q, first, last, run }: { q: Question; first: boolean; last: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = useT()
  const s = t.analysis.settings
  const label = questionLabel(q, t.analysis.questions)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(q.label ?? label)
  const [choices, setChoices] = useState((q.options.choices ?? []).join('\n'))
  const [problem, setProblem] = useState<string | null>(null)
  const original = !q.key.startsWith('custom_')
  const units = q.options.timeframes ?? []

  return (
    <li className="flex flex-col gap-2.5 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex shrink-0 gap-1.5">
          <Tooltip content={s.moveUp}>
            <button type="button" className="btn-icon !h-8 !w-8" aria-label={s.moveUpLabel(label)} disabled={first} onClick={() => void run(() => api.moveAnalysisQuestion(q.id, -1))}>
              <Icon name="sortUp" size={16} />
            </button>
          </Tooltip>
          <Tooltip content={s.moveDown}>
            <button type="button" className="btn-icon !h-8 !w-8" aria-label={s.moveDownLabel(label)} disabled={last} onClick={() => void run(() => api.moveAnalysisQuestion(q.id, 1))}>
              <Icon name="sortDown" size={16} />
            </button>
          </Tooltip>
        </div>
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => api.updateAnalysisQuestion(q.id, name.trim() ? name : null, null)).then(() => setRenaming(false))
            }}
          >
            <input className="control h-[38px] min-w-[220px] flex-1 px-3" value={name} aria-label={s.renameLabel(label)} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm">{s.saveName}</button>
            {original && q.label !== null && (
              <button type="button" className="btn-link" onClick={() => void run(() => api.updateAnalysisQuestion(q.id, null, null)).then(() => setRenaming(false))}>{s.resetName}</button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(false)}>{t.analysis.ideas.cancel}</button>
          </form>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{label}</p>
            <span className="badge badge-neutral">{t.analysis.kinds[q.kind]}</span>
            <button type="button" className="btn-link" onClick={() => setRenaming(true)}>{s.rename}</button>
            <button type="button" className="btn-link btn-link-danger" aria-label={s.archiveLabel(label)} onClick={() => void run(() => api.setAnalysisQuestionArchived(q.id, true))}>{s.archive}</button>
          </>
        )}
      </div>

      {q.kind === 'trend' && (
        <div className="flex flex-col gap-1.5 pl-[76px]">
          <span className="text-xs text-tx3">{s.units}</span>
          <div role="group" aria-label={s.units} className="flex flex-wrap gap-2">
            {TIMEFRAMES.map((tf) => (
              <ChipButton
                key={tf}
                on={units.includes(tf)}
                onClick={() => {
                  const next: Timeframe[] = units.includes(tf) ? units.filter((x) => x !== tf) : [...units, tf]
                  if (next.length === 0) return setProblem(s.unitsMin)
                  setProblem(null)
                  void run(() => api.updateAnalysisQuestion(q.id, q.label, { timeframes: next }))
                }}
              >
                {t.analysis.timeframes[tf]}
              </ChipButton>
            ))}
          </div>
          {problem && <p role="alert" className="text-xs text-[#F5A198]">{problem}</p>}
        </div>
      )}

      {q.kind === 'choice' && (
        <div className="flex flex-col gap-1.5 pl-[76px]">
          <label htmlFor={`ch-${q.id}`} className="text-xs text-tx3">{s.choices}</label>
          <textarea id={`ch-${q.id}`} className="input" rows={3} value={choices} onChange={(e) => setChoices(e.target.value)} />
          {problem && <p role="alert" className="text-xs text-[#F5A198]">{problem}</p>}
          <button
            type="button"
            className="btn btn-secondary btn-sm self-start"
            onClick={() => {
              const list = parseChoices(choices)
              if (list.length < 2 || list.length > 12 || new Set(list.map((c) => c.toLowerCase())).size !== list.length) return setProblem(s.choicesInvalid)
              setProblem(null)
              void run(() => api.updateAnalysisQuestion(q.id, q.label, { choices: list }))
            }}
          >
            {s.choicesSave}
          </button>
        </div>
      )}
    </li>
  )
}

/** Paramètres > « Analyse avant trading » : les questions de l'analyse (jamais supprimées, seulement désactivées) et la revue des idées. */
export function AnalysisSettingsPanel() {
  const t = useT()
  const s = t.analysis.settings
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [settings, setSettings] = useState<AnalysisSettings | null>(null)
  const [days, setDays] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [staleProblem, setStaleProblem] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newKind, setNewKind] = useState<QuestionKind>('shortText')
  const [newChoices, setNewChoices] = useState('')
  const [addProblem, setAddProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [q, st] = await Promise.all([api.getAnalysisQuestions(true), api.getAnalysisSettings()])
      setQuestions(q)
      setSettings(st)
      setDays((d) => d || String(st.staleDays))
      setError(null)
    } catch (e) {
      setError(s.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [s])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await load()
    } catch (e) {
      setError(t.analysis.actionError(String(e instanceof Error ? e.message : e)))
    }
  }

  if (error && !questions) return <section className="glass-card p-6"><Notice level="bad">{error}</Notice></section>
  if (!questions || !settings) return <section className="glass-card p-6"><p className="text-sm text-tx3" role="status">…</p></section>

  const active = questions.filter((q) => !q.archived).sort((a, b) => a.position - b.position || a.id - b.id)
  const archived = questions.filter((q) => q.archived).sort((a, b) => a.position - b.position || a.id - b.id)

  const saveStale = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = /^\d{1,2}$/.test(days.trim()) ? Number(days.trim()) : NaN
    if (!Number.isInteger(n) || n < MIN_STALE_DAYS || n > MAX_STALE_DAYS) return setStaleProblem(s.staleInvalid)
    setStaleProblem(null)
    await run(async () => {
      await api.setAnalysisSettings({ ...settings, staleDays: n })
      setSaved(true)
    })
  }

  return (
    <section className="glass-card p-6" aria-labelledby="analysis-settings-title">
      <h2 id="analysis-settings-title" className="text-base font-semibold">{s.title}</h2>
      <p className="mb-4 mt-1 max-w-[80ch] text-sm text-tx2">{s.intro}</p>
      {error && <div className="mb-3"><Notice level="bad">{error}</Notice></div>}

      <h3 className="text-sm font-semibold">{s.questionsTitle}</h3>
      <p className="mb-1 max-w-[80ch] text-[13px] text-tx3">{s.questionsHelp}</p>
      <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
        {active.map((q, i) => (
          <QuestionRow key={q.id} q={q} first={i === 0} last={i === active.length - 1} run={run} />
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-semibold">{s.archivedTitle}</h3>
      {archived.length === 0 ? (
        <p className="mt-1 text-[13px] text-tx3">{s.archivedEmpty}</p>
      ) : (
        <ul className="mt-1 divide-y" style={{ borderColor: 'var(--hairline)' }}>
          {archived.map((q) => {
            const label = questionLabel(q, t.analysis.questions)
            return (
              <li key={q.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <p className="min-w-0 flex-1 text-sm text-tx2">{label}</p>
                <button type="button" className="btn-link" aria-label={s.restoreLabel(label)} onClick={() => void run(() => api.setAnalysisQuestionArchived(q.id, false))}>{s.restore}</button>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="mt-5 flex flex-col gap-3 rounded-inner border p-4"
        style={{ borderColor: 'var(--hairline)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!newLabel.trim()) return setAddProblem(s.addLabelRequired)
          const options = newKind === 'choice' ? { choices: parseChoices(newChoices) } : newKind === 'trend' ? { timeframes: ['weekly', 'daily', 'h4'] as Timeframe[] } : {}
          if (newKind === 'choice' && (options as { choices: string[] }).choices.length < 2) return setAddProblem(s.choicesInvalid)
          setAddProblem(null)
          void run(() => api.addAnalysisQuestion(newLabel, newKind, options)).then(() => {
            setNewLabel('')
            setNewChoices('')
          })
        }}
      >
        <h3 className="text-sm font-semibold">{s.addTitle}</h3>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
          <Field label={s.addLabel} htmlFor="q-new-label">
            <input id="q-new-label" className="control h-[42px] px-3.5" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </Field>
          <Field label={s.addKind} htmlFor="q-new-kind">
            <Select id="q-new-kind" value={newKind} onChange={(v) => setNewKind(v as QuestionKind)} options={ADDABLE.map((k) => ({ value: k, label: t.analysis.kinds[k] }))} />
          </Field>
        </div>
        {newKind === 'choice' && (
          <Field label={s.addChoices} htmlFor="q-new-choices">
            <textarea id="q-new-choices" className="input" rows={3} value={newChoices} onChange={(e) => setNewChoices(e.target.value)} />
          </Field>
        )}
        {addProblem && <p role="alert" className="text-xs text-[#F5A198]">{addProblem}</p>}
        <button type="submit" className="btn btn-secondary btn-sm self-start">{s.addButton}</button>
      </form>

      <h3 className="mt-6 text-sm font-semibold">{s.reviewTitle}</h3>
      <form className="mt-2 flex flex-wrap items-end gap-3" onSubmit={saveStale}>
        <Field label={s.staleLabel} htmlFor="stale-days">
          <input id="stale-days" className="control h-[42px] w-[120px] px-3.5 tabular-nums" inputMode="numeric" value={days} aria-describedby="stale-help" onChange={(e) => { setDays(e.target.value); setSaved(false) }} />
        </Field>
        <button type="submit" className="btn btn-secondary btn-sm">{s.staleSave}</button>
        {saved && <span role="status" className="text-[13px] text-[#9BE3C4]">{s.saved}</span>}
      </form>
      <p id="stale-help" className="mt-1.5 max-w-[80ch] text-[13px] text-tx3">{s.staleHelp(settings.staleDays)}</p>
      {staleProblem && <p role="alert" className="mt-1 text-xs text-[#F5A198]">{staleProblem}</p>}

      <div className="mt-5 flex items-start gap-3">
        <Switch
          on={settings.noAnalysisAlert}
          label={s.alertLabel}
          describedBy="na-alert-help"
          onChange={(on) => void run(() => api.setAnalysisSettings({ ...settings, noAnalysisAlert: on }))}
        />
        <div>
          <p className="text-sm font-medium">{s.alertLabel}</p>
          <p id="na-alert-help" className="max-w-[80ch] text-[13px] text-tx3">{s.alertHelp}</p>
        </div>
      </div>
      <p className="mt-4"><Link className="btn-link" to="/analysis">{s.goToAnalysis}</Link></p>
    </section>
  )
}
