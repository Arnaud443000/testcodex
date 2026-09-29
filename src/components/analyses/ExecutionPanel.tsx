import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatProfitFactor } from '../../lib/analysesView'
import { formatPoints, formatR, formatRatioPercent, formatSignedMoneyRounded, formatSignedNumber } from '../../lib/format'
import type { ExecutionBlock, ExecutionReport } from '../../types/stats'
import { CompareBlock, Row, toneOfDecimal, toneOfNumber } from '../behavior/parts'
import { Notice } from '../ui'
import { LowSampleBadge, Section } from './parts'

function block(label: string, b: ExecutionBlock, currency: string, t: ReturnType<typeof useT>['analyses']) {
  const s = b.summary
  const pf = formatProfitFactor(s)
  return (
    <div key={label} className="flex flex-col gap-2">
      {s.tradeCount === 0 ? (
        <CompareBlock label={label} value="—" tone="text-tx2" lines={[t.trades(0), t.execution.empty]} />
      ) : (
        <CompareBlock
          label={label}
          value={formatSignedMoneyRounded(s.netPnl, currency)}
          tone={toneOfDecimal(s.netPnl)}
          lines={[t.trades(s.tradeCount), t.execution.winRate(formatRatioPercent(s.winRate, 0)), t.execution.avgR(formatR(s.expectancyR, 2)), t.execution.profitFactor(pf)]}
        />
      )}
      {b.lowSample && s.tradeCount > 0 && (
        <div>
          <LowSampleBadge />
        </div>
      )}
    </div>
  )
}

/** Système contre discrétionnaire (3.3.17) : le type vient du champ du trade ; « non classé » n'entre jamais dans les écarts. */
export function ExecutionPanel({ report, currency }: { report: ExecutionReport; currency: string }) {
  const t = useT().analyses
  const tradesTitle = useT().pages.trades.title
  const e = t.execution
  const hasUnclassified = report.unclassified.summary.tradeCount > 0
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{e.intro}</p>
      <div className={`grid grid-cols-1 gap-4 ${hasUnclassified ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {block(e.system, report.system, currency, t)}
        {block(e.discretionary, report.discretionary, currency, t)}
        {hasUnclassified && block(e.unclassified, report.unclassified, currency, t)}
      </div>
      {hasUnclassified && (
        <p className="-mt-2 text-[13px] text-tx3">
          {e.unclassifiedHint}{' '}
          <Link to="/trades" className="btn-link">
            {tradesTitle}
          </Link>
        </p>
      )}
      <Section title={e.gapsTitle} subtitle={e.gapsSubtitle}>
        {report.comparable ? (
          <>
            <div>
              <Row label={e.gapWinRate}>
                <span className={toneOfNumber(report.winRateDelta)}>{report.winRateDelta === null ? '—' : formatPoints(report.winRateDelta)}</span>
              </Row>
              <Row label={e.gapAvgR}>
                <span className={toneOfNumber(report.expectancyRDelta)}>{report.expectancyRDelta === null ? '—' : `${formatSignedNumber(report.expectancyRDelta, 2)} R`}</span>
              </Row>
              <Row label={e.gapAvgPnl}>
                <span className={toneOfDecimal(report.avgNetPnlDelta)}>{report.avgNetPnlDelta === null ? '—' : formatSignedMoneyRounded(report.avgNetPnlDelta, currency)}</span>
              </Row>
            </div>
            <p className="mt-3 text-[12.5px] text-tx3">{e.gapsCaution}</p>
          </>
        ) : (
          <Notice level="warn">{e.notComparable(report.minSample)}</Notice>
        )}
      </Section>
    </div>
  )
}
