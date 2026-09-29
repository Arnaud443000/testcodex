import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatFactor, limitFraction, riskChartPoints } from '../../lib/comparisonsView'
import { formatDate, formatMoney, formatPoints, formatRatioPercent } from '../../lib/format'
import { roundDecimal } from '../../lib/decimal'
import type { RiskBenchmark } from '../../types/stats'
import { EmptyState } from '../EmptyState'
import { Section, Th } from '../analyses/parts'
import { RiskChart } from './RiskChart'

function Kpi({ label, value, hint, alert = false }: { label: string; value: React.ReactNode; hint?: string; alert?: boolean }) {
  return (
    <div className="glass-card flex flex-col gap-1 p-5">
      <span className="caption uppercase tracking-[0.06em] text-tx3">{label}</span>
      <span className={`text-[26px] font-semibold tabular-nums ${alert ? 'text-loss' : ''}`}>{value}</span>
      {hint && <span className="text-xs leading-relaxed text-tx3">{hint}</span>}
    </div>
  )
}

/** Benchmark du risque max par trade (3.4.11). */
export function RiskPanel({ report, currency }: { report: RiskBenchmark; currency: string }) {
  const t = useT()
  const s = t.comparisons.risk

  if (report.limitPercent === null) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
        <section className="glass-card">
          <EmptyState title={s.noLimitTitle} action={<Link to="/settings#behavior-settings-title" className="btn btn-primary">{s.goSettings}</Link>}>
            {s.noLimitText}
          </EmptyState>
        </section>
      </div>
    )
  }
  const limitPct = formatRatioPercent(limitFraction(report), 2)
  const percentText = report.limitPercent.replace('.', ',')
  if (report.evaluatedCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
        <section className="glass-card">
          <EmptyState title={s.noEvalTitle}>{s.noEvalText}</EmptyState>
        </section>
      </div>
    )
  }
  const chart = riskChartPoints(report.points, limitFraction(report))
  const trendText =
    report.trend === 'notEnoughData' ? s.trend.notEnoughData(report.minTrendTrades) : s.trend[report.trend]
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label={s.limit} value={s.limitValue(percentText)} hint={s.evaluatedHint(report.evaluatedCount, report.tradeCount, report.withoutStopCount)} />
        <Kpi label={s.compliance} value={formatRatioPercent(report.complianceRate, 0)} hint={s.complianceHint(report.respectedCount, report.evaluatedCount)} />
        <Kpi label={s.overCount} value={report.overCount} alert={report.overCount > 0} hint={report.overCount > 0 ? s.over : s.within} />
        <Kpi label={s.avgRisk} value={formatRatioPercent(report.avgRiskPct, 2)} hint={`${s.maxRisk} : ${formatRatioPercent(report.maxRiskPct, 2)}`} />
      </div>

      <Section title={s.chartTitle} subtitle={s.chartSubtitle}>
        <RiskChart points={chart.points} top={chart.top} limitY={chart.limitY} limitLabel={s.limitLine(limitPct)} label={s.chartLabel(report.evaluatedCount, report.overCount)} />
      </Section>

      <Section title={s.trendTitle}>
        <p className="max-w-[80ch] text-sm leading-relaxed text-tx2">{trendText}</p>
        {report.olderRate !== null && report.recentRate !== null && (
          <p className="mt-2 max-w-[80ch] text-xs leading-relaxed text-tx3">{s.trendDetail(formatRatioPercent(report.olderRate, 0), formatRatioPercent(report.recentRate, 0))}</p>
        )}
        {report.months.length > 0 && (
          <div className="-mx-3 mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <caption className="sr-only">{s.monthsTitle}</caption>
              <thead>
                <tr>
                  <Th label={s.monthsColumns.month} />
                  <Th label={s.monthsColumns.evaluated} align="right" />
                  <Th label={s.monthsColumns.over} align="right" />
                  <Th label={s.monthsColumns.rate} align="right" />
                </tr>
              </thead>
              <tbody>
                {report.months.map((m) => (
                  <tr key={m.key} className="h-[44px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="px-3 tabular-nums">{m.key}</td>
                    <td className="px-3 text-right tabular-nums">{m.evaluatedCount}</td>
                    <td className="px-3 text-right tabular-nums">{m.overCount}</td>
                    <td className="px-3 text-right tabular-nums">{formatRatioPercent(m.complianceRate, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={s.violationsTitle} subtitle={report.violations.length > 0 ? s.violationsHint : undefined}>
        {report.violations.length === 0 ? (
          <div>
            <h4 className="text-sm font-semibold">{s.noViolationsTitle}</h4>
            <p className="mt-1 text-sm text-tx2">{s.noViolationsText}</p>
          </div>
        ) : (
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th label={s.columns.date} />
                  <Th label={s.columns.asset} />
                  <Th label={s.columns.risk} align="right" />
                  <Th label={s.columns.pct} align="right" />
                  <Th label={s.columns.limit} align="right" />
                  <Th label={s.columns.excess} align="right" />
                  <Th label={s.columns.open} align="right" />
                </tr>
              </thead>
              <tbody>
                {report.violations.map((v) => (
                  <tr key={v.tradeId} className="h-[52px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="px-3 text-tx2">{formatDate(v.exitTime)}</td>
                    <td className="px-3 font-semibold">
                      {v.symbol} <span className="text-xs font-normal text-tx3">{t.common.directions[v.direction]}</span>
                    </td>
                    <td className="px-3 text-right tabular-nums">{formatMoney(roundDecimal(v.initialRisk, 2), currency)}</td>
                    <td className="px-3 text-right font-semibold tabular-nums text-loss">{formatRatioPercent(v.riskPct, 2)}</td>
                    <td className="px-3 text-right tabular-nums text-tx2">{formatMoney(roundDecimal(v.limitAmount, 2), currency)}</td>
                    <td className="px-3 text-right tabular-nums">
                      <span className="badge badge-loss">{s.factor(formatFactor(v.overFactor))}</span>
                      <span className="ml-2 text-tx3">{formatPoints(v.excessPct, 2)}</span>
                    </td>
                    <td className="px-3 text-right">
                      <Link to={`/trades/${v.tradeId}`} aria-label={s.openTrade(v.symbol)} className="font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                        #{v.tradeId}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
