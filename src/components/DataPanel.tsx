import { useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import type { BackupInfo } from '../types/data'

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

  async function run(action: () => Promise<Notice | void>) {
    setBusy(true)
    setNotice(null)
    try {
      const n = await action()
      if (n) setNotice(n)
    } catch (e) {
      setNotice({ tone: 'bad', text: d.error(errText(e)) })
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
      setPending(await api.inspectBackup(dir))
    })

  const confirmRestore = () =>
    run(async () => {
      if (!pending) return
      const res = await api.restoreBackup(pending.path, true)
      setPending(null)
      setRestored(true)
      return { tone: 'ok', text: d.restoreDone(res.safetyCopy) }
    })

  return (
    <section className="glass-card p-6">
      <h3 className="mb-1 text-base font-semibold">{d.title}</h3>
      <p className="mb-5 text-sm text-tx3">{d.intro}</p>

      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.exportTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.exportHelp}</p>
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy} onClick={exportCsv}>{d.exportButton}</button>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.backupTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.backupHelp}</p>
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy || restored} onClick={backUp}>{d.backupButton}</button>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-medium">{d.restoreTitle}</div>
            <p className="mt-1 text-[13px] text-tx3">{d.restoreHelp}</p>
          </div>
          <button className="btn btn-secondary shrink-0" disabled={busy || restored || pending !== null} onClick={chooseRestore}>
            {d.restoreButton}
          </button>
        </div>
      </div>

      {pending && (
        <div className="nt nt-warn mt-5" role="alertdialog" aria-label={d.confirmTitle}>
          <div className="font-medium">{d.confirmTitle}</div>
          <p className="mt-1 text-[13px]">{d.confirmSummary(pending.accounts, pending.trades, pending.screenshots)}</p>
          <p className="mt-1 text-[13px]">{d.confirmWarning}</p>
          <p className="mt-1 break-all text-[13px] text-tx3">{pending.path}</p>
          <div className="mt-3 flex gap-3">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={confirmRestore}>{d.confirmYes}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPending(null)}>{d.confirmNo}</button>
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
