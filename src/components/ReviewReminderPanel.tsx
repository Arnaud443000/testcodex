import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/reviewView'
import type { ReviewReminderSettings } from '../types/review'
import { Checkbox } from './ui/Checkbox'

/** Réglage du rappel du dimanche pour le bilan hebdomadaire (Paramètres, ancre `#bilan`). Le jour est fixe. */
export function ReviewReminderPanel() {
  const r = useT().review
  const p = r.reminder
  const [settings, setSettings] = useState<ReviewReminderSettings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getReviewReminder()
      .then(setSettings)
      .catch((e) => setError(p.loadError(String(e instanceof Error ? e.message : e))))
  }, [p])

  async function apply(next: ReviewReminderSettings) {
    setError(null)
    setMessage(null)
    setSettings(next)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) return // saisie de l'heure encore incomplète
    try {
      setSettings(await api.setReviewReminder(next))
      setMessage(p.saved)
    } catch (e) {
      setError(errorText(r, e, p.saveError))
    }
  }

  return (
    <section className="glass-card p-6" aria-labelledby="review-reminder-title">
      <h2 id="review-reminder-title" className="mb-1 text-base font-semibold">{p.title}</h2>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{p.intro}</p>
      {settings && (
        <div className="flex flex-wrap items-center gap-6">
          <Checkbox checked={settings.enabled} onChange={(v) => void apply({ ...settings, enabled: v })} label={p.enabled} />
          <p className="flex items-center gap-3 text-sm">
            <span className="caption">{p.day}</span>
            <span className="font-medium">{p.dayValue}</span>
          </p>
          <label className="flex items-center gap-3 text-sm">
            <span className="caption">{p.time}</span>
            <input type="time" className="input !w-auto" value={settings.time} disabled={!settings.enabled} onChange={(e) => void apply({ ...settings, time: e.target.value })} />
          </label>
          {message && <span role="status" className="text-sm text-[#9BE3C4]">{message}</span>}
        </div>
      )}
      <p className="mt-3 text-xs text-tx3">{p.note}</p>
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
