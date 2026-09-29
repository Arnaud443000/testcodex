import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { roundDecimal } from '../../lib/decimal'
import { formatDate, formatMoney, formatPoints, formatR, formatRatioPercent, formatSignedNumber, formatSignedRatioPercent, formatSignedMoneyRounded } from '../../lib/format'
import { formatProfitFactor } from '../../lib/analysesView'
import type { Summary, YearComparison } from '../../types/stats'
import { toneOfDecimal, toneOfNumber } from '../behavior/parts'
import { Notice } from '../ui'
import { LowSampleBadge, PnlRounded, Section, Th } from './parts'

const DAY_MS = 86_400_000

/** Comparaison avec la même période un an plus tôt (3.3.19) : deux colonnes et l'écart calculé par pulse-core. */
export function YearPanel({ report, currency }: { report: YearComparison; currency: string }) {
  const all = useT()
  const t = all.analysesMore.year
  const label = (from: number | null, to: number | null) => (from === null || to === null ? '' : t.range(formatDate(from), formatDate(to - DAY_MS + 1)))

  if (!report.available) {
    return (
      <Section title={t.unavailableTitle}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{t.unavailableText}</p>
      </Section>
    )
  }
  const previous = report.previous as Summary
  const comparison = report.comparison
  const row = (name: string, cur: React.ReactNode, prev: React.ReactNode, gap: React.ReactNode) => (
    <tr key={name} className="h-[48px] border-t" style={{ borderColor: 'var(--hairline)' }}>
      <td className="px-3 text-tx2">{name}</td>
      <td className="px-3 text-right font-semibold tabular-nums">{cur}</td>
      <td className="px-3 text-right tabular-nums">{prev}</td>
      <td className="px-3 text-right tabular-nums">{gap}</td>
    </tr>
  )
  const dash = <span className="text-tx3">—</span>
  const m = t.metrics
  const c = report.current
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{t.intro}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          { title: t.currentLabel, range: label(report.from, report.to), sum: c, low: report.currentLowSample },
          { title: t.previousLabel, range: label(report.previousFrom, report.previousTo), sum: previous, low: report.previousLowSample },
        ].map((b) => (
          <div key={b.title} className="rounded-inner border p-4" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
            <div className="caption">{b.title}</div>
            <div className="mt-1 text-[13px] text-tx2">{b.range}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              {b.sum.tradeCount === 0 ? (
                <span className="text-[26px] font-semibold text-tx2">—</span>
              ) : (
                <span className="text-[26px] font-semibold tabular-nums">
                  <PnlRounded value={b.sum.netPnl} currency={currency} />
                </span>
              )}
              {b.low && b.sum.tradeCount > 0 && <LowSampleBadge />}
            </div>
            <div className="mt-0.5 text-[13px] text-tx2">{all.analyses.trades(b.sum.tradeCount)}</div>
          </div>
        ))}
      </div>

      {report.currentEmpty && (
        <Section title={t.currentEmptyTitle}>
          <p className="text-sm text-tx2">{t.currentEmptyText}</p>
        </Section>
      )}
      {report.previousEmpty && (
        <Notice level="warn">
          <b>{t.previousEmptyTitle}.</b> {report.previousReason ? t.reasons[report.previousReason] : ''} {t.previousEmptyHint}
        </Notice>
      )}

      {comparison && !report.currentEmpty && (
        <Section title={all.analysesMore.tabs.year} subtitle={t.drawdownHint}>
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th label={t.columns.metric} />
                  <Th label={t.columns.current} align="right" />
                  <Th label={t.columns.previous} align="right" />
                  <Th label={t.columns.gap} align="right" />
                </tr>
              </thead>
              <tbody>
                {row(
                  m.trades,
                  c.tradeCount,
                  previous.tradeCount,
                  <span>{comparison.tradeCount === 0 ? '0' : formatSignedNumber(comparison.tradeCount, 0)}</span>,
                )}
                {row(
                  m.netPnl,
                  <PnlRounded value={c.netPnl} currency={currency} />,
                  <PnlRounded value={previous.netPnl} currency={currency} />,
                  <span className="flex flex-col items-end">
                    <span className={toneOfDecimal(comparison.netPnl)}>{formatSignedMoneyRounded(comparison.netPnl, currency)}</span>
                    {comparison.netPnlPct !== null && <span className="text-xs text-tx3">{t.netPnlPct(formatSignedRatioPercent(comparison.netPnlPct, 0))}</span>}
                  </span>,
                )}
                {row(
                  m.winRate,
                  formatRatioPercent(c.winRate, 1),
                  formatRatioPercent(previous.winRate, 1),
                  comparison.winRate === null ? dash : <span className={toneOfNumber(comparison.winRate)}>{formatPoints(comparison.winRate)}</span>,
                )}
                {row(
                  m.profitFactor,
                  formatProfitFactor(c),
                  formatProfitFactor(previous),
                  comparison.profitFactor === null ? dash : <span className={toneOfNumber(comparison.profitFactor)}>{formatSignedNumber(comparison.profitFactor, 2)}</span>,
                )}
                {row(
                  m.expectancyR,
                  formatR(c.expectancyR, 2),
                  formatR(previous.expectancyR, 2),
                  comparison.expectancyR === null ? dash : <span className={toneOfNumber(comparison.expectancyR)}>{formatR(comparison.expectancyR, 2)}</span>,
                )}
                {row(
                  m.maxDrawdown,
                  formatMoney(roundDecimal(c.maxDrawdown, 2), currency),
                  formatMoney(roundDecimal(previous.maxDrawdown, 2), currency),
                  formatSignedMoneyRounded(comparison.maxDrawdown, currency),
                )}
              </tbody>
            </table>
          </div>
          {(report.currentLowSample || report.previousLowSample) && <p className="mt-3 text-[12.5px] text-tx3">{t.lowSample(report.minSample)}</p>}
        </Section>
      )}
      <p className="text-[12.5px] text-tx3">{t.caution}</p>
      {report.currentEmpty && report.previousEmpty ? (
        <Link to="/trades/new" className="btn btn-primary w-fit">{all.analyses.addTrade}</Link>
      ) : null}
    </div>
  )
}
