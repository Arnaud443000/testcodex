import { Link } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { FitCard } from '../ui/fit'
import { CalendarGrid } from '../CalendarGrid'
import { EquityChart, Sparkline } from '../charts'
import { EmptyState } from '../EmptyState'
import { useT } from '../../i18n'
import { formatMonthName } from '../../lib/calendarFormat'
import { signOf } from '../../lib/decimal'
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
} from '../../lib/format'
import type { Calendar, Dashboard, PeriodKey, Summary } from '../../types/stats'

/** Les cartes historiques du tableau de bord (résultat net, capital, indicateurs, barres par jour, calendrier). */

type Tone = 'gain' | 'loss' | 'accent'

/** Profit factor : « ∞ » quand il y a des gains et aucune perte (pulse-core renvoie alors « indéfini »). */
function profitFactorText(s: Summary, infinity: string): string {
  if (s.profitFactor === null && signOf(s.totalGains) > 0 && signOf(s.totalLosses) === 0) return infinity
  return formatNumber(s.profitFactor, 2)
}

/** Écart avec flèche et signe : la couleur renforce le sens, elle ne le porte jamais seule. */
export function Delta({ value, better, text }: { value: number | string; better: number; text: string }) {
  const sign = typeof value === 'string' ? signOf(value) : Math.sign(value)
  if (sign === 0) return <span className="text-neutral">{text}</span>
  return (
    <span className={better > 0 ? 'text-gain' : better < 0 ? 'text-loss' : 'text-neutral'}>
      {sign > 0 ? '▲' : '▼'} {text}
    </span>
  )
}

export function HeroCard({ data, period }: { data: Dashboard; period: PeriodKey }) {
  const t = useT()
  const { report } = data
  const s = report.summary
  const currency = report.currency ?? 'USD'
  const netSign = signOf(s.netPnl)
  const cmp = data.comparison
  const vs = t.dashboard.vsPrevious[period]
  const points = report.equityCurve.map((p) => ({ time: p.time, value: Number(p.cumulativeNetPnl) }))
  const last = report.equityCurve[report.equityCurve.length - 1]
  return (
    <FitCard>
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
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        {s.tradeCount === 0 ? (
          <EmptyState title={t.dashboard.noneOnPeriodTitle}>{t.dashboard.noneOnPeriodText}</EmptyState>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              <EquityChart
                fill
                points={points}
                label={t.dashboard.equityLabel(s.tradeCount, formatDate(report.equityCurve[0].time), formatDate(last.time))}
              />
            </div>
            <p className="mt-2 shrink-0 text-xs text-tx3">{t.dashboard.equityNote}</p>
          </>
        )}
      </div>
    </FitCard>
  )
}

export function CapitalCard({ data }: { data: Dashboard }) {
  const t = useT()
  const { report } = data
  const currency = report.currency ?? 'USD'
  return (
    <FitCard className="gap-1">
      <h3 className="mb-2 text-base font-semibold">{t.dashboard.capital.title}</h3>
      <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.current}</span><b className="text-lg">{formatMoney(report.currentCapital, currency)}</b></div>
      <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.initial}</span><span>{formatMoney(report.initialCapital, currency)}</span></div>
      <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.deposits}</span><span>{formatMoney(report.totalDeposits, currency)}</span></div>
      <div className="hairline-row"><span className="text-tx2">{t.dashboard.capital.withdrawals}</span><span>{formatMoney(report.totalWithdrawals, currency)}</span></div>
      <p className="mt-3 text-xs leading-relaxed text-tx3">{t.dashboard.capital.note}</p>
      <Link to="/settings" className="btn-link mt-2 self-start">{t.dashboard.capital.manage}</Link>
    </FitCard>
  )
}

/** Les cinq indicateurs clés du tableau de bord ; le mode d'un widget `kpi` en choisit un. */
export type KpiMode = 'win_rate' | 'profit_factor' | 'expectancy' | 'risk_reward' | 'max_drawdown'
export const KPI_MODES: KpiMode[] = ['win_rate', 'profit_factor', 'expectancy', 'risk_reward', 'max_drawdown']

export function KpiCard({ mode, data }: { mode: KpiMode; data: Dashboard }) {
  const t = useT()
  const s = data.report.summary
  const currency = data.report.currency ?? 'USD'
  const cmp = data.comparison
  const sp = data.sparklines
  const vs = t.dashboard.vsPreviousShort
  const k = t.dashboard.kpi
  switch (mode) {
    case 'win_rate':
      return (
        <Kpi id="win" label={k.winRate} info={k.info.winRate} value={formatRatioPercent(s.winRate)} delta={cmp?.winRate ?? null} deltaText={cmp?.winRate != null ? formatPoints(cmp.winRate) : ''} spark={sp.winRate} vs={vs} />
      )
    case 'profit_factor':
      return (
        <Kpi id="pf" label={k.profitFactor} info={k.info.profitFactor} value={profitFactorText(s, k.infinite)} delta={cmp?.profitFactor ?? null} deltaText={cmp?.profitFactor != null ? formatSignedNumber(cmp.profitFactor) : ''} spark={sp.profitFactor} vs={vs} />
      )
    case 'expectancy':
      return (
        <Kpi
          id="exp"
          label={k.expectancy}
          info={k.info.expectancy}
          value={formatR(s.expectancyR, 2)}
          sub={s.avgNetPnl !== null ? `${formatSignedMoneyRounded(s.avgNetPnl, currency)} ${k.perTrade}` : undefined}
          delta={cmp?.expectancyR ?? null}
          deltaText={cmp?.expectancyR != null ? `${formatSignedNumber(cmp.expectancyR)} R` : ''}
          spark={sp.expectancyR}
          vs={vs}
        />
      )
    case 'risk_reward':
      return (
        <Kpi id="rr" label={k.riskReward} info={k.info.riskReward} value={formatNumber(s.avgWinLossRatio, 2)} delta={cmp?.avgWinLossRatio ?? null} deltaText={cmp?.avgWinLossRatio != null ? formatSignedNumber(cmp.avgWinLossRatio) : ''} spark={sp.avgWinLossRatio} vs={vs} />
      )
    case 'max_drawdown':
      return (
        <Kpi
          id="dd"
          label={k.maxDrawdown}
          info={k.info.maxDrawdown}
          value={signOf(s.maxDrawdown) > 0 ? formatSignedMoney(`-${s.maxDrawdown}`, currency) : formatMoney(s.maxDrawdown, currency)}
          sub={s.maxDrawdownPct !== null ? `−${formatRatioPercent(s.maxDrawdownPct)}` : undefined}
          // Un drawdown qui grandit est une mauvaise nouvelle : l'écart est inversé pour le ton.
          lowerIsBetter
          delta={cmp ? Number(cmp.maxDrawdown) : null}
          deltaText={cmp ? formatSignedMoney(cmp.maxDrawdown, currency) : ''}
          spark={sp.maxDrawdown}
          vs={vs}
        />
      )
  }
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
    <div className="glass-card relative flex h-full flex-col overflow-hidden pt-4">
      <div className="px-[22px]">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-tx2">
          {label}
          <Tooltip content={info} focusable>
            <span
              className="grid h-[15px] w-[15px] cursor-help place-items-center rounded-full border border-tx3 text-[9px] leading-none text-tx3"
              aria-label={info}
              role="img"
            >
              i
            </span>
          </Tooltip>
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
      <div className="mt-auto min-h-[12px] max-h-[38px] flex-1 pt-1">
        <Sparkline values={spark} tone={tone} id={id} />
      </div>
    </div>
  )
}

/** Barres du résultat de chaque jour (les 30 derniers jours de la période) : gain vers le haut, perte vers le bas. */
export function DailyCard({ data }: { data: Dashboard }) {
  const t = useT()
  const currency = data.report.currency ?? 'USD'
  const days = data.report.daily.slice(-30)
  const magnitudes = days.map((d) => Math.abs(Number(d.netPnl)))
  const max = Math.max(...magnitudes, 0) || 1
  return (
    <FitCard>
      <h3 className="mb-4 text-base font-semibold">{t.dashboard.daily.title}</h3>
      {days.length === 0 ? (
        <p className="py-10 text-center text-sm text-tx2">{t.dashboard.daily.empty}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-[120px] flex-1 items-stretch gap-1.5">
            {days.map((d, i) => {
              const sign = signOf(d.netPnl)
              const h = `${Math.max((magnitudes[i] / max) * 100, sign === 0 ? 0 : 3)}%`
              return (
                <Tooltip key={d.day} content={t.dashboard.daily.bar(d.day, formatSignedMoney(d.netPnl, currency), d.tradeCount)}>
                  <div className="flex flex-1 flex-col">
                    <div className="flex flex-1 items-end">
                      {sign > 0 && <div className="mx-auto w-full max-w-[40px] rounded-[5px] bg-gain" style={{ height: h }} />}
                    </div>
                    <div className="h-px bg-white/10" />
                    <div className="flex flex-1 items-start">
                      {sign < 0 && <div className="mx-auto w-full max-w-[40px] rounded-[5px] bg-loss" style={{ height: h }} />}
                    </div>
                  </div>
                </Tooltip>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between text-xs text-tx3">
            <span>{formatDate(Date.parse(`${days[0].day}T12:00:00Z`))}</span>
            <span>{formatDate(Date.parse(`${days[days.length - 1].day}T12:00:00Z`))}</span>
          </div>
        </div>
      )}
    </FitCard>
  )
}

export function CalendarCard({ month }: { month: Calendar }) {
  const t = useT()
  return (
    <FitCard>
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h3 className="text-base font-semibold">{t.dashboard.activity(formatMonthName(month.year, month.month))}</h3>
        <Link to="/calendar" className="btn-link">{t.dashboard.viewCalendar}</Link>
      </div>
      <div className="min-h-0 flex-1">
        <CalendarGrid calendar={month} compact fill />
      </div>
    </FitCard>
  )
}
