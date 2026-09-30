import { useState, type FormEvent } from 'react'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { isCeiling, readTarget } from '../../lib/processGoalsView'
import { nextPeriod, parsePeriod } from '../../lib/processPeriods'
import { PROCESS_METRICS, type ProcessGoal, type ProcessMetric, type ProcessPeriodKind, type RequiredSetting } from '../../types/processGoals'
import { Modal } from '../dashboard/Modal'
import { Field } from '../ui'
import { Checkbox } from '../ui/Checkbox'
import { Select } from '../ui/Select'

const REQUIRED: Partial<Record<ProcessMetric, RequiredSetting>> = { overtrading_days: 'maxTradesPerDay', risk_breaches: 'maxRiskPercent' }

/**
 * Création ou modification d'un objectif de comportement. La saisie est lue avec les bornes de pulse-core
 * (`readTarget`) ; pulse-core valide une seconde fois et fait foi (son refus s'affiche tel quel).
 */
export function ProcessGoalDialog({
  kind,
  periodKey,
  periodLabel,
  editing,
  existing,
  missingSettings,
  onClose,
  onSaved,
}: {
  kind: ProcessPeriodKind
  periodKey: string
  periodLabel: string
  /** Objectif modifié ; absent = création. */
  editing: ProcessGoal | null
  /** Mesures qui ont déjà un objectif sur la période. */
  existing: ProcessMetric[]
  /** Seuils de discipline non réglés (l'objectif affichera « Réglage requis »). */
  missingSettings: RequiredSetting[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT().processGoals
  const d = t.dialog
  const firstFree = PROCESS_METRICS.find((m) => !existing.includes(m)) ?? 'no_stop_trades'
  const [metric, setMetric] = useState<ProcessMetric>(editing?.metric ?? firstFree)
  const [input, setInput] = useState(editing ? editing.target.replace('.', ',') : '')
  const [alsoNext, setAlsoNext] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ceiling = isCeiling(metric)
  const help = metric === 'journal_days' ? (kind === 'week' ? d.targetHelp.journalWeek : d.targetHelp.journalMonth) : ceiling ? d.targetHelp.count : d.targetHelp.percent
  const needed = REQUIRED[metric]
  const replaces = !editing && existing.includes(metric)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const read = readTarget(kind, metric, input)
    if ('error' in read) return setError(t.errors[read.error])
    setBusy(true)
    setError(null)
    try {
      await api.setProcessGoal({ periodKind: kind, periodKey, metric, target: read.target })
      if (alsoNext) {
        const period = parsePeriod(kind, periodKey)
        const next = period ? nextPeriod(period).key : null
        if (next && !(await api.listProcessGoals(kind, next)).some((g) => g.metric === metric)) {
          await api.setProcessGoal({ periodKind: kind, periodKey: next, metric, target: read.target })
        }
      }
      onSaved()
    } catch (err) {
      setError(t.saveError(String(err instanceof Error ? err.message : err)))
      setBusy(false)
    }
  }

  return (
    <Modal title={editing ? d.editTitle : d.createTitle} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-[13px] text-tx2">{d.period(periodLabel)}</p>
        <Field label={d.metric} htmlFor="process-goal-metric">
          <Select
            id="process-goal-metric"
            value={metric}
            disabled={editing !== null}
            onChange={(v) => {
              setMetric(v as ProcessMetric)
              setError(null)
            }}
            options={PROCESS_METRICS.map((m) => ({ value: m, label: t.metrics[m] }))}
          />
          <p className="text-xs text-tx3">{t.help[metric]}</p>
        </Field>
        <Field label={`${ceiling ? d.target.atMost : d.target.atLeast} (${d.unit[metric]})`} htmlFor="process-goal-target" error={error ?? undefined}>
          <input
            id="process-goal-target"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            // En modification, la mesure est figée (menu désactivé) : le focus va directement à la cible.
            autoFocus={editing !== null}
            value={input}
            aria-invalid={error !== null}
            aria-describedby="process-goal-target-help"
            onChange={(e) => {
              setInput(e.target.value)
              setError(null)
            }}
            placeholder={ceiling ? '0' : metric === 'journal_days' ? '5' : '90'}
          />
          <p id="process-goal-target-help" className="text-xs text-tx3">{help}</p>
        </Field>
        {needed && missingSettings.includes(needed) && <div className="nt nt-warn" role="status">{d.settingWarning[needed]}</div>}
        {replaces && <div className="nt nt-warn" role="status">{d.exists}</div>}
        {!editing && <Checkbox checked={alsoNext} onChange={setAlsoNext} label={d.alsoNext[kind]} description={d.alsoNextHelp} align="start" />}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? d.saving : d.save}</button>
        </div>
      </form>
    </Modal>
  )
}
