import { useT } from '../../i18n'
import { feePeriodLabel, formatFee, formatFeeRounded, toCurve } from '../../lib/analysesView'
import { formatPnl, formatRatioPercent } from '../../lib/format'
import type { FeeGranularity, FeeReport } from '../../types/stats'
import { Segmented } from '../ui'
import { CompareBlock } from '../behavior/parts'
import { Legend, MultiLineChart } from './AnalysisCharts'
import { PnlRounded, Section, Th } from './parts'

/** Frais et commissions dans le temps (3.3.15) : totaux, courbes cumulées, tableau par période. */
export function FeesPanel({
  report,
  currency,
  granularity,
  onGranularity,
}: {
  report: FeeReport
  currency: string
  granularity: FeeGranularity
  onGranularity: (g: FeeGranularity) => void
}) {
  const t = useT().analyses.fees
  const money = (v: number) => formatFee(v.toFixed(2), currency)
  const feeCurve = toCurve(report.curve, (p) => p.cumulativeFees)
  const grossCurve = toCurve(report.curve, (p) => p.cumulativeGrossPnl)
  const netCurve = toCurve(report.curve, (p) => p.cumulativeNetPnl)
  const last = report.curve[report.curve.length - 1]

  if (report.tradesWithFees === 0) {
    return (
      <Section title={t.noneTitle}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{t.noneText}</p>
      </Section>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CompareBlock
          label={t.totalTitle}
          value={formatFeeRounded(report.fees, currency)}
          tone="text-warn"
          lines={[t.totalLines(report.tradesWithFees, report.tradeCount), ...(report.fees.startsWith('-') ? [t.creditNote] : [])]}
        />
        <CompareBlock
          label={t.shareTitle}
          value={formatRatioPercent(report.feesShareOfGross, 1)}
          tone={report.feesShareOfGross === null ? 'text-tx2' : 'text-tx'}
          lines={[report.feesShareOfGross === null ? t.shareUndefined : t.shareLine]}
        />
        <CompareBlock
          label={t.perTradeTitle}
          value={report.feesPerTrade === null ? '—' : formatFeeRounded(report.feesPerTrade, currency)}
          tone="text-tx"
          lines={[t.perTradeLine]}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <Section title={t.cumulativeTitle} subtitle={t.cumulativeSubtitle}>
          <MultiLineChart series={[{ id: 'fees', label: t.cumulativeTitle, color: '#D9A85A', points: feeCurve }]} label={t.cumulativeLabel} format={money} fill />
          <Legend items={[{ id: 'fees', color: '#D9A85A', text: `${t.cumulativeTitle} : ${last ? formatFeeRounded(last.cumulativeFees, currency) : '—'}` }]} />
        </Section>
        <Section title={t.grossNetTitle} subtitle={t.grossNetSubtitle}>
          <MultiLineChart
            series={[
              { id: 'gross', label: t.gross, color: '#4A5FD9', points: grossCurve },
              { id: 'net', label: t.net, color: '#8B7FE8', points: netCurve },
            ]}
            label={t.grossNetLabel}
            format={(v) => formatPnl(v, currency)}
          />
          <Legend
            items={[
              { id: 'gross', color: '#4A5FD9', text: `${t.gross} : ${last ? formatPnl(Number(last.cumulativeGrossPnl), currency) : '—'}` },
              { id: 'net', color: '#8B7FE8', text: `${t.net} : ${last ? formatPnl(Number(last.cumulativeNetPnl), currency) : '—'}` },
            ]}
          />
        </Section>
      </div>

      <Section
        title={t.tableTitle}
        subtitle={t.tableHint}
        aside={
          <div className="w-[260px]">
            <Segmented<FeeGranularity>
              value={granularity}
              label={t.granularityLabel}
              onChange={(v) => v && onGranularity(v)}
              options={[
                { value: 'day', label: t.granularity.day },
                { value: 'week', label: t.granularity.week },
                { value: 'month', label: t.granularity.month },
              ]}
            />
          </div>
        }
      >
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-sm">
            <thead>
              <tr>
                <Th label={t.columns.period} />
                <Th label={t.columns.trades} align="right" />
                <Th label={t.columns.gross} align="right" />
                <Th label={t.columns.fees} align="right" />
                <Th label={t.columns.net} align="right" />
                <Th label={t.columns.share} align="right" />
                <Th label={t.columns.cumulative} align="right" />
              </tr>
            </thead>
            <tbody>
              {report.periods.map((p) => (
                <tr key={p.key} className="h-11 border-t" style={{ borderColor: 'var(--hairline)' }}>
                  <td className="whitespace-nowrap px-3 font-medium">{feePeriodLabel(p.key, granularity, t.weekOf)}</td>
                  <td className="px-3 text-right tabular-nums">{p.tradeCount}</td>
                  <td className="px-3 text-right tabular-nums"><PnlRounded value={p.grossPnl} currency={currency} /></td>
                  <td className="px-3 text-right tabular-nums">{formatFeeRounded(p.fees, currency)}</td>
                  <td className="px-3 text-right tabular-nums"><PnlRounded value={p.netPnl} currency={currency} /></td>
                  <td className="px-3 text-right tabular-nums text-tx2">{formatRatioPercent(p.feesShareOfGross, 1)}</td>
                  <td className="px-3 text-right tabular-nums font-semibold">{formatFeeRounded(p.cumulativeFees, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
