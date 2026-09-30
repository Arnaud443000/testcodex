import { useEffect, useState } from 'react'
import { Select } from './ui/Select'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { PDF_PERIOD_KINDS, isFileExistsError, pdfErrorText, pdfFileName, pdfPeriodRange, type PdfPeriodKind } from '../lib/pdfExport'
import { localTzOffsetMin } from '../lib/period'
import type { PdfExportRequest } from '../types/pdf'

type Notice = { tone: 'ok' | 'bad'; text: string } | null

/** Paramètres > Données : export PDF d'un bilan de période (lot 23), à côté de l'export CSV. */
export function PdfExportBlock() {
  const t = useT()
  const p = t.pdf
  const { allAccounts, selectedId } = useAccounts()
  const { status } = useLock()
  const [accountId, setAccountId] = useState<number | null>(null)
  const [kind, setKind] = useState<PdfPeriodKind>('lastYear')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [includeName, setIncludeName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  /** Fichier existant : en attente d'une confirmation explicite avant de le remplacer. */
  const [replace, setReplace] = useState<{ req: PdfExportRequest; path: string } | null>(null)

  // Compte proposé : celui de la barre du haut, sinon le premier compte actif, sinon le premier compte.
  useEffect(() => {
    if (accountId !== null && allAccounts.some((a) => a.id === accountId)) return
    const first = allAccounts.find((a) => a.id === selectedId) ?? allAccounts.find((a) => !a.archived) ?? allAccounts[0]
    setAccountId(first ? first.id : null)
  }, [allAccounts, selectedId, accountId])

  const mock = api.isBrowserPreview

  async function write(req: PdfExportRequest, path: string, overwrite: boolean) {
    setBusy(true)
    setNotice(null)
    setReplace(null)
    try {
      const r = await api.exportPeriodPdf(req, path, overwrite)
      const text = r.tradeCount === 0 ? p.doneEmpty(path) : p.done(r.tradeCount, r.pageCount, path)
      setNotice({ tone: 'ok', text: mock ? `${text} ${p.simulation}` : text })
    } catch (e) {
      if (isFileExistsError(e) && !overwrite) setReplace({ req, path })
      else setNotice({ tone: 'bad', text: pdfErrorText(t, e) })
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setNotice(null)
    setReplace(null)
    if (accountId === null) return setNotice({ tone: 'bad', text: p.errors.noAccount })
    const range = pdfPeriodRange({ kind, fromDay, toDay }, Date.now(), localTzOffsetMin())
    if (!range.ok) return setNotice({ tone: 'bad', text: p.periodErrors[range.error] })
    const req: PdfExportRequest = { accountId, from: range.from, to: range.to, includeAccountName: includeName, tzOffsetMin: localTzOffsetMin() }
    setBusy(true)
    let path: string | null
    try {
      path = await api.pickPdfPath(p.dialog, pdfFileName(new Date().toISOString().slice(0, 10)))
    } catch (e) {
      setBusy(false)
      return setNotice({ tone: 'bad', text: pdfErrorText(t, e) })
    }
    setBusy(false)
    if (path) await write(req, path, false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">{p.title}</div>
        <p className="mt-1 text-[13px] text-tx3">{p.help}</p>
        <p className="mt-1 text-[13px] text-tx2">{p.disclaimer}</p>
        {status?.enabled === true && <p className="mt-1 text-[13px] text-warn">{p.plainNote}</p>}
      </div>

      {allAccounts.length === 0 ? (
        <p className="text-[13px] text-tx2">{p.noAccount}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="caption">{p.accountLabel}</span>
              <Select
                className="min-w-[200px]"
                value={accountId === null ? '' : String(accountId)}
                disabled={busy}
                onChange={(v) => setAccountId(Number(v))}
                options={allAccounts.map((a) => ({ value: String(a.id), label: `${a.name} · ${a.currency}${a.archived ? p.archivedSuffix : ''}` }))}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="caption">{p.periodLabel}</span>
              <Select
                className="min-w-[200px]"
                value={kind}
                disabled={busy}
                onChange={(v) => setKind(v as PdfPeriodKind)}
                options={PDF_PERIOD_KINDS.map((k) => ({ value: k, label: p.period[k] }))}
              />
            </label>
            {kind === 'custom' && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="caption">{p.fromLabel}</span>
                  <input className="input !w-auto" type="date" value={fromDay} disabled={busy} onChange={(e) => setFromDay(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="caption">{p.toLabel}</span>
                  <input className="input !w-auto" type="date" value={toDay} disabled={busy} onChange={(e) => setToDay(e.target.value)} />
                </label>
              </>
            )}
            <button className="btn btn-secondary shrink-0" disabled={busy || accountId === null} onClick={() => void start()}>
              {busy ? p.working : p.button}
            </button>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet" checked={includeName} disabled={busy} onChange={(e) => setIncludeName(e.target.checked)} />
            <span>
              {p.includeName}
              <span className="mt-0.5 block text-[13px] text-tx3">{p.includeNameHelp}</span>
            </span>
          </label>
        </>
      )}

      {replace && (
        <div className="nt nt-warn flex-col" role="alertdialog" aria-label={p.replaceTitle}>
          <div className="font-medium">{p.replaceTitle}</div>
          <p className="mt-1 break-all text-[13px] text-tx3">{replace.path}</p>
          <p className="mt-1 text-[13px]">{p.replaceQuestion}</p>
          <div className="mt-3 flex gap-3">
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void write(replace.req, replace.path, true)}>{p.replaceYes}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setReplace(null)}>{p.replaceNo}</button>
          </div>
        </div>
      )}
      {notice && (
        <div className={`nt ${notice.tone === 'ok' ? 'nt-ok' : 'nt-bad'} break-all`} role={notice.tone === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </div>
      )}
    </div>
  )
}
