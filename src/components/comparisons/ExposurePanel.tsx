import { Link } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { formatFeeRounded } from '../../lib/analysesView'
import { formatRatioPercent } from '../../lib/format'
import type { ExposureReport } from '../../types/stats'
import { EmptyState } from '../EmptyState'
import { Section, Th } from '../analyses/parts'

/** Exposition au risque par catégorie d'actif (3.7.9). Tracé et libellés seulement : les parts viennent de pulse-core. */
export function ExposurePanel({ report, currency }: { report: ExposureReport; currency: string }) {
  const t = useT()
  const s = t.comparisons.exposure
  const label = (c: string) => t.comparisons.assetClasses[c] ?? c
  if (report.tradeCount === 0) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
        <section className="glass-card">
          <EmptyState title={t.comparisons.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{t.comparisons.addTrade}</Link>}>
            {t.comparisons.noTradesText}
          </EmptyState>
        </section>
      </div>
    )
  }
  const measured = report.rows.filter((r) => r.shareOfRisk !== null)
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <div className="glass-card flex flex-col gap-1 p-5">
          <span className="caption uppercase tracking-[0.06em] text-tx3">{s.totalRisk}</span>
          <span className="text-[26px] font-semibold tabular-nums">{formatFeeRounded(report.totalRisk, currency)}</span>
          <span className="text-xs text-tx3">{s.totalRiskHint(report.tradeCount)}</span>
        </div>
        <div className="glass-card flex flex-col gap-1 p-5">
          <span className="caption uppercase tracking-[0.06em] text-tx3">{s.totalPct}</span>
          <span className="text-[26px] font-semibold tabular-nums">{formatRatioPercent(report.totalRiskPct, 1)}</span>
          <span className="text-xs text-tx3">{s.totalPctHint}</span>
        </div>
        <div className="glass-card flex flex-col gap-1 p-5">
          <span className="caption uppercase tracking-[0.06em] text-tx3">{s.noStop}</span>
          <span className="text-[26px] font-semibold tabular-nums">{report.withoutStopCount}</span>
          <span className="text-xs text-tx3">{s.noStopHint}</span>
        </div>
      </div>

      <Section title={s.chartTitle}>
        {measured.length === 0 ? (
          <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{s.unknownHint}</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={s.chartLabel}>
            {measured.map((r) => (
              <li key={r.assetClass} className="grid grid-cols-[150px_1fr_64px] items-center gap-3 text-sm">
                <span className="font-medium">{label(r.assetClass)}</span>
                <span className="h-3 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max((r.shareOfRisk ?? 0) * 100, 1)}%`, background: 'linear-gradient(90deg,#4A5FD9,#8B7FE8)' }} />
                </span>
                <span className="text-right font-semibold tabular-nums">{formatRatioPercent(r.shareOfRisk, 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={s.tableTitle} subtitle={s.tableHint} aside={<Link to="/analytics" className="btn btn-ghost">{s.byAsset}</Link>}>
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <Th label={s.columns.asset} />
                <Th label={s.columns.trades} align="right" />
                <Th label={s.columns.risk} align="right" />
                <Th label={s.columns.share} align="right" />
                <Th label={s.columns.pct} align="right" />
                <Th label={s.columns.avg} align="right" />
                <Th label={s.columns.noStop} align="right" />
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.assetClass} className="h-[52px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                  <td className="px-3 font-semibold">{label(r.assetClass)}</td>
                  <td className="px-3 text-right tabular-nums">{r.tradeCount}</td>
                  {r.riskTradeCount === 0 ? (
                    <Tooltip content={s.unknownHint}>
                      <td colSpan={4} className="px-3 text-right text-tx3">
                        {s.unknown}
                      </td>
                    </Tooltip>
                  ) : (
                    <>
                      <td className="px-3 text-right tabular-nums">{formatFeeRounded(r.riskAmount, currency)}</td>
                      <td className="px-3 text-right font-semibold tabular-nums">{formatRatioPercent(r.shareOfRisk, 1)}</td>
                      <td className="px-3 text-right tabular-nums">{formatRatioPercent(r.riskPctOfCapital, 1)}</td>
                      <td className="px-3 text-right tabular-nums text-tx2">{formatRatioPercent(r.avgRiskPct, 2)}</td>
                    </>
                  )}
                  <td className="px-3 text-right tabular-nums text-tx2">{r.withoutStopCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
