import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarGrid } from '../components/CalendarGrid'
import { EquityChart, Sparkline } from '../components/charts'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatMonthName } from '../lib/calendarFormat'
import { signOf } from '../lib/decimal'
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPoints,
  formatR,
  formatRatioPercent,
  formatSignedMoney,
  formatSignedMoneyRounded,
  formatSignedNumber,
  formatSignedRatioPercent,
} from '../lib/format'
import { ENGINE_PERIOD, localTzOffsetMin, usePeriod } from '../lib/period'
import type { Calendar, Dashboard, Summary } from '../types/stats'

type Tone = 'gain' | 'loss' | 'accent'

export function DashboardPage() {
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const t = useT()
  const [data, setData] = useState<Dashboard | null>(null)
  const [month, setMonth] = useState<Calendar | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixedCurrencies

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const now = new Date()
    const tzOffsetMin = localTzOffsetMin()
    Promise.all([
      api.getDashboard({ accountIds, period: ENGINE_PERIOD[period], nowMs: now.getTime(), tzOffsetMin }),
      api.getCalendar({ accountIds, year: now.getFullYear(), month: now.getMonth() + 1, tzOffsetMin }),
    ])
      .then(([d, c]) => {
        if (cancelled) return
        setData(d)
        setMonth(c)
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, accountIds, period])

  const header = <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />

  if (loading) return <div className="flex flex-col gap-5">{header}</div>
  if (chosen.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState
            title={t.dashboard.welcomeTitle}
            action={<Link to="/settings" className="btn btn-primary">{t.dashboard.createFirstAccount}</Link>}
          >
            {t.dashboard.welcomeText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (mixedCurrencies) {
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
        <div className="nt nt-bad" role="alert">{t.dashboard.loadError(error)}</div>
      </div>
    )
  }
  if (!data) return <div className="flex flex-col gap-5">{header}</div>

  const { report } = data
  const s = report.summary
  const currency = report.currency ?? 'USD'
  if (period === 'ALL' && s.tradeCount === 0 && report.openTradeCount === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState
            title={t.dashboard.noTradesTitle}
            action={<Link to="/trades/new" className="btn btn-primary">{t.dashboard.addFirstTrade}</Link>}
          >
            {t.dashboard.noTradesText}
          </EmptyState>
        </section>
      </div>
    )
  }

  const netSign = signOf(s.netPnl)
  const cmp = data.comparison
  const vs = t.dashboard.vsPrevious[period]
  const points = report.equityCurve.map((p) => ({ time: p.time, value: Number(p.cumulativeNetPnl) }))
  const last = report.equityCurve[report.equityCurve.length - 1]
  const sp = data.sparklines

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="grid grid-cols-12 gap-6">
        <section className="glass-card col-span-12 p-6 xl:col-span-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="caption">{t.dashboard.netPnl}</div>
              <div
                className="mt-1 text-[46px] font-semibold leading-[1.1] tracking-[-0.02em]"
                style={{ background: 'linear-gradient(90deg,#fff,#C9D2FF)', WebkitBackgroundClip: 'text', color: 'transparent' }}
              >
                {formatSignedMoney(s.netPnl, currency)}
              </div>
              {cmp && (
                <div className="mt-1 text-sm font-semibold">
                  <Delta value={cmp.netPnl} better={signOf(cmp.netPnl)} text={`${formatSignedMoney(cmp.netPnl, currency)}${cmp.netPnlPct !== null ? ` (${formatSignedRatioPercent(cmp.netPnlPct)})` : ''}`} />{' '}
                  <span className="font-normal text-tx3">{vs}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <span className={`badge ${netSign > 0 ? 'badge-gain' : netSign < 0 ? 'badge-loss' : 'badge-neutral'}`}>
                {netSign > 0 ? t.dashboard.badgeGain : netSign < 0 ? t.dashboard.badgeLoss : t.dashboard.badgeFlat}
              </span>
              <span className="badge badge-neutral">{t.dashboard.trades(s.tradeCount)}</span>
              {report.openTradeCount > 0 && <span className="badge badge-warn">{t.dashboard.openTrades(report.openTradeCount)}</span>}
            </div>
          </div>
          <div className="mt-3">
            {s.tradeCount === 0 ? (
              <EmptyState title={t.dashboard.noneOnPeriodTitle}>{t.dashboard.noneOnPeriodText}</EmptyState>
            ) : (
              <>
                <EquityChart
                  points={points}
                  label={t.dashboard.equityLabel(s.tradeCount, formatDate(report.equityCurve[0].time), formatDate(last.time))}
                />
                <p className="mt-2 text-xs text-tx3">{t.dashboard.equityNote}</p>
              </>
            )}
          </div>
        </section>

        <section className="glass-card col-span-12 flex flex-col gap-1 p-6 xl:col-span-4">
          <h3 className="mb-2 text-base font-semibold">{t.dashboard.capital.title}</h3>
          <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.current}</span><b className="text-lg">{formatMoney(report.currentCapital, currency)}</b></div>
          <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.initial}</span><span>{formatMoney(report.initialCapital, currency)}</span></div>
          <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.deposits}</span><span>{formatMoney(report.totalDeposits, currency)}</span></div>
          <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.withdrawals}</span><span>{formatMoney(report.totalWithdrawals, currency)}</span></div>
          <p className="mt-3 text-xs leading-relaxed text-tx3">{t.dashboard.capital.note}</p>
          <Link to="/settings" className="btn-link mt-2 self-start">{t.dashboard.capital.manage}</Link>
        </section>

        <div className="col-span-12 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            id="win"
            label={t.dashboard.kpi.winRate}
            info={t.dashboard.kpi.info.winRate}
            value={formatRatioPercent(s.winRate)}
            delta={cmp?.winRate ?? null}
            deltaText={cmp?.winRate != null ? formatPoints(cmp.winRate) : ''}
            spark={sp.winRate}
            vs={t.dashboard.vsPreviousShort}
          />
          <Kpi
            id="pf"
            label={t.dashboard.kpi.profitFactor}
            info={t.dashboard.kpi.info.profitFactor}
            value={profitFactorText(s, t.dashboard.kpi.infinite)}
            delta={cmp?.profitFactor ?? null}
            deltaText={cmp?.profitFactor != null ? formatSignedNumber(cmp.profitFactor) : ''}
            spark={sp.profitFactor}
            vs={t.dashboard.vsPreviousShort}
          />
          <Kpi
            id="exp"
            label={t.dashboard.kpi.expectancy}
            info={t.dashboard.kpi.info.expectancy}
            value={formatR(s.expectancyR, 2)}
            sub={s.avgNetPnl !== null ? `${formatSignedMoneyRounded(s.avgNetPnl, currency)} ${t.dashboard.kpi.perTrade}` : undefined}
            delta={cmp?.expectancyR ?? null}
            deltaText={cmp?.expectancyR != null ? `${formatSignedNumber(cmp.expectancyR)} R` : ''}
            spark={sp.expectancyR}
            vs={t.dashboard.vsPreviousShort}
          />
          <Kpi
            id="rr"
            label={t.dashboard.kpi.riskReward}
            info={t.dashboard.kpi.info.riskReward}
            value={formatNumber(s.avgWinLossRatio, 2)}
            delta={cmp?.avgWinLossRatio ?? null}
            deltaText={cmp?.avgWinLossRatio != null ? formatSignedNumber(cmp.avgWinLossRatio) : ''}
            spark={sp.avgWinLossRatio}
            vs={t.dashboard.vsPreviousShort}
          />
          <Kpi
            id="dd"
            label={t.dashboard.kpi.maxDrawdown}
            info={t.dashboard.kpi.info.maxDrawdown}
            value={signOf(s.maxDrawdown) > 0 ? formatSignedMoney(`-${s.maxDrawdown}`, currency) : formatMoney(s.maxDrawdown, currency)}
            sub={s.maxDrawdownPct !== null ? `−${formatRatioPercent(s.maxDrawdownPct)}` : undefined}
            // Un drawdown qui grandit est une mauvaise nouvelle : l'écart est inversé pour le ton.
            lowerIsBetter
            delta={cmp ? Number(cmp.maxDrawdown) : null}
            deltaText={cmp ? formatSignedMoney(cmp.maxDrawdown, currency) : ''}
            spark={sp.maxDrawdown}
            vs={t.dashboard.vsPreviousShort}
          />
        </div>

        <section className="glass-card col-span-12 p-6 xl:col-span-7">
          <h3 className="mb-4 text-base font-semibold">{t.dashboard.daily.title}</h3>
          <DailyBars data={data} currency={currency} />
        </section>
        <section className="glass-card col-span-12 p-6 xl:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">{month ? t.dashboard.activity(formatMonthName(month.year, month.month)) : ''}</h3>
            <Link to="/calendar" className="btn-link">{t.dashboard.viewCalendar}</Link>
          </div>
          {month && <CalendarGrid calendar={month} compact />}
        </section>
      </div>
    </div>
  )
}

/** Profit factor : « ∞ » quand il y a des gains et aucune perte (pulse-core renvoie alors « indéfini »). */
function profitFactorText(s: Summary, infinity: string): string {
  if (s.profitFactor === null && signOf(s.totalGains) > 0 && signOf(s.totalLosses) === 0) return infinity
  return formatNumber(s.profitFactor, 2)
}

/** Écart avec flèche et signe : la couleur renforce le sens, elle ne le porte jamais seule. */
function Delta({ value, better, text }: { value: number | string; better: number; text: string }) {
  const sign = typeof value === 'string' ? signOf(value) : Math.sign(value)
  if (sign === 0) return <span className="text-neutral">{text}</span>
  return (
    <span className={better > 0 ? 'text-gain' : better < 0 ? 'text-loss' : 'text-neutral'}>
      {sign > 0 ? '▲' : '▼'} {text}
    </span>
  )
}

function Kpi({
  id,
  label,
  info,
  value,
  sub,
  delta,
  deltaText,
  lowerIsBetter = false,
  spark,
  vs,
}: {
  id: string
  label: string
  info: string
  value: string
  sub?: string
  delta: number | null
  deltaText: string
  lowerIsBetter?: boolean
  spark: (number | null)[]
  vs: string
}) {
  const sign = delta === null ? 0 : Math.sign(delta)
  const better = lowerIsBetter ? -sign : sign
  const tone: Tone = delta === null || sign === 0 ? 'accent' : better > 0 ? 'gain' : 'loss'
  return (
    <div className="glass-card relative overflow-hidden pt-[18px]">
      <div className="px-[22px]">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-tx2">
          {label}
          <span
            className="grid h-[15px] w-[15px] cursor-help place-items-center rounded-full border border-tx3 text-[9px] leading-none text-tx3"
            title={info}
            aria-label={info}
            role="img"
          >
            i
          </span>
        </div>
        <div className="mt-1.5 text-[28px] font-semibold tracking-[-0.01em]">{value}</div>
        <div className="min-h-[18px] text-xs text-tx2">{sub}</div>
        <div className="min-h-[18px] text-xs font-semibold">
          {delta !== null && (
            <>
              <Delta value={delta} better={better} text={deltaText} /> <span className="font-normal text-tx3">{vs}</span>
            </>
          )}
        </div>
      </div>
      <div className="mt-1">
        <Sparkline values={spark} tone={tone} id={id} />
      </div>
    </div>
  )
}

/** Barres du résultat de chaque jour (les 30 derniers jours de la période) : gain vers le haut, perte vers le bas. */
function DailyBars({ data, currency }: { data: Dashboard; currency: string }) {
  const t = useT()
  const days = data.report.daily.slice(-30)
  if (days.length === 0) return <p className="py-10 text-center text-sm text-tx2">{t.dashboard.daily.empty}</p>
  const magnitudes = days.map((d) => Math.abs(Number(d.netPnl)))
  const max = Math.max(...magnitudes) || 1
  return (
    <div>
      <div className="flex h-[200px] items-stretch gap-1.5">
        {days.map((d, i) => {
          const sign = signOf(d.netPnl)
          const h = `${Math.max((magnitudes[i] / max) * 100, sign === 0 ? 0 : 3)}%`
          return (
            <div
              key={d.day}
              className="flex flex-1 flex-col"
              title={t.dashboard.daily.bar(d.day, formatSignedMoney(d.netPnl, currency), d.tradeCount)}
            >
              <div className="flex flex-1 items-end">
                {sign > 0 && <div className="mx-auto w-full max-w-[40px] rounded-[5px] bg-gain" style={{ height: h }} />}
              </div>
              <div className="h-px bg-white/10" />
              <div className="flex flex-1 items-start">
                {sign < 0 && <div className="mx-auto w-full max-w-[40px] rounded-[5px] bg-loss" style={{ height: h }} />}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-tx3">
        <span>{formatDate(Date.parse(`${days[0].day}T12:00:00Z`))}</span>
        <span>{formatDate(Date.parse(`${days[days.length - 1].day}T12:00:00Z`))}</span>
      </div>
    </div>
  )
}
