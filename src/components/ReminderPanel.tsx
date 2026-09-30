import { Checkbox } from './ui/Checkbox'
import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import type { ReminderSettings } from '../types/journal'

/** Réglage du rappel quotidien du journal (Paramètres). */
export function ReminderPanel() {
  const t = useT()
  const r = t.reminder
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getReminderSettings()
      .then(setSettings)
      .catch((e) => setError(r.loadError(String(e instanceof Error ? e.message : e))))
  }, [r])

  async function apply(next: ReminderSettings) {
    setError(null)
    setMessage(null)
    setSettings(next)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) return // saisie de l'heure encore incomplète
    try {
      setSettings(await api.setReminderSettings(next))
      setMessage(r.saved)
    } catch (e) {
      setError(r.saveError(String(e instanceof Error ? e.message : e)))
    }
  }

  return (
    <section className="glass-card p-6" aria-labelledby="reminder-title">
      <h2 id="reminder-title" className="mb-1 text-base font-semibold">{r.title}</h2>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{r.intro}</p>
      {settings && (
        <div className="flex flex-wrap items-center gap-6">
          <Checkbox checked={settings.enabled} onChange={(v) => void apply({ ...settings, enabled: v })} label={r.enabled} />
          <label className="flex items-center gap-3 text-sm">
            <span className="caption">{r.time}</span>
            <input
              type="time"
              className="input !w-auto"
              value={settings.time}
              disabled={!settings.enabled}
              onChange={(e) => void apply({ ...settings, time: e.target.value })}
            />
          </label>
          {message && <span role="status" className="text-sm text-[#9BE3C4]">{message}</span>}
        </div>
      )}
      <p className="mt-3 text-xs text-tx3">{r.note}</p>
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
