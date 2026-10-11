import { useState, type FormEvent } from 'react'
import { useT } from '../../i18n'
import { emptyCaseDraft, parseCaseDraft, suggestedResult, type CaseDraft, type CaseErrorKey } from '../../lib/backtestForm'
import { OBSERVATIONS, OUTCOMES, VALIDITIES, type CaseData, type CaseOutcome, type Observation, type SetupValidity } from '../../types/backtest'
import type { Direction } from '../../types/trade'
import { Field, Segmented } from '../ui'

/** Saisie d'un cas. Le formulaire garde ses valeurs après un ajout (date et sens) pour enchaîner les cas. */
export function CaseForm({
  initial,
  editing,
  onSubmit,
  onCancel,
}: {
  initial: CaseDraft
  editing: boolean
  onSubmit: (data: CaseData) => Promise<void>
  onCancel?: () => void
}) {
  const t = useT().backtest
  const f = t.caseForm
  const [draft, setDraft] = useState<CaseDraft>(initial)
  const [errors, setErrors] = useState<Partial<Record<CaseErrorKey, true>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof CaseDraft>(k: K, v: CaseDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const entered = draft.outcome !== 'no_entry'

  function chooseOutcome(outcome: CaseOutcome) {
    setDraft((d) => {
      // On ne remplace jamais une valeur déjà saisie : seulement un champ vide.
      const suggestion = suggestedResult(outcome, d.plannedRr)
      return { ...d, outcome, resultR: d.resultR === '' || d.resultR === suggestedResult(d.outcome, d.plannedRr) ? suggestion : d.resultR }
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = parseCaseDraft(draft)
    if (!parsed.ok) return setErrors(parsed.errors)
    setErrors({})
    setBusy(true)
    try {
      await onSubmit(parsed.data)
      if (!editing) {
        // Prêt pour le cas suivant : on garde l'observation, la validité, le sens et le R:R prévu.
        setDraft((d) => ({ ...emptyCaseDraft(), direction: d.direction, observation: d.observation, setupValid: d.setupValid, plannedRr: d.plannedRr, outcome: d.outcome, resultR: suggestedResult(d.outcome, d.plannedRr) }))
      }
    } catch (err) {
      setError(t.saveError(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  const messages = (Object.keys(errors) as CaseErrorKey[]).filter((k) => !['when', 'plannedRr', 'resultR', 'maxR'].includes(k))

  return (
    <form onSubmit={submit} className="glass-card flex flex-col gap-4 px-6 py-5" aria-label={editing ? f.editTitle : f.title}>
      <div>
        <h2 className="text-[15px] font-semibold">{editing ? f.editTitle : f.title}</h2>
        {!editing && <p className="mt-1 text-[13px] text-tx2">{f.intro}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
        <Field label={f.when} htmlFor="bc-when" error={errors.when ? f.errors.when : undefined}>
          <input id="bc-when" type="datetime-local" className={`input ${errors.when ? 'input-error' : ''}`} value={draft.when} onChange={(e) => set('when', e.target.value)} />
        </Field>
        <Field label={f.direction}>
          <Segmented<Direction>
            label={f.direction}
            value={draft.direction}
            allowClear
            options={[{ value: 'long', label: f.long }, { value: 'short', label: f.short }]}
            onChange={(v) => set('direction', v)}
          />
        </Field>
        <Field label={f.observation}>
          <Segmented<Observation>
            label={f.observation}
            value={draft.observation}
            options={OBSERVATIONS.map((v) => ({ value: v, label: f.observations[v] }))}
            onChange={(v) => v && set('observation', v)}
          />
          <p className="text-xs text-tx3">{f.observationHint}</p>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={f.setupValid}>
          <Segmented<SetupValidity>
            label={f.setupValid}
            value={draft.setupValid}
            options={VALIDITIES.map((v) => ({ value: v, label: f.validities[v] }))}
            onChange={(v) => v && set('setupValid', v)}
          />
          <p className="text-xs text-tx3">{f.validityHint}</p>
        </Field>
        <Field label={f.outcome}>
          <Segmented<CaseOutcome>
            label={f.outcome}
            value={draft.outcome}
            options={OUTCOMES.map((v) => ({ value: v, label: f.outcomes[v] }))}
            onChange={(v) => v && chooseOutcome(v)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={f.plannedRr} htmlFor="bc-rr" error={errors.plannedRr ? f.errors.plannedRr : undefined}>
          <input id="bc-rr" className={`input ${errors.plannedRr ? 'input-error' : ''}`} inputMode="decimal" value={draft.plannedRr} placeholder="2" onChange={(e) => set('plannedRr', e.target.value)} />
          <p className="text-xs text-tx3">{f.plannedRrHint}</p>
        </Field>
        <Field label={f.resultR} htmlFor="bc-result" error={errors.resultR ? f.errors.resultR : undefined}>
          <input id="bc-result" className={`input ${errors.resultR ? 'input-error' : ''}`} inputMode="decimal" disabled={!entered} value={entered ? draft.resultR : ''} placeholder="−1" onChange={(e) => set('resultR', e.target.value)} />
          <p className="text-xs text-tx3">{f.resultRHint}</p>
        </Field>
        <Field label={f.maxR} htmlFor="bc-max" error={errors.maxR ? f.errors.maxR : undefined}>
          <input id="bc-max" className={`input ${errors.maxR ? 'input-error' : ''}`} inputMode="decimal" disabled={!entered} value={entered ? draft.maxR : ''} placeholder="3" onChange={(e) => set('maxR', e.target.value)} />
          <p className="text-xs text-tx3">{f.maxRHint}</p>
        </Field>
      </div>
      <Field label={f.notes} htmlFor="bc-notes">
        <textarea id="bc-notes" className="input min-h-[64px] py-3" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {messages.map((k) => (
        <p key={k} role="alert" className="text-xs text-[#F5A198]">{f.errors[k]}</p>
      ))}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>{editing ? f.save : f.add}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{f.cancel}</button>}
      </div>
    </form>
  )
}
