import { useT } from '../../i18n'
import { formatDuration, formatNumber } from '../../lib/format'
import type { DurationGroup, DurationReport } from '../../types/stats'
import { CompareBlock } from '../behavior/parts'
import { Notice } from '../ui'
import { LowSampleBadge, Section } from './parts'

/** Temps en position (3.3.20) : durées moyenne et médiane des gagnants et des perdants, ratio si l'échantillon le permet. */
export function DurationPanel({ report }: { report: DurationReport }) {
  const t = useT().analysesMore.duration
  const trades = useT().analyses.trades

  if (report.measuredCount === 0) {
    return (
      <Section title={t.emptyTitle}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{t.emptyText}</p>
        {(report.openTradeCount > 0 || report.invalidCount > 0) && <p className="mt-3 text-[13px] text-tx3">{t.excluded(report.openTradeCount, report.invalidCount)}</p>}
      </Section>
    )
  }
  const block = (title: string, g: DurationGroup) => (
    <div className="flex flex-col gap-2">
      <CompareBlock
        label={title}
        value={formatDuration(g.avgMs)}
        tone="text-tx"
        lines={g.tradeCount === 0 ? [t.noneInGroup] : [trades(g.tradeCount), t.average(formatDuration(g.avgMs)), t.median(formatDuration(g.medianMs))]}
      />
      {g.lowSample && g.tradeCount > 0 && (
        <div>
          <LowSampleBadge />
        </div>
      )}
    </div>
  )
  const ratio = (v: number | null) => (v === null ? '—' : `× ${formatNumber(v, 2)}`)
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{t.intro}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {block(t.winnersTitle, report.winners)}
        {block(t.losersTitle, report.losers)}
      </div>
      {report.breakevens.tradeCount > 0 && <p className="-mt-2 text-[13px] text-tx3">{t.breakevenLine(report.breakevens.tradeCount, formatDuration(report.breakevens.avgMs))}</p>}
      <Section title={t.ratioTitle} subtitle={t.ratioSubtitle}>
        {!report.comparable ? (
          <Notice level="warn">{t.notComparable(report.minSample)}</Notice>
        ) : report.avgRatio === null ? (
          <Notice level="warn">{t.undefinedRatio}</Notice>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CompareBlock label={t.ratioAverage} value={ratio(report.avgRatio)} tone="text-tx" lines={[t.ratioSentence(formatNumber(report.avgRatio, 2))]} />
              <CompareBlock
                label={t.ratioMedian}
                value={ratio(report.medianRatio)}
                tone="text-tx"
                lines={report.medianRatio === null ? [] : [t.ratioMedianSentence(formatNumber(report.medianRatio, 2))]}
              />
            </div>
            <p className="text-[12.5px] text-tx3">{t.ratioNote}</p>
          </div>
        )}
      </Section>
      {(report.openTradeCount > 0 || report.invalidCount > 0) && <p className="text-[12.5px] text-tx3">{t.excluded(report.openTradeCount, report.invalidCount)}</p>}
    </div>
  )
}
