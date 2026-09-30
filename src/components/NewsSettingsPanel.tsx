import { useEffect, useState, type FormEvent } from 'react'
import { Select } from './ui/Select'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { CURRENCIES, FOREX_FACTORY_HOST, IMPORTANCES, formatClock, newsErrorMessage, storedErrorMessage } from '../lib/newsView'
import { formatDayLong } from '../lib/calendarFormat'
import { formatDateTime } from '../lib/format'
import type { ImportSummary, Importance, NewsFileFormat, NewsPreview, NewsSettings, NewsStatus } from '../types/news'
import { CurrencyTag, ImportanceMark, SimulationBadge } from './news/ImportanceMark'
import { Notice, Switch } from './ui'

const HEADER = 'date;heure;devise;titre;importance;prevu;precedent;reel'

/** Hôte d'une adresse saisie, pour l'affichage seulement (pulse-core la valide à l'enregistrement). */
function hostPreview(url: string): string {
  const rest = url.trim().replace(/^https?:\/\//i, '')
  return rest.split(/[/?#]/)[0].replace(/:\d*$/, '').toLowerCase()
}

function ImportanceSelect({ id, value, onChange }: { id: string; value: Importance; onChange: (v: Importance) => void }) {
  const t = useT().news
  return (
    <Select id={id} value={value} onChange={(v) => onChange(v as Importance)} options={IMPORTANCES.map((i) => ({ value: i, label: t.importance[i] }))} />
  )
}

function CurrencySelect({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  const t = useT().news.settings
  return (
    <Select
      id={id}
      value={value ?? ''}
      onChange={(v) => onChange(v || null)}
      options={[{ value: '', label: t.currencyNone }, ...CURRENCIES.map((c) => ({ value: c, label: c }))]}
    />
  )
}

/**
 * Paramètres > Calendrier économique (lots 25 et 28, ancre `/settings#news`) : désactivé par défaut ; source (fichiers
 * seulement, Forex Factory avec consentement, ou flux ICS à l'adresse choisie), ce qui part exactement, « Tester la
 * source » sans rien enregistrer avant confirmation, fenêtre et alerte 3.6.8, import de fichier, état et effacement.
 * pulse-core revalide tout et fait foi.
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
  const [busy, setBusy] = useState<'save' | 'import' | 'test' | 'keep' | null>(null)
  const [preview, setPreview] = useState<NewsPreview | null>(null)
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
  if (!status || !form) return <section id="news" className="glass-card p-6" aria-busy="true"><h2 className="text-base font-semibold">{s.title}</h2></section>

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
  const runTest = async () => {
    reset()
    setPreview(null)
    setBusy('test')
    try {
      setPreview(await api.testNewsSource(form))
    } catch (e) {
      setError(s.testFailed(newsErrorMessage(e, n)))
    } finally {
      setBusy(null)
      setStatus(await api.getNewsStatus().catch(() => status))
    }
  }
  const keepTested = async () => {
    reset()
    setBusy('keep')
    try {
      const st = await api.setNewsSettings(form)
      setStatus(st)
      setForm(st.settings)
      const r = await api.keepTestedNews()
      setStatus(r.status)
      const sum = r.summary
      if (sum) setMessage([s.testKept(sum.added, sum.updated), sum.removed > 0 ? n.page.removed(sum.removed) : ''].filter(Boolean).join(' '))
      if (sum?.partial) setError(n.page.partial(newsErrorMessage(sum.partial, n)))
    } catch (e) {
      setError(newsErrorMessage(e, n))
    } finally {
      setPreview(null)
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
    // Un test ne vaut que pour la source testée.
    if ('source' in patch || 'icsUrl' in patch || 'ffConsent' in patch) setPreview(null)
  }
  const online = form.source !== 'none'
  const canTest = form.source === 'icsUrl' ? Boolean(form.icsUrl?.trim()) : form.source === 'forexFactory' && form.ffConsent
  const savedOnline = status.settings.source === form.source && status.onlineHost
  const lastError = storedErrorMessage(status.state.lastError, n)

  return (
    <section id="news" className="glass-card flex flex-col gap-5 p-6" aria-labelledby="news-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="news-title" className="text-base font-semibold">{s.title}</h2>
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
              {(['none', 'forexFactory', 'icsUrl'] as const).map((k) => (
                <label key={k} className="flex min-h-6 items-center gap-2.5 text-sm">
                  <input type="radio" name="news-source" checked={form.source === k} onChange={() => set({ source: k })} />
                  {k === 'none' ? s.sourceNone : k === 'forexFactory' ? s.sourceFf : s.sourceIcs}
                </label>
              ))}
              <p className="max-w-[90ch] text-[12.5px] leading-relaxed text-tx3">{s.sourceHint}</p>
              {form.source === 'forexFactory' && (
                <div className="flex flex-col gap-3" data-testid="news-ff">
                  <Notice level="warn">
                    <b className="block text-tx">{s.ffTitle}</b>
                    <ul className="ml-4 mt-1.5 flex max-w-[95ch] list-disc flex-col gap-1 leading-relaxed">
                      {s.ffPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </Notice>
                  <label className="flex max-w-[95ch] items-start gap-2.5 text-sm leading-relaxed">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={form.ffConsent} onChange={(e) => set({ ffConsent: e.target.checked })} />
                    <span>{s.ffConsent}</span>
                  </label>
                  {!form.ffConsent && <p className="text-[12.5px] text-tx3">{s.ffConsentNeeded}</p>}
                </div>
              )}
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
                  {form.source === 'forexFactory'
                    ? s.whatLeavesFf(FOREX_FACTORY_HOST)
                    : form.source === 'icsUrl' && savedOnline
                      ? s.whatLeaves(status.onlineHost ?? '')
                      : form.source === 'icsUrl' && form.icsUrl?.trim()
                        ? s.whatLeaves(hostPreview(form.icsUrl))
                        : s.whatLeavesNone}
                </span>
                <span className="mt-1 block text-tx3">{s.frequency}</span>
              </div>
              {online && (
                <div className="flex flex-col gap-3" data-testid="news-test">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="btn btn-secondary" onClick={runTest} disabled={busy !== null || !canTest}>
                      {busy === 'test' ? s.testing : s.testButton}
                    </button>
                    {api.isBrowserPreview && <SimulationBadge />}
                    <span className="max-w-[70ch] text-[12.5px] leading-relaxed text-tx3">
                      {s.testHint}
                      {status.nextRequestAt ? ` ${s.nextAllowed(formatClock(status.nextRequestAt))}` : ''}
                    </span>
                  </div>
                  {preview && (
                    <Notice
                      level={preview.skippedCount > 0 || preview.partial ? 'warn' : 'ok'}
                      actions={
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={keepTested} disabled={busy !== null}>
                            {busy === 'keep' ? s.testKeeping : s.testKeep}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(null)} disabled={busy !== null}>
                            {s.testDiscard}
                          </button>
                        </>
                      }
                    >
                      <p className="font-semibold text-tx">{s.testResult(preview.count)}</p>
                      {preview.partial && <p>{n.page.partial(newsErrorMessage(preview.partial, n))}</p>}
                      {preview.skippedCount > 0 && (
                        <>
                          <p>{s.skipped(preview.skippedCount)}</p>
                          <ul className="ml-4 list-disc">
                            {preview.skipped.slice(0, 5).map((k) => (
                              <li key={`${k.line}-${k.reason}`}>{s.skippedItem(k.line, n.skipReasons[k.reason])}</li>
                            ))}
                          </ul>
                          {preview.skippedCount > 5 && <p>{s.skippedMore(preview.skippedCount - 5)}</p>}
                        </>
                      )}
                      {preview.events.length === 0 ? (
                        <p className="mt-1">{s.testNone}</p>
                      ) : (
                        <>
                          <p className="mt-1">{s.testFirst}</p>
                          <ul className="mt-1 flex flex-col gap-1.5" data-testid="news-preview">
                            {preview.events.map((e) => (
                              <li key={`${e.day}-${e.parisTime}-${e.currency}-${e.title}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="tabular-nums text-tx">
                                  <span className="first-letter:uppercase">{formatDayLong(e.day)}</span>
                                  {' · '}
                                  {e.parisTime ?? <span title={n.allDayHint}>{n.allDay}</span>}
                                </span>
                                <CurrencyTag currency={e.currency} />
                                <span className="font-medium text-tx">{e.title}</span>
                                <ImportanceMark importance={e.importance} />
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-tx3">{n.parisNote}</p>
                        </>
                      )}
                    </Notice>
                  )}
                </div>
              )}
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
                <Select
                  value={format}
                  onChange={(v) => setFormat(v as NewsFileFormat)}
                  options={[
                    { value: 'ics', label: s.formatIcs },
                    { value: 'csv', label: s.formatCsv },
                  ]}
                />
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
