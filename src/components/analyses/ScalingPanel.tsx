import { useT } from '../../i18n'
import { roundDecimal } from '../../lib/decimal'
import { formatDate, formatMoney, formatRatioPercent, formatSignedRatioPercent } from '../../lib/format'
import type { ScalingHalf, ScalingReport } from '../../types/stats'
import { CompareBlock, Row } from '../behavior/parts'
import { Notice } from '../ui'
import { MultiLineChart, SERIES_COLORS } from './AnalysisCharts'
import { Section } from './parts'

/** Scaling du capital (3.3.21) : risque en % du solde, première moitié contre seconde, constat prudent. */
export function ScalingPanel({ report, currency }: { report: ScalingReport; currency: string }) {
  const t = useT().analysesMore.scaling
  const money = (v: string) => formatMoney(roundDecimal(v, 2), currency)

  if (report.tradeCount === 0) {
    return (
      <Section title={t.emptyTitle}>
        <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{t.emptyText}</p>
      </Section>
    )
  }
  const half = (title: string, h: ScalingHalf) => (
    <CompareBlock
      label={title}
      value={formatRatioPercent(h.avgRiskPct, 2)}
      tone="text-tx"
      lines={[t.halfTrades(h.tradeCount), t.halfRange(formatDate(h.from), formatDate(h.to)), t.avgBalance(money(h.avgBalance)), t.avgRisk(money(h.avgRisk))]}
    />
  )
  const verdict = report.verdict
  const points = report.points
  const balance = points.map((p) => ({ time: p.exitTime, value: Number(p.balanceAtEntry) }))
  const riskPct = points.map((p) => ({ time: p.exitTime, value: p.riskPct * 100 }))
  const pct = (v: number) => formatSignedRatioPercent(v, 1)
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{t.intro}</p>

      {verdict === 'notEnoughData' ? (
        <Notice level="warn">
          <b>{t.notEnoughTitle}.</b> {t.notEnough(report.minPerHalf, report.usableCount)}
        </Notice>
      ) : (
        <Notice level={verdict === 'stable' ? 'ok' : 'warn'}>
          <b>{t.verdicts[verdict]}.</b> {t.verdictSentences[verdict]}
          {!report.capitalMoved && verdict !== 'stable' && <> {t.capitalFlat(formatRatioPercent(report.capitalMoveThreshold, 0))}</>}
        </Notice>
      )}

      {report.older && report.recent && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {half(t.halves.older, report.older)}
            {half(t.halves.recent, report.recent)}
          </div>
          <Section title={t.changesTitle} subtitle={t.changesSubtitle}>
            <Row label={t.changeCapital}>{report.capitalChange === null ? '—' : pct(report.capitalChange)}</Row>
            <Row label={t.changeRisk}>{report.riskChange === null ? '—' : pct(report.riskChange)}</Row>
            <Row label={t.changeRiskPct}>{report.riskPctChange === null ? '—' : pct(report.riskPctChange)}</Row>
            <p className="mt-3 text-[12.5px] text-tx3">{t.verdictRule(formatRatioPercent(report.verdictBand, 0))}</p>
          </Section>
        </>
      )}

      {points.length >= 2 && (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          <Section title={t.chartBalance}>
            <MultiLineChart
              series={[{ id: 'balance', label: t.chartBalance, color: SERIES_COLORS[0], points: balance }]}
              label={t.chartBalanceLabel}
              format={(v) => formatMoney(roundDecimal(String(v), 0), currency)}
              fromZero={false}
              fill
            />
          </Section>
          <Section title={t.chartRisk}>
            <MultiLineChart
              series={[{ id: 'risk', label: t.chartRisk, color: SERIES_COLORS[1], points: riskPct }]}
              label={t.chartRiskLabel}
              format={(v) => formatRatioPercent(v / 100, 2)}
              fromZero={false}
              fill
            />
          </Section>
        </div>
      )}

      <div className="flex flex-col gap-1 text-[13px] text-tx3">
        <span>{t.currentCapital(money(report.currentCapital))}</span>
        {report.excludedCount > 0 && <span>{t.excluded(report.excludedCount, report.withoutStopCount)}</span>}
      </div>
      <p className="text-[12.5px] text-tx3">{t.caution}</p>
    </div>
  )
}
