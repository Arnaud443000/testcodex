import { Link } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { roundDecimal } from '../../lib/decimal'
import { formatDecimal, formatMoney, formatSignedMoneyRounded } from '../../lib/format'
import type { OpportunityReport } from '../../types/stats'
import { CompareBlock } from '../behavior/parts'
import { Notice } from '../ui'
import { LowSampleBadge, PnlRounded, Section, Th } from './parts'

/** Coût d'opportunité (3.3.18) : ce que pulse-core a estimé, avec le nombre de trades exclus faute de donnée. */
export function OpportunityPanel({ report, currency }: { report: OpportunityReport; currency: string }) {
  const all = useT()
  const t = all.analysesMore.opportunity
  const money = (v: string) => formatMoney(roundDecimal(v, 2), currency)

  if (report.eligibleCount === 0) {
    return (
      <Section title={t.emptyTitle}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{report.tradeCount === 0 ? t.emptyNoTrade : t.emptyNoData(report.tradeCount)}</p>
      </Section>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{t.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{t.coverage(report.eligibleCount, report.tradeCount)}</span>
        {report.lowSample && <LowSampleBadge />}
      </div>
      {report.excludedCount > 0 && (
        <Notice level="warn">
          {t.excluded(report.excludedCount, report.withoutTargetCount, report.withoutPriceAfterCount)} {t.fillHint}
        </Notice>
      )}
      {report.lowSample && <p className="-mt-3 text-[13px] text-tx3">{t.lowSample(report.minSample)}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CompareBlock
          label={t.leftTitle}
          value={money(report.totalLeftOnTable)}
          tone="text-warn"
          lines={[...t.leftLines(report.leftCount, report.leftPerEarlyExit === null ? null : money(report.leftPerEarlyExit)), t.leftNote]}
        />
        <CompareBlock
          label={t.avoidedTitle}
          value={money(report.totalAvoided)}
          tone="text-tx"
          lines={[...t.avoidedLines(report.avoidedCount), t.avoidedNote]}
        />
        <CompareBlock label={t.netTitle} value={formatSignedMoneyRounded(report.netPnlOfEligible, currency)} tone="text-tx" lines={[t.netLine]} />
      </div>
      <Section title={t.tableTitle} subtitle={t.tableSubtitle}>
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <Th label={t.columns.symbol} />
                <Th label={t.columns.exit} align="right" />
                <Th label={t.columns.target} align="right" />
                <Th label={t.columns.after} align="right" />
                <Tooltip content={t.moveHint}>
                  <th scope="col" className="caption px-3 py-3 text-right font-semibold uppercase tracking-[0.06em]">{t.columns.move}</th>
                </Tooltip>
                <Th label={t.columns.left} align="right" />
                <Th label={t.columns.net} align="right" />
              </tr>
            </thead>
            <tbody>
              {report.trades.map((r) => (
                <tr key={r.tradeId} className="h-[48px] border-t transition hover:bg-white/[0.04]" style={{ borderColor: 'var(--hairline)' }}>
                  <td className="px-3">
                    <Link to={`/trades/${r.tradeId}`} aria-label={t.open(r.symbol)} className="font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                      {r.symbol}
                    </Link>{' '}
                    <span className="text-xs text-tx3">{all.common.directions[r.direction]} · #{r.tradeId}</span>
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatDecimal(r.exitPrice)}</td>
                  <td className="px-3 text-right tabular-nums">{formatDecimal(r.plannedTp)}</td>
                  <td className="px-3 text-right tabular-nums">{formatDecimal(r.priceAfterExit)}</td>
                  <td className="px-3 text-right tabular-nums text-tx2">{formatSignedMoneyRounded(r.moveAfterExit, currency)}</td>
                  <td className="px-3 text-right font-semibold tabular-nums text-warn">{money(r.leftOnTable)}</td>
                  <td className="px-3 text-right tabular-nums">
                    <PnlRounded value={r.netPnl} currency={currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="text-[12.5px] text-tx3">{t.caution}</p>
    </div>
  )
}
