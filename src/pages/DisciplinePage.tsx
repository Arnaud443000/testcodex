import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DayBars } from '../components/behavior/DayBars'
import { Card, EmptyLine, Note, toneOfDecimal } from '../components/behavior/parts'
import { QuadrantsGrid, Ring } from '../components/behavior/ScoreRing'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { OutcomeBadge } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatScore } from '../lib/behaviorFormat'
import { formatDayLong } from '../lib/calendarFormat'
import { formatDateTime, formatRatioPercent, formatSignedMoney } from '../lib/format'
import { localTzOffsetMin, periodRange, usePeriod } from '../lib/period'
import type { DisciplineReport } from '../types/behavior'

/** Page « Discipline » : jauge, composantes avec poids et couverture, score par jour, gagnant/perdant × bien/mal exécuté. */
export function DisciplinePage() {
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const t = useT()
  const [report, setReport] = useState<DisciplineReport | null>(null)
  const [symbols, setSymbols] = useState<Map<number, string>>(new Map())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixedCurrencies

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setReport(null)
    setSelectedDay(null)
    const query = { accountIds, ...periodRange(period, Date.now(), localTzOffsetMin()) }
    Promise.all([api.getDiscipline(query), api.listTrades(selectedId === null ? undefined : { accountIds: [selectedId] })])
      .then(([r, trades]) => {
        if (cancelled) return
        setReport(r)
        setSymbols(new Map(trades.map((x) => [x.id, x.symbol])))
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, accountIds, period, selectedId])

  const d = t.disciplinePage
  const header = <PageHeader title={t.pages.discipline.title} subtitle={d.subtitle(t.behavior.periodLabels[period])} />
  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-5">
      {header}
      {body}
    </div>
  )

  if (loading) return wrap(null)
  if (chosen.length === 0) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={d.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{d.createAccount}</Link>}>
          {d.noAccountText}
        </EmptyState>
      </section>,
    )
  }
  if (mixedCurrencies) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={d.mixedTitle}>{d.mixedText}</EmptyState>
      </section>,
    )
  }
  if (error) return wrap(<div className="nt nt-bad" role="alert">{d.loadError(error)}</div>)
  if (!report) return wrap(null)
  if (report.trades.length === 0) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={d.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{d.addTrade}</Link>}>
          {d.noTradesText}
        </EmptyState>
      </section>,
    )
  }

  const currency = chosen[0].currency
  const b = t.behavior.discipline
  const day = selectedDay === null ? null : report.days.find((x) => x.day === selectedDay) ?? null
  const dayTrades = day === null ? [] : report.trades.filter((x) => x.day === day.day)

  return wrap(
    <div className="grid grid-cols-12 gap-6">
      <Card title={d.gauge} span="xl:col-span-4">
        <Ring score={report.score} />
        {report.sampleTooSmall ? (
          <div className="nt nt-warn mt-3" role="status">
            <b aria-hidden="true">i</b>
            <span>
              <b>{b.tooSmallTitle}.</b> {b.tooSmall(report.scoredTradeCount, report.minTradeCount)}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-center text-xs text-tx3">{b.basedOn(report.scoredTradeCount)}</p>
        )}
        <Note>
          {d.settingsNote} <Link to="/settings" className="text-tx-accent underline underline-offset-2">{d.settingsLink}</Link>
        </Note>
      </Card>

      <Card title={d.components} span="xl:col-span-8">
        <p className="mb-3 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{d.componentsIntro}</p>
        <ul>
          {report.components.map((c) => (
            <li key={c.key} className="border-b py-3 last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{b.components[c.key]}</span>
                {c.average === null ? (
                  <span className="text-tx3" title={b.componentEmpty}>—</span>
                ) : (
                  <b className="tabular-nums">{formatRatioPercent(c.average, 0)}</b>
                )}
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full"
                style={{ background: 'rgba(255,255,255,.08)' }}
                role="img"
                aria-label={c.average === null ? d.excludedTitle : formatRatioPercent(c.average, 0)}
              >
                {c.average !== null && <div className="h-full rounded-full" style={{ width: `${c.average * 100}%`, background: 'var(--grad)' }} />}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-tx3">
                <span>{d.weight(c.weight)}</span>
                {c.average === null ? (
                  <span className="text-[#E5C078]">
                    <b>{d.excludedTitle}.</b> {c.key === 'risk' && report.settings.maxRiskPercent === null ? b.riskNoLimit : d.excludedText}
                  </span>
                ) : (
                  <span>{d.coverage(c.tradeCount, report.trades.length)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={d.perDay} span="xl:col-span-8">
        <p className="mb-5 text-[13px] text-tx2">{d.perDayIntro} {d.thresholdLine(report.quadrants.threshold)}</p>
        {report.days.length === 0 ? (
          <EmptyLine>{d.noTradesText}</EmptyLine>
        ) : (
          <DayBars days={report.days} threshold={report.quadrants.threshold} selected={selectedDay} onSelect={setSelectedDay} />
        )}
        {day !== null && (
          <div className="mt-5 rounded-inner border p-4" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }} role="region" aria-label={d.dayTitle(formatDayLong(day.day))}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold first-letter:uppercase">{d.dayTitle(formatDayLong(day.day))}</h4>
              <span className="flex items-center gap-3 text-sm">
                <span className="tabular-nums text-tx2">{d.dayScore(formatScore(day.score))}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedDay(null)}>{d.dayClose}</button>
              </span>
            </div>
            <ul>
              {dayTrades.map((x) => (
                <li key={x.tradeId} className="hairline-row items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm">
                    <b>{symbols.get(x.tradeId) ?? d.tradeLabel(x.tradeId)}</b>
                    <span className="ml-2 text-xs text-tx3">{formatDateTime(x.entryTime)}</span>
                  </span>
                  {x.outcome && <OutcomeBadge outcome={x.outcome} />}
                  {x.netPnl !== null && <b className={`tabular-nums ${toneOfDecimal(x.netPnl)}`}>{formatSignedMoney(x.netPnl, currency)}</b>}
                  <b className="w-16 text-right tabular-nums" title={x.score === null ? d.tradeScoreEmpty : undefined}>{formatScore(x.score)}</b>
                  <Link to={`/trades/${x.tradeId}`} className="btn btn-secondary btn-sm">{d.openTrade}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title={d.quadrants} span="xl:col-span-4">
        <p className="mb-3 text-[13px] leading-relaxed text-tx2">{d.quadrantsIntro}</p>
        <QuadrantsGrid quadrants={report.quadrants} currency={currency} />
      </Card>
    </div>,
  )
}
