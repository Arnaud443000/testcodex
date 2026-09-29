import { useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { lockErrorText, parseLockError } from '../lib/lockView'
import type { BackupInfo } from '../types/data'
import { PdfExportBlock } from './PdfExportBlock'
import { Field } from './ui'

type Notice = { tone: 'ok' | 'bad'; text: string } | null

const errText = (e: unknown) => String(e instanceof Error ? e.message : e)

/** Paramètres > Données : export CSV, sauvegarde manuelle, restauration. */
export function DataPanel() {
  const t = useT()
  const d = t.settings.data
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  /** Sauvegarde choisie, en attente de confirmation explicite. */
  const [pending, setPending] = useState<BackupInfo | null>(null)
  const [restored, setRestored] = useState(false)
  // Lot 22 : sauvegarde chiffrée. Son mot de passe ne reste en mémoire que le temps de confirmer la restauration.
  const { status } = useLock()
  const lockOn = status?.enabled === true
  const [askFolder, setAskFolder] = useState<string | null>(null)
  const [backupPw, setBackupPw] = useState('')
  const [pendingPw, setPendingPw] = useState<string | undefined>(undefined)

  async function run(action: () => Promise<Notice | void>) {
    setBusy(true)
    setNotice(null)
    try {
      const n = await action()
      if (n) setNotice(n)
    } catch (e) {
      setNotice({ tone: 'bad', text: parseLockError(e) ? lockErrorText(t, e) : d.error(errText(e)) })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () =>
    run(async () => {
      const path = await api.pickCsvPath(d.exportDialog, d.exportFileName(new Date().toISOString().slice(0, 10)))
      if (!path) return
      const n = await api.exportTradesCsv(path)
      return { tone: 'ok', text: d.exportDone(n, path) }
    })

  const backUp = () =>
    run(async () => {
      const dir = await api.pickFolder(d.backupDialog)
      if (!dir) return
      const info = await api.createBackup(dir)
      return { tone: 'ok', text: d.backupDone(info.path, info.trades, info.screenshots) }
    })

  const chooseRestore = () =>
    run(async () => {
      const dir = await api.pickFolder(d.restoreDialog)
      if (!dir) return
      try {
        setPending(await api.inspectBackup(dir))
      } catch (e) {
        if (parseLockError(e)?.code !== 'backupPasswordRequired') throw e
        setAskFolder(dir)
      }
    })

  function openEncrypted(e: FormEvent) {
    e.preventDefault()
    if (!askFolder) return
    const [folder, password] = [askFolder, backupPw]
    setBackupPw('')
    void run(async () => {
      if (!password) return { tone: 'bad', text: t.lock.errors.empty }
      setPending(await api.inspectBackup(folder, password))
      setPendingPw(password)
      setAskFolder(null)
    })
  }

  function cancelRestore() {
    setPending(null)
    setPendingPw(undefined)
    setAskFolder(null)
    setBackupPw('')
  }

  const confirmRestore = () =>
    run(async () => {
      if (!pending) return
      const res = await api.restoreBackup(pending.path, true, pendingPw)
      setPending(null)
      setPendingPw(undefined)
      setRestored(true)
      return { tone: 'ok', text: d.restoreDone(res.safetyCopy) }
    })

  return (
    <section className="glass-card p-6">
      <h2 className="mb-1 text-base font-semibold">{d.title}</h2>
      <p className="mb-5 text-sm text-tx3">{d.intro}</p>

      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.exportTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.exportHelp}</p>
            {lockOn && <p className="mt-1 text-[13px] text-warn">{t.lock.data.csvPlain}</p>}
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy} onClick={exportCsv}>{d.exportButton}</button>
        </div>

        <PdfExportBlock />

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.backupTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.backupHelp}</p>
            {lockOn && <p className="mt-1 text-[13px] text-tx2">{t.lock.data.backupEncrypted}</p>}
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy || restored} onClick={backUp}>{d.backupButton}</button>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.restoreTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.restoreHelp}</p>
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy || restored || pending !== null || askFolder !== null} onClick={chooseRestore}>
            {d.restoreButton}
          </button>
        </div>
      </div>

      {askFolder && (
        <form onSubmit={openEncrypted} className="nt nt-warn mt-5 flex-col" aria-label={t.lock.data.encryptedBadge} noValidate>
          <div className="flex items-center gap-2 font-medium">
            <span className="badge badge-warn">{t.lock.data.encryptedBadge}</span>
          </div>
          <p className="break-all text-[13px] text-tx3">{askFolder}</p>
          <Field label={t.lock.data.backupPasswordLabel} htmlFor="backup-password" className="mt-1 max-w-[360px]">
            <input id="backup-password" type="password" autoComplete="off" className="control h-[42px] px-3.5 text-tx" value={backupPw} onChange={(e) => setBackupPw(e.target.value)} disabled={busy} />
          </Field>
          <p className="text-[13px]">{t.lock.data.backupPasswordHelp}</p>
          <div className="mt-1 flex gap-3">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t.lock.data.open}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={cancelRestore}>{d.confirmNo}</button>
          </div>
        </form>
      )}

      {pending && (
        <div className="nt nt-warn mt-5" role="alertdialog" aria-label={d.confirmTitle}>
          <div className="flex items-center gap-2 font-medium">
            {d.confirmTitle}
            {pending.encrypted && <span className="badge badge-warn">{t.lock.data.encryptedBadge}</span>}
          </div>
          <p className="mt-1 text-[13px]">{d.confirmSummary(pending.accounts, pending.trades, pending.screenshots)}</p>
          <p className="mt-1 text-[13px]">{d.confirmWarning}</p>
          <p className="mt-1 break-all text-[13px] text-tx3">{pending.path}</p>
          {pending.encrypted && !lockOn && <p className="mt-1 text-[13px]">{t.lock.data.restoreIntoPlain}</p>}
          <div className="mt-3 flex gap-3">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={confirmRestore}>{d.confirmYes}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={cancelRestore}>{d.confirmNo}</button>
          </div>
        </div>
      )}

      {notice && (
        <div className={`nt ${notice.tone === 'ok' ? 'nt-ok' : 'nt-bad'} mt-5 break-all`} role={notice.tone === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </div>
      )}
      {restored && (
        <button className="btn btn-primary mt-3" onClick={() => window.location.reload()}>{d.reload}</button>
      )}
    </section>
  )
}
