import { useT } from '../../i18n'
import { formatSignedMoney } from '../../lib/format'
import { formatR } from '../../lib/format'
import { formatSizeChange } from '../../lib/behaviorFormat'
import type { AfterLossesReport, SizeChangeReport, Streak, StreakReport } from '../../types/behavior'
import { Card, Note, toneOfDecimal, toneOfNumber } from './parts'

function StreakRow({ label, streak, currency, emptyText }: { label: string; streak: Streak | null; currency: string; emptyText: string }) {
  const t = useT().behavior.streaks
  return (
    <div className="hairline-row items-start">
      <span className="text-tx2">{label}</span>
      {streak === null ? (
        <span className="text-right text-tx3">{emptyText}</span>
      ) : (
        <span className="text-right">
          <b className={streak.outcome === 'win' ? 'text-gain' : 'text-loss'}>
            {streak.outcome === 'win' ? t.wins(streak.length) : t.losses(streak.length)}
          </b>
          <span className={`block text-xs tabular-nums ${toneOfDecimal(streak.netPnl)}`}>{formatSignedMoney(streak.netPnl, currency)}</span>
        </span>
      )}
    </div>
  )
}

/** Ligne « valeur en gros + précisions dessous » : la valeur manquante s'affiche « — » avec la raison. */
function SequenceRow({ label, value, tone, lines }: { label: string; value: string; tone: string; lines: string[] }) {
  return (
    <div className="hairline-row flex-wrap items-baseline">
      <span className="text-tx2">{label}</span>
      <b className={`tabular-nums ${tone}`}>{value}</b>
      {lines.map((l) => (
        <span key={l} className="basis-full text-xs text-tx3">{l}</span>
      ))}
    </div>
  )
}

/** « Moyenne après 2 pertes » : espérance en R de ces trades, comparée aux autres ; « — » si l'échantillon est trop petit. */
export function AfterLossesRow({ report }: { report: AfterLossesReport }) {
  const q = useT().behavior.sequences
  const g = report.afterTwoLosses
  const n = g.summary.tradeCount
  const lines: string[] = []
  if (report.sampleTooSmall) lines.push(n === 0 ? q.noneYet : q.tooSmall(n, report.minTradeCount))
  else if (g.summary.expectancyR === null) lines.push(q.noR)
  else lines.push(q.tradesAfter(n), q.others(formatR(report.others.summary.expectancyR, 2)))
  const value = report.sampleTooSmall ? '—' : formatR(g.summary.expectancyR, 2)
  return <SequenceRow label={q.afterTwoLosses} value={value} tone={report.sampleTooSmall ? 'text-tx2' : toneOfNumber(g.summary.expectancyR)} lines={lines} />
}

/** « Taille après une perte » : variation moyenne de l'exposition ; « — » sous 5 cas comparables. */
export function SizeAfterLossRow({ report }: { report: SizeChangeReport }) {
  const q = useT().behavior.sequences
  const g = report.afterLoss
  const lines: string[] = []
  if (g.meanChange === null) lines.push(g.caseCount === 0 ? q.cases(0) : q.tooSmall(g.caseCount, report.minCaseCount))
  else {
    lines.push(`${q.cases(g.caseCount)} · ${q.median(formatSizeChange(g.medianChange))}`)
    if (report.afterWin.meanChange !== null) lines.push(q.afterWin(formatSizeChange(report.afterWin.meanChange)))
  }
  if (g.notComparableCount > 0) lines.push(q.notComparable(g.notComparableCount))
  const tone = g.meanChange === null ? 'text-tx2' : g.meanChange > 0 ? 'text-warn' : 'text-neutral'
  return <SequenceRow label={q.sizeAfterLoss} value={formatSizeChange(g.meanChange)} tone={tone} lines={lines} />
}

export function StreaksCard({ report, currency, afterLosses, sizeChange }: { report: StreakReport; currency: string; afterLosses?: AfterLossesReport; sizeChange?: SizeChangeReport }) {
  const t = useT().behavior.streaks
  const q = useT().behavior.sequences
  return (
    <Card title={t.title} span="xl:col-span-3">
      <StreakRow label={t.current} streak={report.current} currency={currency} emptyText={t.noCurrent} />
      <StreakRow label={t.longestWin} streak={report.longestWin} currency={currency} emptyText={t.none} />
      <StreakRow label={t.longestLoss} streak={report.longestLoss} currency={currency} emptyText={t.none} />
      {afterLosses && <AfterLossesRow report={afterLosses} />}
      {sizeChange && <SizeAfterLossRow report={sizeChange} />}
      <Note>{t.note}</Note>
      {(afterLosses || sizeChange) && <Note>{q.note}</Note>}
    </Card>
  )
}
