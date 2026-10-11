import { useState, type FormEvent } from 'react'
import { useT } from '../../i18n'
import { parseSessionDraft, type SessionDraft } from '../../lib/backtestForm'
import { BACKTEST_STATUSES, type BacktestData, type BacktestStatus } from '../../types/backtest'
import type { Tag } from '../../types/trade'
import { Field, Segmented } from '../ui'

/** Formulaire de la stratégie (nom, actif, conditions d'entrée…). Aucune règle ici : pulse-core valide aussi. */
export function SessionForm({
  initial,
  setups,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: SessionDraft
  setups: Tag[]
  submitLabel: string
  onSubmit: (data: BacktestData) => Promise<void>
  onCancel?: () => void
}) {
  const t = useT().backtest
  const s = t.session
  const [draft, setDraft] = useState<SessionDraft>(initial)
  const [nameError, setNameError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof SessionDraft>(k: K, v: SessionDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = parseSessionDraft(draft)
    if (!parsed.ok) return setNameError(true)
    setNameError(false)
    setBusy(true)
    try {
      await onSubmit(parsed.data)
    } catch (err) {
      setError(t.saveError(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="glass-card flex flex-col gap-4 px-6 py-5" aria-label={s.formTitle}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={s.name} htmlFor="bt-name" error={nameError ? s.errName : undefined}>
          <input id="bt-name" className={`input ${nameError ? 'input-error' : ''}`} value={draft.name} maxLength={80} placeholder={s.namePlaceholder} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={s.asset} htmlFor="bt-asset">
          <input id="bt-asset" className="input" value={draft.asset} maxLength={40} placeholder={s.assetPlaceholder} onChange={(e) => set('asset', e.target.value)} />
        </Field>
        <Field label={s.timeframe} htmlFor="bt-tf">
          <input id="bt-tf" className="input" value={draft.timeframe} maxLength={20} placeholder={s.timeframePlaceholder} onChange={(e) => set('timeframe', e.target.value)} />
        </Field>
      </div>
      <Field label={s.entryConditions} htmlFor="bt-entry">
        <textarea id="bt-entry" className="input min-h-[110px] py-3" value={draft.entryConditions} placeholder={s.entryPlaceholder} onChange={(e) => set('entryConditions', e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={s.exitRules} htmlFor="bt-exit">
          <textarea id="bt-exit" className="input min-h-[80px] py-3" value={draft.exitRules} placeholder={s.exitPlaceholder} onChange={(e) => set('exitRules', e.target.value)} />
        </Field>
        <Field label={s.notes} htmlFor="bt-notes">
          <textarea id="bt-notes" className="input min-h-[80px] py-3" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={s.status}>
          <Segmented<BacktestStatus>
            label={s.status}
            value={draft.status}
            options={BACKTEST_STATUSES.map((v) => ({ value: v, label: t.status[v] }))}
            onChange={(v) => v && set('status', v)}
          />
          <p className="text-xs text-tx3">{t.statusHint}</p>
        </Field>
        <Field label={s.setupTag} htmlFor="bt-tag">
          <select id="bt-tag" className="input" value={draft.setupTagId ?? ''} onChange={(e) => set('setupTagId', e.target.value === '' ? null : Number(e.target.value))}>
            <option value="" className="bg-bg">{s.noSetupTag}</option>
            {setups.map((tag) => (
              <option key={tag.id} value={tag.id} className="bg-bg">{tag.name}</option>
            ))}
          </select>
          <p className="text-xs text-tx3">{s.setupTagHint}</p>
        </Field>
      </div>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{s.cancel}</button>}
      </div>
    </form>
  )
}
