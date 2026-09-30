import { useState } from 'react'
import { useT } from '../../i18n'
import { levelsInOrder, validLevel } from '../../lib/analysisView'
import type { Idea, IdeaInput, Timeframe } from '../../types/analysis'
import { TIMEFRAMES } from '../../types/analysis'
import type { Instrument } from '../../types/trade'
import { AssetPicker } from '../AssetPicker'
import { ChipButton, Field, Notice } from '../ui'

/** Création ou modification d'une idée : actif, unités de temps, texte, niveau ou zone facultatifs, ce qui l'invalide. */
export function IdeaForm({
  instruments,
  idea,
  initialInstrumentId = null,
  onSubmit,
  onCancel,
}: {
  instruments: Instrument[]
  idea?: Idea
  initialInstrumentId?: number | null
  onSubmit: (input: IdeaInput) => Promise<void>
  onCancel?: () => void
}) {
  const all = useT().analysis
  const a = all.ideas
  const [instrumentId, setInstrumentId] = useState<number | null>(idea?.instrumentId ?? initialInstrumentId)
  const [frames, setFrames] = useState<Timeframe[]>(idea?.timeframes ?? [])
  const [note, setNote] = useState(idea?.note ?? '')
  const [low, setLow] = useState(idea?.levelLow ?? '')
  const [high, setHigh] = useState(idea?.levelHigh ?? '')
  const [invalidation, setInvalidation] = useState(idea?.invalidation ?? '')
  const [errors, setErrors] = useState<{ asset?: string; note?: string; low?: string; high?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)
  const uid = idea ? `idea-${idea.id}` : 'idea-new'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (instrumentId === null) next.asset = a.assetRequired
    if (!note.trim()) next.note = a.noteRequired
    if (!validLevel(low)) next.low = a.levelInvalid
    if (!validLevel(high)) next.high = a.levelInvalid
    if (!next.low && !next.high && !levelsInOrder(low, high)) next.high = a.levelOrder
    setErrors(next)
    if (Object.keys(next).length > 0 || instrumentId === null) return
    setSaving(true)
    try {
      await onSubmit({ instrumentId, timeframes: frames, note, levelLow: low.trim() || null, levelHigh: high.trim() || null, invalidation: invalidation.trim() || null })
    } catch (err) {
      setErrors({ form: String(err instanceof Error ? err.message : err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={a.asset} htmlFor={`${uid}-asset`} error={errors.asset}>
          <AssetPicker id={`${uid}-asset`} instruments={instruments} value={instrumentId} onChange={(i) => setInstrumentId(i.id)} error={!!errors.asset} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="caption" id={`${uid}-frames`}>{a.timeframes}</span>
          <div role="group" aria-labelledby={`${uid}-frames`} className="flex flex-wrap gap-2">
            {TIMEFRAMES.map((tf) => (
              <ChipButton key={tf} on={frames.includes(tf)} onClick={() => setFrames(frames.includes(tf) ? frames.filter((x) => x !== tf) : [...frames, tf])}>
                {all.timeframes[tf]}
              </ChipButton>
            ))}
          </div>
        </div>
      </div>
      <Field label={a.note} htmlFor={`${uid}-note`} error={errors.note}>
        <textarea id={`${uid}-note`} className="input" rows={3} value={note} placeholder={a.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="caption mb-1.5">{a.levels}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.levelLow} htmlFor={`${uid}-low`} error={errors.low}>
            <input id={`${uid}-low`} className="control h-[42px] px-3.5 tabular-nums" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
          </Field>
          <Field label={a.levelHigh} htmlFor={`${uid}-high`} error={errors.high}>
            <input id={`${uid}-high`} className="control h-[42px] px-3.5 tabular-nums" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
          </Field>
        </div>
      </fieldset>
      <Field label={a.invalidation} htmlFor={`${uid}-inval`}>
        <textarea id={`${uid}-inval`} className="input" rows={2} value={invalidation} placeholder={a.invalidationPlaceholder} onChange={(e) => setInvalidation(e.target.value)} />
      </Field>
      {errors.form && <Notice level="bad">{errors.form}</Notice>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? a.saving : idea ? a.saveChanges : a.save}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{a.cancel}</button>}
      </div>
    </form>
  )
}
