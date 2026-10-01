import { useEffect, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatScore } from '../lib/behaviorFormat'
import {
  DEFAULT_FORM,
  DEFAULT_REVENGE_SIZE_FACTOR,
  DEFAULT_REVENGE_WINDOW_MIN,
  formFromSettings,
  parseForm,
  type BehaviorForm,
  type BehaviorFormErrors,
  type BehaviorFormField,
} from '../lib/behaviorSettingsForm'

/** Seuils de l'analyse comportementale (Paramètres > Seuils de discipline). */
export function BehaviorSettingsPanel() {
  const t = useT()
  const s = t.behaviorSettings
  const [form, setForm] = useState<BehaviorForm | null>(null)
  const [errors, setErrors] = useState<BehaviorFormErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [score, setScore] = useState<{ value: number | null; need: number } | null>(null)

  /** Score de l'historique complet avec les seuils enregistrés : calculé par pulse-core, affiché tel quel. */
  const refreshScore = () =>
    api
      .getDiscipline({ accountIds: [] })
      .then((r) => setScore({ value: r.score, need: r.minTradeCount }))
      .catch(() => setScore(null))

  useEffect(() => {
    api
      .getBehaviorSettings()
      .then((v) => setForm(formFromSettings(v)))
      .catch((e) => setError(s.loadError(String(e instanceof Error ? e.message : e))))
    void refreshScore()
  }, [s])

  const change = (field: BehaviorFormField, value: string) => {
    setForm((f) => (f ? { ...f, [field]: value } : f))
    setErrors((e) => ({ ...e, [field]: undefined }))
    setMessage(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    setMessage(null)
    const parsed = parseForm(form)
    if ('errors' in parsed) return setErrors(parsed.errors)
    setErrors({})
    setBusy(true)
    try {
      setForm(formFromSettings(await api.setBehaviorSettings(parsed.settings)))
      setMessage(s.saved)
      await refreshScore()
    } catch (err) {
      setError(s.saveError(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  const fields: { field: BehaviorFormField; label: string; unit: string; effect: string; hint: string; inputMode: 'decimal' | 'numeric'; optional: boolean }[] = [
    { field: 'maxRiskPercent', label: s.riskLabel, unit: s.riskUnit, effect: s.riskEffect, hint: s.riskDefault, inputMode: 'decimal', optional: true },
    { field: 'maxTradesPerDay', label: s.tradesLabel, unit: s.tradesUnit, effect: s.tradesEffect, hint: s.tradesDefault, inputMode: 'numeric', optional: true },
    { field: 'revengeWindowMin', label: s.windowLabel, unit: s.windowUnit, effect: s.windowEffect, hint: s.windowDefault(DEFAULT_REVENGE_WINDOW_MIN), inputMode: 'numeric', optional: false },
    {
      field: 'revengeSizeFactor',
      label: s.factorLabel,
      unit: s.factorUnit,
      effect: s.factorEffect,
      hint: s.factorDefault(DEFAULT_REVENGE_SIZE_FACTOR.replace('.', ',')),
      inputMode: 'decimal',
      optional: false,
    },
  ]

  return (
    <section className="glass-card p-6" aria-labelledby="behavior-settings-title">
      <h2 id="behavior-settings-title" className="mb-1 text-base font-semibold">{s.title}</h2>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{s.intro}</p>
      {form && (
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
            {fields.map((f) => {
              const id = `bs-${f.field}`
              const bad = errors[f.field]
              return (
                <div key={f.field} className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={id} className="caption">{f.label}</label>
                  <div className="flex items-center gap-2.5">
                    <input
                      id={id}
                      className={`input !w-[140px] tabular-nums ${bad ? '!border-loss' : ''}`}
                      inputMode={f.inputMode}
                      value={form[f.field]}
                      placeholder={f.optional ? '—' : undefined}
                      aria-invalid={bad ? true : undefined}
                      aria-describedby={`${id}-help`}
                      onChange={(e) => change(f.field, e.target.value)}
                    />
                    <span className="text-sm text-tx2">{f.unit}</span>
                    <span className="text-xs text-tx3">{f.optional ? `${s.disabledHint} · ${f.hint}` : f.hint}</span>
                  </div>
                  {bad && <span className="text-xs text-[#F5A198]" role="alert">{s.errors[f.field]}</span>}
                  <p id={`${id}-help`} className="text-xs leading-relaxed text-tx3">{f.effect}</p>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={busy}>{s.save}</button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(DEFAULT_FORM)
                setErrors({})
                setMessage(null)
              }}
            >
              {s.reset}
            </button>
            {message && <span role="status" className="text-sm text-[#9BE3C4]">{message}</span>}
          </div>
          <div className="border-t pt-4 text-sm" style={{ borderColor: 'var(--hairline)' }}>
            <span className="text-tx2">{s.currentScore} : </span>
            <b className="tabular-nums" data-testid="current-score">
              {score === null || score.value === null ? formatScore(null) : s.currentScoreValue(formatScore(score.value))}
            </b>
            {score !== null && score.value === null && <span className="ml-2 text-xs text-tx3">{s.currentScoreEmpty(score.need)}</span>}
            <p className="mt-1 text-xs text-tx3">{s.currentScoreHint}</p>
          </div>
        </form>
      )}
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
