import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { CalendarTabs } from '../components/news/CalendarTabs'
import { CurrencyTag, ImportanceMark, SimulationBadge } from '../components/news/ImportanceMark'
import { ChipButton, Notice, Segmented } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatDayLong } from '../lib/calendarFormat'
import { formatDateTime } from '../lib/format'
import { IMPORTANCES, groupByDay, newsErrorMessage, storedErrorMessage, toggle, valueCells } from '../lib/newsView'
import type { CalendarView, Importance, NewsCalendar, NewsStatus } from '../types/news'

/**
 * Calendrier économique (lot 25, cahier 3.6.8) : aujourd'hui ou la semaine de Paris, filtres par importance et
 * par devise. Aucune heure n'est convertie ici : pulse-core renvoie jour et heure de Paris.
 */
export function EconomicCalendarPage() {
  const t = useT()
  const n = t.news
  const [view, setView] = useState<CalendarView>('week')
  const [importances, setImportances] = useState<Importance[]>([])
  const [currency, setCurrency] = useState('')
  const [status, setStatus] = useState<NewsStatus | null>(null)
  const [data, setData] = useState<NewsCalendar | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.getNewsStatus(), api.getNewsCalendar(view, { importances, currencies: currency ? [currency] : [] })])
      setStatus(s)
      setData(c)
      setLoadError(null)
    } catch (e) {
      setLoadError(n.page.loadError(newsErrorMessage(e, n)))
    }
  }, [view, importances, currency, n])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const r = await api.refreshNews(true)
      if (r.summary) setMessage(n.page.refreshed(r.summary.added, r.summary.updated))
    } catch (e) {
      setError(newsErrorMessage(e, n))
    } finally {
      setBusy(false)
      void load()
    }
  }

  const simulation = data?.events.some((e) => e.source === 'simulation') ?? false
  const header = (
    <>
      <CalendarTabs />
      <PageHeader
        title={n.page.title}
        subtitle={n.page.subtitle}
        actions={
          <div className="flex items-center gap-3">
            {simulation && <SimulationBadge />}
            {status?.onlineReady && (
              <button type="button" className="btn btn-secondary" onClick={refresh} disabled={busy} title={n.page.refreshHint}>
                <Icon name="reset" size={16} />
                {busy ? n.page.refreshing : n.page.refresh}
              </button>
            )}
          </div>
        }
      />
    </>
  )

  if (status && !status.settings.enabled) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState
            title={n.page.emptyDisabledTitle}
            action={
              <Link to="/settings#news" className="btn btn-primary">
                {n.page.openSettings}
              </Link>
            }
          >
            {n.page.emptyDisabledText}
          </EmptyState>
        </section>
      </div>
    )
  }

  const lastError = storedErrorMessage(status?.state.lastError ?? null, n)
  const groups = data ? groupByDay(data.events) : []
  const filtered = importances.length > 0 || currency !== ''

  return (
    <div className="flex flex-col gap-5">
      {header}
      {loadError && <Notice level="bad">{loadError}</Notice>}
      {error && <Notice level="bad">{error}</Notice>}
      {message && <Notice level="ok">{message}</Notice>}
      {status && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-tx2" data-testid="news-status">
          <span>{status.state.lastSuccessAt ? n.page.lastUpdate(formatDateTime(status.state.lastSuccessAt)) : status.onlineReady ? n.page.neverUpdated : n.page.offlineSource}</span>
          {status.state.lastImportAt && <span>{n.page.lastImport(formatDateTime(status.state.lastImportAt))}</span>}
          <span className="text-tx3">{n.parisNote}</span>
          <Link to="/settings#news" className="text-[13px] font-semibold text-[#B7AEF5] hover:underline">
            {n.page.settingsLink}
          </Link>
        </div>
      )}
      {lastError && <Notice level="warn">{n.page.lastError(lastError)}</Notice>}

      <section className="glass-card flex flex-wrap items-end gap-5 p-5">
        <div className="flex flex-col gap-1.5">
          <span className="caption">{n.page.viewLabel}</span>
          <div className="w-[260px]">
            <Segmented<CalendarView>
              label={n.page.viewLabel}
              value={view}
              onChange={(v) => v && setView(v)}
              options={[
                { value: 'today', label: n.page.today },
                { value: 'week', label: n.page.week },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="caption" id="news-importance">{n.page.importanceFilter}</span>
          <div role="group" aria-labelledby="news-importance" className="flex gap-2">
            {IMPORTANCES.map((i) => (
              <ChipButton key={i} on={importances.includes(i)} onClick={() => setImportances((cur) => toggle(cur, i))}>
                {n.importance[i]}
              </ChipButton>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="caption">{n.page.currencyFilter}</span>
          <span className="relative">
            <select className="control h-[42px] min-w-[190px] appearance-none px-3.5 pr-9" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="" className="bg-bg">{n.page.allCurrencies}</option>
              {(data?.currencies ?? []).map((c) => (
                <option key={c} value={c} className="bg-bg">{c}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
          </span>
        </label>
        {data && <span className="ml-auto text-[13px] text-tx3">{n.page.count(data.events.length)}</span>}
      </section>

      {data && data.events.length === 0 ? (
        <section className="glass-card">
          {filtered ? (
            <EmptyState title={n.page.emptyFilteredTitle}>{n.page.emptyFilteredText}</EmptyState>
          ) : (
            <EmptyState
              title={n.page.emptyNoEventsTitle}
              action={
                <Link to="/settings#news" className="btn btn-secondary">
                  {n.page.openSettings}
                </Link>
              }
            >
              {n.page.emptyNoEventsText}
            </EmptyState>
          )}
        </section>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="glass-card p-5" aria-labelledby={`news-day-${g.day}`}>
            <h2 id={`news-day-${g.day}`} className="mb-3 flex items-center gap-3 text-base font-semibold first-letter:uppercase">
              <span className="first-letter:uppercase">{formatDayLong(g.day)}</span>
              {data && g.day === data.today && <span className="badge badge-gain">{n.page.todayTag}</span>}
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="caption text-left">
                  <th className="w-[92px] pb-2 font-normal">{n.page.columns.time}</th>
                  <th className="w-[92px] pb-2 font-normal">{n.page.columns.currency}</th>
                  <th className="pb-2 font-normal">{n.page.columns.event}</th>
                  <th className="w-[130px] pb-2 font-normal">{n.page.columns.importance}</th>
                  <th className="w-[260px] pb-2 text-right font-normal">{n.page.columns.values}</th>
                </tr>
              </thead>
              <tbody>
                {g.events.map((e) => {
                  const [forecast, previous, actual] = valueCells(e)
                  return (
                    <tr key={e.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                      <td className="py-3 tabular-nums">
                        {e.parisTime ?? <span className="text-tx3" title={n.allDayHint}>{n.allDay}</span>}
                      </td>
                      <td className="py-3"><CurrencyTag currency={e.currency} /></td>
                      <td className="py-3 pr-4 font-medium">{e.title}</td>
                      <td className="py-3"><ImportanceMark importance={e.importance} /></td>
                      <td className="py-3 text-right tabular-nums text-tx2">
                        <span title={n.values.forecast}>{forecast}</span>
                        <span className="px-1.5 text-tx3">·</span>
                        <span title={n.values.previous}>{previous}</span>
                        <span className="px-1.5 text-tx3">·</span>
                        <span title={n.values.actual} className={e.actual ? 'font-semibold text-tx' : ''}>{actual}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  )
}
