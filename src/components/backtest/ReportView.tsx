import { useT } from '../../i18n'
import { formatNumber, formatR, formatRatioPercent } from '../../lib/format'
import { MIN_SAMPLE, type BacktestReport, type PerfSummary, type RealComparison } from '../../types/backtest'
import { EmptyState } from '../EmptyState'
import { MultiLineChart, SERIES_COLORS } from '../analyses/AnalysisCharts'
import { Th } from '../analyses/parts'

/** Facteur de profit en R : « ∞ » quand il y a des gains et aucune perte, « — » quand il n'y a rien à mesurer. */
function profitFactor(s: PerfSummary, infinity: string): string {
  if (s.profitFactor !== null) return formatNumber(s.profitFactor, 2)
  return s.winCount > 0 && s.lossCount === 0 ? infinity : '—'
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card flex flex-col gap-1 px-5 py-4" title={hint}>
      <span className="caption">{label}</span>
      <strong className="text-[22px] font-semibold tabular-nums">{value}</strong>
      {hint && <span className="text-xs text-tx3">{hint}</span>}
    </div>
  )
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="glass-card px-6 py-5" aria-label={title}>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {intro && <p className="mt-1 max-w-[80ch] text-[13px] text-tx2">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Breakdown({ report }: { report: BacktestReport }) {
  const r = useT().backtest.report
  const rows: [string, PerfSummary][] = [
    [r.groups.past, report.past],
    [r.groups.live, report.live],
    [r.groups.long, report.long],
    [r.groups.short, report.short],
  ]
  return (
    <Section title={r.sections.breakdown} intro={r.sections.breakdownIntro}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <Th label={r.groupColumns.group} />
              <Th label={r.groupColumns.cases} align="right" />
              <Th label={r.groupColumns.winRate} align="right" />
              <Th label={r.groupColumns.expectancy} align="right" />
              <Th label={r.groupColumns.total} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s]) => (
              <tr key={label} className="h-[44px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                <td className="px-3 font-semibold">
                  {label}
                  {s.tradeCount > 0 && s.lowSample && <span className="badge badge-warn ml-2">{r.lowSample}</span>}
                </td>
                <td className="px-3 text-right tabular-nums">{s.tradeCount}</td>
                <td className="px-3 text-right tabular-nums">{formatRatioPercent(s.winRate, 0)}</td>
                <td className="px-3 text-right tabular-nums">{formatR(s.expectancyR, 2)}</td>
                <td className="px-3 text-right font-semibold tabular-nums">{s.tradeCount === 0 ? '—' : formatR(s.totalR, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function Real({ real, overall }: { real: RealComparison; overall: PerfSummary }) {
  const r = useT().backtest.report.real
  return (
    <Section title={r.title} intro={r.intro}>
      <table className="w-full max-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <Th label="" />
            <Th label={r.columns.cases} align="right" />
            <Th label={r.columns.winRate} align="right" />
            <Th label={r.columns.expectancy} align="right" />
          </tr>
        </thead>
        <tbody>
          <tr className="h-[44px] border-t" style={{ borderColor: 'var(--hairline)' }}>
            <td className="px-3 font-semibold">{r.backtest}</td>
            <td className="px-3 text-right tabular-nums">{overall.tradeCount}</td>
            <td className="px-3 text-right tabular-nums">{formatRatioPercent(overall.winRate, 0)}</td>
            <td className="px-3 text-right tabular-nums">{formatR(overall.expectancyR, 2)}</td>
          </tr>
          <tr className="h-[44px] border-t" style={{ borderColor: 'var(--hairline)' }}>
            <td className="px-3 font-semibold">{r.real}</td>
            <td className="px-3 text-right tabular-nums">{r.realCount(real.tradeCount, real.rTradeCount)}</td>
            <td className="px-3 text-right tabular-nums">{formatRatioPercent(real.winRate, 0)}</td>
            <td className="px-3 text-right tabular-nums">{formatR(real.expectancyR, 2)}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  )
}

function Scenarios({ report }: { report: BacktestReport }) {
  const t = useT().backtest
  const s = t.scenarios
  const sc = report.scenarios
  const widest = Math.max(1, ...sc.levels.map((l) => Math.abs(l.totalR)))
  return (
    <Section title={s.title} intro={s.intro}>
      {sc.sampleCount === 0 ? (
        <p className="text-sm text-tx2">{s.none}</p>
      ) : (
        <>
          <p className="text-sm text-tx2">{s.actualLine(formatR(sc.actualTotalR, 1), formatR(sc.actualExpectancyR, 2))}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th label={s.columns.tp} />
                  <Th label={s.columns.reached} align="right" />
                  <Th label={s.columns.winRate} align="right" />
                  <Th label={s.columns.expectancy} align="right" />
                  <Th label={s.columns.total} align="right" />
                  <Th label={s.columns.diff} align="right" />
                </tr>
              </thead>
              <tbody>
                {sc.levels.map((l) => {
                  const best = sc.bestTpR === l.tpR
                  return (
                    <tr key={l.tpR} className="h-[46px] border-t" style={{ borderColor: 'var(--hairline)', background: best ? 'rgba(139,127,232,.10)' : undefined }}>
                      <td className="px-3 font-semibold">
                        {s.tpLabel(formatNumber(l.tpR, 1).replace(/,0$/, '') + ' R')}
                        {best && <span className="badge badge-neutral ml-2">{s.bestBadge}</span>}
                      </td>
                      <td className="px-3 text-right tabular-nums text-tx2">{s.reached(l.reachedCount, sc.sampleCount)}</td>
                      <td className="px-3 text-right tabular-nums">{formatRatioPercent(l.winRate, 0)}</td>
                      <td className="px-3 text-right tabular-nums">{formatR(l.expectancyR, 2)}</td>
                      <td className="px-3 text-right">
                        <span className="inline-flex items-center justify-end gap-2.5">
                          <span aria-hidden="true" className="inline-block h-1.5 rounded-full" style={{ width: `${Math.round((Math.abs(l.totalR) / widest) * 80)}px`, background: l.totalR >= 0 ? '#5FCB9E' : '#F0776B' }} />
                          <strong className="tabular-nums">{formatR(l.totalR, 1)}</strong>
                        </span>
                      </td>
                      <td className="px-3 text-right tabular-nums text-tx2">{formatR(l.differenceR, 1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col gap-1 text-[13px] text-tx2">
            <p>{s.sample(sc.sampleCount)}</p>
            {sc.missingMaxRCount > 0 && <p>{s.missing(sc.missingMaxRCount)}</p>}
            <p>{sc.bestTpR !== null ? s.best(`${formatNumber(sc.bestTpR, 1)} R`, formatR(sc.levels.find((l) => l.tpR === sc.bestTpR)?.totalR ?? 0, 1)) : s.noBest(sc.sampleCount, MIN_SAMPLE)}</p>
            <p className="text-tx3">{s.warning}</p>
          </div>
        </>
      )}
    </Section>
  )
}

/** Résultats d'un backtest : tout vient de pulse-core (`get_backtest_report`), ici on formate et on dessine. */
export function ReportView({ report, includeDoubtful, onIncludeDoubtful }: { report: BacktestReport; includeDoubtful: boolean; onIncludeDoubtful: (v: boolean) => void }) {
  const t = useT().backtest
  const r = t.report
  const o = report.overall
  const points = report.curve.map((p) => ({ time: p.occurredAt, value: p.cumulativeR }))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{r.title}</h2>
        <label className="flex items-center gap-2 text-[13px] text-tx2">
          <input type="checkbox" checked={includeDoubtful} onChange={(e) => onIncludeDoubtful(e.target.checked)} />
          {r.includeDoubtful}
        </label>
      </div>
      <p className="text-xs text-tx3">{r.countedNote}</p>
      {o.tradeCount === 0 ? (
        <section className="glass-card"><EmptyState title={r.title}>{r.noData}</EmptyState></section>
      ) : (
        <>
          {o.lowSample && <div className="nt nt-warn" role="status">{r.lowSampleHint(o.tradeCount, MIN_SAMPLE)}</div>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label={r.kpi.cases} value={String(o.tradeCount)} />
            <Kpi label={r.kpi.winRate} value={formatRatioPercent(o.winRate, 0)} />
            <Kpi label={r.kpi.expectancy} value={formatR(o.expectancyR, 2)} hint={r.kpi.expectancyHint} />
            <Kpi label={r.kpi.total} value={formatR(o.totalR, 1)} />
            <Kpi label={r.kpi.profitFactor} value={profitFactor(o, r.infinity)} />
            <Kpi label={r.kpi.avgRr} value={o.avgPlannedRr === null ? '—' : `${formatNumber(o.avgPlannedRr, 1)} R`} />
            <Kpi label={r.kpi.avgMax} value={o.avgMaxR === null ? '—' : `${formatNumber(o.avgMaxR, 1)} R`} />
            <Kpi label={r.kpi.drawdown} value={`${formatNumber(o.maxDrawdownR, 1)} R`} />
          </div>
          <Section title={r.curveTitle}>
            <MultiLineChart
              label={r.curveLabel}
              format={(v) => formatR(v, 1)}
              series={[{ id: 'backtest', label: r.curveTitle, color: SERIES_COLORS[0], points }]}
              fill
            />
            <p className="mt-2 text-[13px] text-tx2 tabular-nums">{r.curveEnd(formatR(o.totalR, 1))}</p>
          </Section>
        </>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={r.kpi.validity} value={formatRatioPercent(report.validity.rate, 0)} hint={r.kpi.validityHint(report.validity.yes, report.validity.no)} />
        <Kpi label={r.kpi.noEntry} value={String(report.noEntryCount)} />
      </div>
      {o.tradeCount > 0 && <Breakdown report={report} />}
      {o.tradeCount > 0 && <Scenarios report={report} />}
      {report.real && <Real real={report.real} overall={o} />}
    </div>
  )
}
