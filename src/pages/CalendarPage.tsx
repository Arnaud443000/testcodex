import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarGrid } from '../components/CalendarGrid'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { CalendarTabs } from '../components/news/CalendarTabs'
import { Pnl } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDayLong, formatMonthTitle, shiftMonth } from '../lib/calendarFormat'
import { formatDateTime, formatR, formatRatioPercent } from '../lib/format'
import { localTzOffsetMin } from '../lib/period'
import type { Calendar, DayTrade } from '../types/stats'

export function CalendarPage() {
  const t = useT()
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const now = new Date()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [data, setData] = useState<Calendar | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [dayTrades, setDayTrades] = useState<DayTrade[] | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixed = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixed

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    api
      .getCalendar({ accountIds, year: ym.year, month: ym.month, tzOffsetMin: localTzOffsetMin() })
      .then((c) => {
        if (cancelled) return
        setData(c)
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, accountIds, ym])

  useEffect(() => {
    if (!ready || !day) {
      setDayTrades(null)
      return
    }
    let cancelled = false
    setDayTrades(null)
    api
      .getDayTrades(accountIds, day)
      .then((r) => !cancelled && setDayTrades(r))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, accountIds, day])

  const go = (delta: -1 | 1) => {
    setYm((cur) => shiftMonth(cur.year, cur.month, delta))
    setDay(null)
  }
  const goToday = () => {
    setYm({ year: now.getFullYear(), month: now.getMonth() + 1 })
    setDay(null)
  }

  const title = formatMonthTitle(ym.year, ym.month)
  const header = (
    <>
    <CalendarTabs />
    <PageHeader
      title={t.pages.calendar.title}
      subtitle={t.pages.calendar.subtitle}
      actions={
        <div className="flex items-center gap-2">
          <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full" aria-label={t.calendar.previous} onClick={() => go(-1)}>
            <Icon name="left" size={18} />
          </button>
          <span className="min-w-[150px] text-center text-[15px] font-semibold capitalize" aria-live="polite">{title}</span>
          <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full" aria-label={t.calendar.next} onClick={() => go(1)}>
            <Icon name="right" size={18} />
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={goToday}>{t.calendar.today}</button>
        </div>
      }
    />
    </>
  )

  if (loading) return <div className="flex flex-col gap-5">{header}</div>
  if (chosen.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {t.common.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (mixed) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.dashboard.mixedCurrenciesTitle}>{t.dashboard.mixedCurrenciesText}</EmptyState>
        </section>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="nt nt-bad" role="alert">{t.calendar.loadError(error)}</div>
      </div>
    )
  }

  const currency = data?.currency ?? chosen[0].currency
  const selected = data?.days.find((d) => day !== null && d.day === day)

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="grid grid-cols-12 gap-6">
        <section className="glass-card col-span-12 p-6 xl:col-span-8">
          {data && data.days.length === 0 ? (
            <>
              <EmptyState title={t.calendar.emptyMonthTitle}>{t.calendar.emptyMonthText}</EmptyState>
              <CalendarGrid calendar={data} />
            </>
          ) : (
            data && (
              <>
                <CalendarGrid calendar={data} selectedDay={day} onSelect={setDay} />
                <p className="mt-4 text-xs leading-relaxed text-tx3">{t.calendar.hint} {t.calendar.legend}</p>
              </>
            )
          )}
        </section>
        <div className="col-span-12 flex flex-col gap-6 xl:col-span-4">
          <section className="glass-card p-6">
            <h3 className="mb-2 text-base font-semibold">{t.calendar.monthSummary}</h3>
            {data && (
              <>
                <div className="hairline-row">
                  <span className="text-tx2">{t.calendar.netPnl}</span>
                  <Pnl value={data.summary.netPnl} currency={currency} className="text-lg font-semibold" />
                </div>
                <div className="hairline-row"><span className="text-tx2">{t.calendar.tradesLabel}</span><span>{data.summary.tradeCount}</span></div>
                <div className="hairline-row"><span className="text-tx2">{t.calendar.winRate}</span><span>{formatRatioPercent(data.summary.winRate)}</span></div>
              </>
            )}
          </section>
          <section className="glass-card p-6" aria-live="polite">
            <h3 className="mb-2 text-base font-semibold">{day ? formatDayLong(day) : t.calendar.selectDay}</h3>
            {!day ? (
              <p className="text-sm text-tx2">{t.calendar.hint}</p>
            ) : dayTrades === null ? (
              <p className="text-sm text-tx2">{t.common.loading}</p>
            ) : dayTrades.length === 0 ? (
              <p className="text-sm text-tx2">{t.calendar.dayNone}</p>
            ) : (
              <>
                {selected && (
                  <div className="hairline-row">
                    <span className="text-tx2">{t.calendar.netPnl}</span>
                    <Pnl value={selected.netPnl} currency={currency} className="font-semibold" />
                  </div>
                )}
                <ul>
                  {dayTrades.map((tr) => (
                    <li key={tr.tradeId} className="hairline-row">
                      <span>
                        <b>{tr.symbol}</b> <span className="text-tx2">{t.common.directions[tr.direction]}</span>
                        <span className="block text-xs text-tx3">{formatDateTime(tr.exitTime)} · {formatR(tr.rMultiple)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Pnl value={tr.netPnl} currency={currency} className="font-semibold" />
                        <Link to={`/trades/${tr.tradeId}`} className="btn-link">{t.calendar.openTrade}</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
