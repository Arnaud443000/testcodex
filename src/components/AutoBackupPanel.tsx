import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { backupErrorText, formatSize, middleEllipsis, nextDueText, parseKeep } from '../lib/backupAutoView'
import { formatDateTime } from '../lib/format'
import { localTzOffsetMin } from '../lib/period'
import type { AutoBackupEntry, AutoBackupSettings, AutoBackupStatus, BackupFrequency } from '../types/backupAuto'
import { Notice, Switch } from './ui'
import { Select } from './ui/Select'
import { Tooltip } from './ui/Tooltip'

const MAX_KEEP = 60

type Message = { tone: 'ok' | 'bad'; text: string } | null

/**
 * Paramètres > Sauvegarde automatique (lot 32), juste au-dessus de la sauvegarde manuelle. Aucune règle ici :
 * pulse-core valide le dossier, décide quand sauvegarder, écrit, relit et fait le ménage ; l'interface affiche.
 */
export function AutoBackupPanel() {
  const t = useT()
  const b = t.backupAuto
  const [status, setStatus] = useState<AutoBackupStatus | null>(null)
  const [entries, setEntries] = useState<AutoBackupEntry[] | null>(null)
  const [keepInput, setKeepInput] = useState('')
  const [sameDrive, setSameDrive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const st = await api.getAutoBackupStatus(localTzOffsetMin())
    setStatus(st)
    setKeepInput(String(st.settings.keep))
    setNow(Date.now())
    setEntries(st.settings.folder ? await api.listAutoBackups().catch(() => []) : [])
  }, [])

  useEffect(() => {
    refresh().catch((e) => setMessage({ tone: 'bad', text: backupErrorText(t, e) }))
    let off: (() => void) | undefined
    let live = true
    void api.onAutoBackupEvent(() => void refresh().catch(() => {})).then((f) => (live ? (off = f) : f()))
    return () => {
      live = false
      off?.()
    }
  }, [refresh, t])

  async function save(next: AutoBackupSettings, done: string = b.saved) {
    setBusy(true)
    setMessage(null)
    try {
      const saved = await api.setAutoBackupSettings(next, localTzOffsetMin())
      setStatus(saved.status)
      setKeepInput(String(saved.status.settings.keep))
      if (saved.folderCheck) setSameDrive(saved.folderCheck.sameDrive)
      setEntries(saved.status.settings.folder ? await api.listAutoBackups().catch(() => []) : [])
      setMessage({ tone: 'ok', text: done })
    } catch (e) {
      setMessage({ tone: 'bad', text: backupErrorText(t, e) })
    } finally {
      setBusy(false)
    }
  }

  /** Boîte de dialogue native ; `null` si l'utilisateur annule. */
  const pick = () => api.pickFolder(b.folderDialog)

  async function toggle(on: boolean) {
    if (!status) return
    let folder = status.settings.folder
    // Activer sans dossier : on le demande d'abord (pulse-core refuserait avec backup:noFolder).
    if (on && !folder) {
      folder = await pick()
      if (!folder) return setMessage({ tone: 'bad', text: b.errors.noFolder })
    }
    await save({ ...status.settings, enabled: on, folder })
  }

  async function chooseFolder() {
    if (!status) return
    const folder = await pick()
    if (folder) await save({ ...status.settings, folder })
  }

  function applyKeep(e?: FormEvent) {
    e?.preventDefault()
    if (!status) return
    const keep = parseKeep(keepInput, MAX_KEEP)
    if (keep === null) return setMessage({ tone: 'bad', text: b.keepInvalid(MAX_KEEP) })
    if (keep !== status.settings.keep) void save({ ...status.settings, keep })
  }

  async function runNow() {
    setRunning(true)
    setMessage(null)
    try {
      const done = await api.runAutoBackupNow(localTzOffsetMin())
      const pruned = done.pruned.length ? ` ${b.pruned(done.pruned.length)}` : ''
      setMessage({ tone: 'ok', text: b.runDone(done.name, done.info.trades, done.info.screenshots) + pruned })
    } catch (e) {
      setMessage({ tone: 'bad', text: backupErrorText(t, e) })
    } finally {
      setRunning(false)
      await refresh().catch(() => {})
    }
  }

  async function openFolder() {
    try {
      await api.openAutoBackupFolder()
    } catch (e) {
      setMessage({ tone: 'bad', text: backupErrorText(t, e) })
    }
  }

  const s = status?.settings
  const disabled = busy || running
  return (
    <section className="glass-card flex flex-col gap-5 p-6" aria-labelledby="auto-backup-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[80ch]">
          <h2 id="auto-backup-title" className="mb-1 flex flex-wrap items-center gap-2 text-base font-semibold">
            {b.title}
            {api.isBrowserPreview && <span className="badge badge-warn">{b.simulation}</span>}
          </h2>
          <p id="auto-backup-intro" className="text-[13px] leading-relaxed text-tx2">{b.intro}</p>
        </div>
        {s && (
          <div className="flex items-center gap-3">
            <Switch on={s.enabled} label={b.switchLabel} describedBy="auto-backup-intro" onChange={(on) => void toggle(on)} />
            <span className={`text-sm font-semibold ${s.enabled ? 'text-tx' : 'text-tx2'}`}>{s.enabled ? b.on : b.off}</span>
          </div>
        )}
      </div>

      {api.isBrowserPreview && <Notice level="warn">{b.simulationHint}</Notice>}

      {s && (
        <>
          {!s.enabled && <p className="text-[13px] text-tx3">{b.offHint}</p>}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px_190px]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="caption" id="auto-backup-folder-label">{b.folderLabel}</span>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {s.folder ? (
                  <Tooltip content={s.folder.length > 52 ? s.folder : undefined} focusable={s.folder.length > 52}>
                    <span className="min-w-0 truncate rounded-sm bg-white/5 px-2.5 py-1.5 font-mono text-[13px]" aria-labelledby="auto-backup-folder-label">
                      {middleEllipsis(s.folder)}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-sm text-tx3">{b.noFolder}</span>
                )}
                <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={disabled} onClick={() => void chooseFolder()}>
                  {s.folder ? b.changeFolder : b.chooseFolder}
                </button>
              </div>
            </div>
            <label className="flex flex-col gap-1.5" htmlFor="auto-backup-frequency">
              <span className="caption">{b.frequencyLabel}</span>
              <Select
                id="auto-backup-frequency"
                value={s.frequency}
                disabled={disabled}
                onChange={(v) => void save({ ...s, frequency: v as BackupFrequency })}
                options={(['daily', 'weekly'] as const).map((f) => ({ value: f, label: b.frequencies[f] }))}
              />
            </label>
            <form className="flex flex-col gap-1.5" onSubmit={applyKeep} noValidate>
              <label className="caption" htmlFor="auto-backup-keep">{b.keepLabel}</label>
              <div className="flex gap-2">
                <input
                  id="auto-backup-keep"
                  inputMode="numeric"
                  className="control h-[38px] w-[72px] px-3 tabular-nums"
                  value={keepInput}
                  disabled={disabled}
                  aria-describedby="auto-backup-keep-help"
                  onChange={(e) => setKeepInput(e.target.value)}
                  onBlur={() => applyKeep()}
                />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={disabled}>{b.keepSave}</button>
              </div>
            </form>
          </div>
          <p id="auto-backup-keep-help" className="-mt-2 text-xs text-tx3">{b.keepHelp(MAX_KEEP)}</p>

          {sameDrive && s.folder && <Notice level="warn">{b.sameDrive}</Notice>}

          <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-tx3">{b.lastSuccess}</dt>
            <dd className="tabular-nums">{status.lastSuccessAt !== null ? formatDateTime(status.lastSuccessAt) : b.never}</dd>
            <dt className="text-tx3">{b.nextDue}</dt>
            <dd className="tabular-nums">{nextDueText(t, status, now)}</dd>
            {status.lastError && (status.lastFailed || status.lastError === 'pruneFailed') && (
              <>
                <dt className="text-tx3">{b.lastError}</dt>
                <dd className="text-warn">
                  {status.lastAttemptAt !== null && status.lastFailed && <span className="tabular-nums">{formatDateTime(status.lastAttemptAt)} · </span>}
                  {backupErrorText(t, status.lastError)}
                </dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary btn-sm" disabled={disabled || !s.folder} onClick={() => void runNow()}>
              {running ? b.running : b.runNow}
            </button>
            {s.folder && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => void openFolder()}>
                {b.openFolder}
              </button>
            )}
          </div>

          {message && (
            <div className={`nt ${message.tone === 'ok' ? 'nt-ok' : 'nt-bad'} break-words`} role={message.tone === 'ok' ? 'status' : 'alert'}>
              {message.text}
            </div>
          )}

          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-tx2">
            <li>{b.checkNote}</li>
            <li>{b.contentsNote}</li>
            <li className={status.encrypted ? 'text-tx' : ''}>{status.encrypted ? b.encryptedOn : b.encryptedOff}</li>
            <li>{b.restoreHint}</li>
          </ul>

          {s.folder && entries && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{b.listTitle}</h3>
              {entries.length === 0 ? (
                <p className="text-[13px] text-tx3">{b.listEmpty}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] max-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="text-xs text-tx3">
                        <th className="py-1.5 pr-4 font-medium">{b.columns.date}</th>
                        <th className="py-1.5 pr-4 text-right font-medium">{b.columns.size}</th>
                        <th className="py-1.5 font-medium">{b.columns.encrypted}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.name} style={{ borderTop: '1px solid var(--hairline)' }}>
                          <td className="py-1.5 pr-4 tabular-nums">
                            <Tooltip content={e.name}>
                              <span>{e.at}</span>
                            </Tooltip>
                            {!e.complete && (
                              <Tooltip content={b.unexpectedHelp} focusable>
                                <span className="ml-2 text-xs text-warn">({b.unexpected})</span>
                              </Tooltip>
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">{formatSize(t, e.sizeBytes)}</td>
                          <td className="py-1.5">{e.encrypted ? b.yes : b.no}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
