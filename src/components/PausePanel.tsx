import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { usePause } from '../lib/pause'
import { parseCustomMinutes } from '../lib/pauseView'
import type { PauseSettings } from '../types/pause'
import { Checkbox } from './ui/Checkbox'
import { Select } from './ui/Select'

const DEFAULT_SUGGEST = 3

/** Paramètres > Pause volontaire : durée proposée par défaut, et proposition de pause après N pertes d'affilée (désactivée par défaut). */
export function PausePanel() {
  const p = useT().pause.settings
  const { refreshSettings } = usePause()
  const [settings, setSettings] = useState<PauseSettings | null>(null)
  const [minutes, setMinutes] = useState('30')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getPauseSettings()
      .then((s) => {
        setSettings(s)
        setMinutes(String(s.defaultMinutes))
      })
      .catch((e) => setError(p.loadError(String(e instanceof Error ? e.message : e))))
  }, [p])

  async function save(next: PauseSettings) {
    setError(null)
    setMessage(null)
    try {
      setSettings(await api.setPauseSettings(next))
      await refreshSettings()
      setMessage(p.saved)
    } catch (e) {
      setError(p.saveError(String(e instanceof Error ? e.message : e)))
    }
  }

  const invalidMinutes = parseCustomMinutes(minutes) === null
  return (
    <section className="glass-card p-6" aria-labelledby="pause-title">
      <h2 id="pause-title" className="mb-1 text-base font-semibold">{p.title}</h2>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{p.intro}</p>
      {settings && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label htmlFor="pause-default-minutes" className="caption">{p.defaultLabel}</label>
            <input
              id="pause-default-minutes"
              className="input !w-24"
              inputMode="numeric"
              autoComplete="off"
              value={minutes}
              aria-invalid={invalidMinutes}
              aria-describedby="pause-default-hint"
              onChange={(e) => {
                setMinutes(e.target.value)
                const n = parseCustomMinutes(e.target.value)
                if (n !== null) void save({ ...settings, defaultMinutes: n })
              }}
            />
            <span id="pause-default-hint" className={`text-xs ${invalidMinutes ? 'text-loss' : 'text-tx3'}`}>{invalidMinutes ? p.defaultError : p.defaultHint}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Checkbox
              checked={settings.suggestAfterLosses !== null}
              onChange={(on) => void save({ ...settings, suggestAfterLosses: on ? DEFAULT_SUGGEST : null })}
              label={p.suggestLabel}
            />
            {settings.suggestAfterLosses !== null && (
              <label className="flex items-center gap-3 text-sm">
                <span className="caption">{p.suggestCount}</span>
                <Select
                  ariaLabel={p.suggestCount}
                  value={String(settings.suggestAfterLosses)}
                  onChange={(v) => void save({ ...settings, suggestAfterLosses: Number(v) })}
                  options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: String(n) }))}
                />
              </label>
            )}
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-[#9BE3C4]">{message}</p>}
      <p className="mt-3 text-xs text-tx3">{p.note}</p>
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
