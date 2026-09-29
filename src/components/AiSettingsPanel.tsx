import { useEffect, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { aiErrorMessage } from '../lib/aiView'
import type { AiStatus } from '../types/ai'
import { Notice, Switch } from './ui'

const OTHER = '__other__'

/** Paramètres > IA (lot 20) : interrupteur, clé dans le coffre Windows, modèle, test de connexion. */
export function AiSettingsPanel() {
  const t = useT()
  const s = t.ai.settings
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [otherModel, setOtherModel] = useState<string | null>(null)
  const [busy, setBusy] = useState<'key' | 'test' | null>(null)

  useEffect(() => {
    api
      .getAiStatus()
      .then(setStatus)
      .catch((e) => setLoadError(s.loadError(String(e instanceof Error ? e.message : e))))
  }, [s])

  const fail = (e: unknown) => setError(aiErrorMessage(e, t.ai))
  const run = async (action: () => Promise<AiStatus>, done?: string) => {
    setError(null)
    setMessage(null)
    try {
      setStatus(await action())
      if (done) setMessage(done)
    } catch (e) {
      fail(e)
    }
  }

  if (loadError) return <section id="ia" className="glass-card p-6"><div className="nt nt-bad" role="alert">{loadError}</div></section>
  if (!status) return <section id="ia" className="glass-card p-6" aria-busy="true"><h2 className="text-base font-semibold">{s.title}</h2></section>

  const { settings } = status
  const suggested = status.suggestedModels
  const isOther = otherModel !== null || !suggested.includes(settings.model)
  const simulation = status.provider === 'simulation'

  const saveKey = async (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setBusy('key')
    await run(() => api.saveAiKey(key), s.keySaved)
    setKey('') // la clé ne reste jamais dans le formulaire
    setBusy(null)
  }
  const test = async () => {
    setError(null)
    setMessage(null)
    setBusy('test')
    try {
      await api.testAiConnection()
      setMessage(s.testOk)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const setModel = (model: string) => run(() => api.setAiSettings({ enabled: settings.enabled, model }), s.saved)

  return (
    <section id="ia" className="glass-card flex flex-col gap-5 p-6" aria-labelledby="ai-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[80ch]">
          <h2 id="ai-title" className="mb-1 flex flex-wrap items-center gap-2 text-base font-semibold">
            {s.title}
            {simulation && <span className="badge badge-warn">{s.simulation}</span>}
          </h2>
          <p id="ai-intro" className="text-[13px] leading-relaxed text-tx2">{s.intro}</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch on={settings.enabled} label={s.switchLabel} describedBy="ai-intro" onChange={(on) => void run(() => api.setAiSettings({ enabled: on, model: settings.model }), s.saved)} />
          <span className={`text-sm font-semibold ${settings.enabled ? 'text-tx' : 'text-tx2'}`}>{settings.enabled ? s.on : s.off}</span>
        </div>
      </div>

      {simulation && <Notice level="warn">{s.simulationHint}</Notice>}
      {!settings.enabled && <p className="text-[13px] text-tx3">{s.offHint}</p>}
      <p className="text-[13px] text-tx2">{s.provider(status.providerHost)}</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-inner border bg-white/[0.03] p-[18px]" style={{ borderColor: 'var(--hairline)' }}>
          <h4 className="caption">{s.keyTitle}</h4>
          {!status.vaultAvailable ? (
            <Notice level="bad">{s.vaultUnavailable}</Notice>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm">
                <span className={`badge ${status.keyStored ? 'badge-gain' : 'badge-neutral'}`}>{status.keyStored ? '✓' : '—'}</span>
                {status.keyStored ? s.keyStored : s.keyMissing}
              </p>
              <form onSubmit={(e) => void saveKey(e)} className="flex flex-wrap items-end gap-2.5">
                <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                  <span className="caption">{s.keyLabel}</span>
                  <input
                    type="password"
                    className="control h-[42px] px-3.5"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={s.keyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                </label>
                <button type="submit" className="btn btn-secondary" disabled={!key.trim() || busy === 'key'}>
                  {status.keyStored ? s.replaceKey : s.saveKey}
                </button>
              </form>
              {status.keyStored &&
                (confirmDelete ? (
                  <div className="nt nt-bad flex-col" role="alertdialog" aria-label={s.deleteKey}>
                    <p>{s.confirmDeleteKey}</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => { setConfirmDelete(false); void run(() => api.deleteAiKey(), s.keyDeleted) }}>{s.deleteKey}</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</button>
                    </div>
                  </div>
                ) : (
                  <div><button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>{s.deleteKey}</button></div>
                ))}
              <p className="text-xs leading-relaxed text-tx3">{s.keyWhere}</p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-inner border bg-white/[0.03] p-[18px]" style={{ borderColor: 'var(--hairline)' }}>
          <h4 className="caption"><label htmlFor="ai-model">{s.modelTitle}</label></h4>
          <select
            id="ai-model"
            className="control h-[42px] px-3.5"
            value={isOther ? OTHER : settings.model}
            onChange={(e) => {
              if (e.target.value === OTHER) setOtherModel(settings.model)
              else {
                setOtherModel(null)
                void setModel(e.target.value)
              }
            }}
          >
            {suggested.map((m) => (
              <option key={m} value={m} className="bg-bg">
                {s.modelNames[m] ?? m}{m === status.defaultModel ? s.defaultSuffix : ''}
              </option>
            ))}
            <option value={OTHER} className="bg-bg">{s.otherModel}</option>
          </select>
          {isOther && (
            <form
              className="flex flex-wrap items-end gap-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                void setModel((otherModel ?? settings.model).trim()).then(() => setOtherModel(null))
              }}
            >
              <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <span className="caption">{s.otherModelLabel}</span>
                <input className="control h-[42px] px-3.5 font-mono text-[13px]" value={otherModel ?? settings.model} onChange={(e) => setOtherModel(e.target.value)} spellCheck={false} />
              </label>
              <button type="submit" className="btn btn-secondary">{s.applyModel}</button>
            </form>
          )}
          <p className="text-xs text-tx3">{isOther ? s.otherModelHint : s.modelHint}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={!settings.enabled || !status.keyStored || busy === 'test'}>
              {busy === 'test' ? s.testing : s.test}
            </button>
            {(!settings.enabled || !status.keyStored) && <span className="text-xs text-tx3">{s.testNeeds}</span>}
          </div>
        </div>
      </div>

      {message && <Notice level="ok">{message}</Notice>}
      {error && <Notice level="bad">{error}</Notice>}

      <details className="rounded-inner border px-[18px] py-3.5 text-[13px] leading-relaxed" style={{ borderColor: 'var(--hairline)' }}>
        <summary className="cursor-pointer font-semibold">{s.whatTitle}</summary>
        <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-tx2">
          <li>{s.whatSent}</li>
          <li>{s.whatNever}</li>
          <li>{s.whatTest}</li>
          <li>{s.howOff}</li>
        </ul>
      </details>
    </section>
  )
}
