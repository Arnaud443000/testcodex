import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { CURRENCIES, IMPORTANCES, newsErrorMessage, storedErrorMessage } from '../lib/newsView'
import { formatDateTime } from '../lib/format'
import type { ImportSummary, Importance, NewsFileFormat, NewsSettings, NewsStatus } from '../types/news'
import { Notice, Switch } from './ui'

const HEADER = 'date;heure;devise;titre;importance;prevu;precedent;reel'

function ImportanceSelect({ id, value, onChange }: { id: string; value: Importance; onChange: (v: Importance) => void }) {
  const t = useT().news
  return (
    <select id={id} className="control h-[42px] px-3.5" value={value} onChange={(e) => onChange(e.target.value as Importance)}>
      {IMPORTANCES.map((i) => (
        <option key={i} value={i} className="bg-bg">{t.importance[i]}</option>
      ))}
    </select>
  )
}

function CurrencySelect({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  const t = useT().news.settings
  return (
    <select id={id} className="control h-[42px] px-3.5" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="" className="bg-bg">{t.currencyNone}</option>
      {CURRENCIES.map((c) => (
        <option key={c} value={c} className="bg-bg">{c}</option>
      ))}
    </select>
  )
}

/**
 * Paramètres > Calendrier économique (lot 25, ancre `/settings#news`) : désactivé par défaut ; source (fichiers
 * seulement, ou flux ICS à l'adresse choisie), ce qui part exactement, fenêtre et alerte 3.6.8, import de fichier,
 * état et effacement. pulse-core revalide tout et fait foi.
 */
export function NewsSettingsPanel() {
  const t = useT()
  const n = t.news
  const s = n.settings
  const [status, setStatus] = useState<NewsStatus | null>(null)
  const [form, setForm] = useState<NewsSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'import' | null>(null)
  const [format, setFormat] = useState<NewsFileFormat>('ics')
  const [fileImportance, setFileImportance] = useState<Importance>('medium')
  const [fileCurrency, setFileCurrency] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    api
      .getNewsStatus()
      .then((st) => {
        setStatus(st)
        setForm(st.settings)
      })
      .catch((e) => setLoadError(s.loadError(newsErrorMessage(e, n))))
  }, [s, n])

  if (loadError) return <section id="news" className="glass-card p-6"><div className="nt nt-bad" role="alert">{loadError}</div></section>
  if (!status || !form) return <section id="news" className="glass-card p-6" aria-busy="true"><h3 className="text-base font-semibold">{s.title}</h3></section>

  const reset = () => {
    setError(null)
    setMessage(null)
  }
  const apply = async (next: NewsSettings, done?: string) => {
    reset()
    setBusy('save')
    try {
      const st = await api.setNewsSettings(next)
      setStatus(st)
      setForm(st.settings)
      if (done) setMessage(done)
    } catch (e) {
      setError(newsErrorMessage(e, n))
    } finally {
      setBusy(null)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void apply(form, s.saved)
  }
  const importFile = async () => {
    reset()
    setSummary(null)
    const path = await api.pickNewsFile(s.importTitle, format)
    if (!path) return
    setBusy('import')
    try {
      const r = await api.importNewsFile(format, path, { importance: fileImportance, currency: fileCurrency })
      setSummary(r)
      setStatus(await api.getNewsStatus())
    } catch (e) {
      setError(newsErrorMessage(e, n))
    } finally {
      setBusy(null)
    }
  }
  const clear = async () => {
    reset()
    setConfirmClear(false)
    try {
      const count = await api.clearNewsEvents()
      setMessage(s.cleared(count))
      setStatus(await api.getNewsStatus())
    } catch (e) {
      setError(newsErrorMessage(e, n))
    }
  }

  const enabled = status.settings.enabled
  const set = (patch: Partial<NewsSettings>) => {
    setForm({ ...form, ...patch })
    setMessage(null)
  }
  const lastError = storedErrorMessage(status.state.lastError, n)

  return (
    <section id="news" className="glass-card flex flex-col gap-5 p-6" aria-labelledby="news-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="news-title" className="text-base font-semibold">{s.title}</h3>
          <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{s.intro}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-tx2">{enabled ? s.on : s.off}</span>
          <Switch on={enabled} label={s.enable} onChange={(on) => void apply({ ...status.settings, enabled: on })} />
        </div>
      </div>

      {error && <Notice level="bad">{error}</Notice>}
      {message && <Notice level="ok">{message}</Notice>}

      {!enabled ? (
        <p className="text-[13px] text-tx3">{s.offText}</p>
      ) : (
        <>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <legend className="caption mb-2">{s.sourceTitle}</legend>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="radio" name="news-source" checked={form.source === 'none'} onChange={() => set({ source: 'none' })} />
                {s.sourceNone}
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="radio" name="news-source" checked={form.source === 'icsUrl'} onChange={() => set({ source: 'icsUrl' })} />
                {s.sourceIcs}
              </label>
              <p className="max-w-[90ch] text-[12.5px] leading-relaxed text-tx3">{s.sourcePending}</p>
              {form.source === 'icsUrl' && (
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="caption">{s.urlLabel}</span>
                    <input
                      className="control h-[42px] px-3.5"
                      value={form.icsUrl ?? ''}
                      placeholder={s.urlPlaceholder}
                      onChange={(e) => set({ icsUrl: e.target.value })}
                      spellCheck={false}
                      autoComplete="off"
                      inputMode="url"
                    />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="caption">{s.feedImportance}</span>
                    <ImportanceSelect id="news-feed-importance" value={form.icsImportance} onChange={(v) => set({ icsImportance: v })} />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="caption">{s.feedCurrency}</span>
                    <CurrencySelect id="news-feed-currency" value={form.icsCurrency} onChange={(v) => set({ icsCurrency: v })} />
                  </label>
                  <p className="col-span-3 text-[12.5px] text-tx3">{s.feedDefaultsHint}</p>
                </div>
              )}
              <div className="rounded-[14px] border px-4 py-3 text-[13px] leading-relaxed" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.03)' }}>
                <b className="block text-tx">{s.whatLeavesTitle}</b>
                <span className="text-tx2">
                  {status.settings.source === 'icsUrl' && status.onlineHost ? s.whatLeaves(status.onlineHost) : s.whatLeavesNone}
                </span>
                <span className="mt-1 block text-tx3">{s.frequency}</span>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="caption mb-2">{s.windowTitle}</legend>
              <div className="flex items-center gap-3">
                <Switch on={form.alert} label={s.alertSwitch} onChange={(on) => set({ alert: on })} />
                <span className="text-sm">{s.alertSwitch} · {form.alert ? s.on : s.off}</span>
              </div>
              <p className="max-w-[90ch] text-[12.5px] leading-relaxed text-tx2">{s.alertExplain}</p>
              <p className="max-w-[90ch] text-[12.5px] leading-relaxed text-tx3">{s.crossExplain}</p>
              <div className="flex gap-4">
                {(['windowBeforeMin', 'windowAfterMin'] as const).map((k) => (
                  <label key={k} className="flex w-[180px] flex-col gap-1.5">
                    <span className="caption">{k === 'windowBeforeMin' ? s.before : s.after}</span>
                    <span className="relative">
                      <input
                        type="number"
                        min={0}
                        max={240}
                        className="control h-[42px] w-full px-3.5 pr-12 tabular-nums"
                        value={form[k]}
                        onChange={(e) => set({ [k]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-tx3">{s.minutes}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === 'save' ? s.saving : s.save}</button>
            </div>
          </form>

          <div className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: 'var(--hairline)' }}>
            <h4 className="text-sm font-semibold">{s.importTitle}</h4>
            <p className="text-[13px] text-tx2">{s.importIntro}</p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="caption">{s.formatLabel}</span>
                <select className="control h-[42px] px-3.5" value={format} onChange={(e) => setFormat(e.target.value as NewsFileFormat)}>
                  <option value="ics" className="bg-bg">{s.formatIcs}</option>
                  <option value="csv" className="bg-bg">{s.formatCsv}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="caption">{s.fileImportance}</span>
                <ImportanceSelect id="news-file-importance" value={fileImportance} onChange={setFileImportance} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="caption">{s.fileCurrency}</span>
                <CurrencySelect id="news-file-currency" value={fileCurrency} onChange={setFileCurrency} />
              </label>
              <button type="button" className="btn btn-secondary" onClick={importFile} disabled={busy !== null}>
                {busy === 'import' ? s.importing : s.importButton}
              </button>
            </div>
            <p className="text-[12.5px] leading-relaxed text-tx3">
              {format === 'csv' ? (
                <>
                  {s.csvHelp} <code className="rounded bg-white/5 px-1.5 py-0.5 text-tx2">{HEADER}</code>
                </>
              ) : (
                s.icsHelp
              )}
            </p>
            {summary && (
              <Notice level={summary.skippedCount > 0 ? 'warn' : 'ok'}>
                <p>{s.imported(summary.added, summary.updated)}</p>
                {summary.purged > 0 && <p>{s.purged(summary.purged)}</p>}
                {summary.skippedCount > 0 && (
                  <>
                    <p>{s.skipped(summary.skippedCount)}</p>
                    <ul className="ml-4 list-disc">
                      {summary.skipped.slice(0, 8).map((k) => (
                        <li key={`${k.line}-${k.reason}`}>{s.skippedLine(k.line, n.skipReasons[k.reason])}</li>
                      ))}
                    </ul>
                    {summary.skippedCount > 8 && <p>{s.skippedMore(summary.skippedCount - 8)}</p>}
                  </>
                )}
              </Notice>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-5 text-[13px] text-tx2" style={{ borderColor: 'var(--hairline)' }}>
            <h4 className="text-sm font-semibold text-tx">{s.stateTitle}</h4>
            <p>
              {s.eventCount(status.eventCount)}
              {' · '}
              {status.state.lastSuccessAt ? n.page.lastUpdate(formatDateTime(status.state.lastSuccessAt)) : n.page.neverUpdated}
              {status.state.lastImportAt ? ` · ${n.page.lastImport(formatDateTime(status.state.lastImportAt))}` : ''}
            </p>
            {lastError && <Notice level="warn">{n.page.lastError(lastError)}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Link to="/calendar/news" className="btn btn-secondary btn-sm">{s.openCalendar}</Link>
              {confirmClear ? (
                <>
                  <span className="self-center">{s.clearConfirm}</span>
                  <button type="button" className="btn btn-danger btn-sm" onClick={clear}>{s.clearYes}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmClear(false)}>{s.cancel}</button>
                </>
              ) : (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)} disabled={status.eventCount === 0}>
                  {s.clear}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
