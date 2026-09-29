import { useT } from '../../i18n'
import { Fragment } from 'react'
import { roundDecimal } from '../../lib/decimal'
import { formatPercentValue, heatTier, isLossBin, rBinLabel } from '../../lib/behaviorFormat'
import { formatMoney, formatR, formatRatioPercent, formatSignedAmount, formatSignedMoney } from '../../lib/format'
import type { Heatmap, LongShort, RDistribution, RiskReport } from '../../types/stats'
import { Card, CompareBlock, EmptyLine, Note, Row, toneOfDecimal, toneOfNumber } from './parts'

/** Histogramme des R (charte 6) : barres à coins arrondis, gain en vert, perte en corail, borne basse de chaque tranche en abscisse. */
export function RDistributionCard({ report }: { report: RDistribution }) {
  const t = useT().behavior.rDistribution
  const max = Math.max(...report.bins.map((b) => b.count), 0)
  return (
    <Card title={t.title} span="xl:col-span-7">
      <p className="mb-3 text-[12.5px] text-tx3">{t.subtitle}</p>
      {report.rTradeCount === 0 ? (
        <EmptyLine>{t.empty}</EmptyLine>
      ) : (
        <>
          <div className="flex h-[170px] items-end gap-1" role="list">
            {report.bins.map((b) => {
              const label = rBinLabel(b)
              return (
                <div key={label} className="flex h-full flex-1 flex-col justify-end" role="listitem" title={t.barLabel(label, b.count)} aria-label={t.barLabel(label, b.count)}>
                  <span className="mb-1 text-center text-[11px] tabular-nums text-tx2">{b.count > 0 ? b.count : ''}</span>
                  {b.count > 0 && (
                    <div
                      className={`w-full rounded-t-[6px] ${isLossBin(b) ? 'bg-loss' : 'bg-gain'}`}
                      style={{ height: `${Math.max((b.count / max) * 82, 3)}%` }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-1 border-t pt-1.5" style={{ borderColor: 'var(--hairline)' }} aria-hidden="true">
            {report.bins.map((b) => (
              <span key={rBinLabel(b)} className="flex-1 text-center text-[10px] tabular-nums text-tx3">{rBinLabel(b)}</span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span className="text-tx2">{t.mean} <b className={`ml-1 tabular-nums ${toneOfNumber(report.meanR)}`}>{formatR(report.meanR, 2)}</b></span>
            <span className="text-tx2">{t.median} <b className={`ml-1 tabular-nums ${toneOfNumber(report.medianR)}`}>{formatR(report.medianR, 2)}</b></span>
          </div>
        </>
      )}
      {report.noRCount > 0 && <Note>{t.noR(report.noRCount)}</Note>}
    </Card>
  )
}

/** Heatmap jour de semaine × heure d'entrée (charte 6) : trois paliers de teinte, signe écrit dans chaque case. */
export function HeatmapCard({ report, currency }: { report: Heatmap; currency: string }) {
  const t = useT().behavior.heatmap
  const cells = report.cells
  if (cells.length === 0) {
    return (
      <Card title={t.title} span="xl:col-span-8">
        <EmptyLine>{t.empty}</EmptyLine>
      </Card>
    )
  }
  const first = Math.min(...cells.map((c) => c.hour))
  const last = Math.max(...cells.map((c) => c.hour))
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const at = (weekday: number, hour: number) => cells.find((c) => c.weekday === weekday && c.hour === hour)
  return (
    <Card title={t.title} span="xl:col-span-8">
      <p className="mb-3 text-[12.5px] text-tx3">{t.subtitle}</p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-1" style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[11px] tabular-nums text-tx3">{String(h).padStart(2, '0')}</span>
          ))}
          {t.weekdays.map((day, i) => (
            <Fragment key={day}>
              <span className="self-center text-xs text-tx2">{day}</span>
              {hours.map((h) => {
                const c = at(i + 1, h)
                if (!c) return <span key={h} className="h-[42px] rounded-sm" style={{ background: 'rgba(255,255,255,.04)' }} />
                const { tone, tier } = heatTier(c.intensity)
                const net = formatSignedMoney(c.netPnl, currency)
                const text = t.cell(day, h, net, c.tradeCount, formatRatioPercent(c.winRate, 0))
                return (
                  <span
                    key={h}
                    className={`grid h-[42px] place-items-center rounded-sm text-[10.5px] font-semibold tabular-nums ${tone === 'gain' ? `cal-g${tier}` : tone === 'loss' ? `cal-l${tier}` : ''}`}
                    style={tone === 'none' ? { background: 'rgba(255,255,255,.08)' } : undefined}
                    title={text}
                    aria-label={text}
                  >
                    {formatSignedAmount(c.netPnl)}
                  </span>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <Note>{t.legend}</Note>
    </Card>
  )
}

/** Long contre short (3.3.10) : deux blocs de comparaison et la part des longs. */
export function LongShortCard({ report, currency }: { report: LongShort; currency: string }) {
  const t = useT()
  const l = t.behavior.longShort
  const block = (label: string, s: LongShort['long']) =>
    s.tradeCount === 0 ? (
      <CompareBlock label={label} value="—" tone="text-tx2" lines={[t.behavior.trades(0), l.empty]} />
    ) : (
      <CompareBlock
        label={label}
        value={formatSignedMoney(s.netPnl, currency)}
        tone={toneOfDecimal(s.netPnl)}
        lines={[t.behavior.trades(s.tradeCount), t.behavior.winRate(formatRatioPercent(s.winRate, 0)), `${t.behavior.plan.expectancyShort} ${formatR(s.expectancyR, 2)}`]}
      />
    )
  const share = report.longShare
  return (
    <Card title={l.title} span="xl:col-span-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {block(t.common.directions.long, report.long)}
        {block(t.common.directions.short, report.short)}
      </div>
      {share !== null && (
        <div className="mt-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[.06]" aria-hidden="true">
            <i className="block h-full" style={{ width: `${share * 100}%`, background: '#4A5FD9' }} />
            <i className="block h-full" style={{ width: `${(1 - share) * 100}%`, background: '#8B7FE8' }} />
          </div>
          <Note>{l.share(formatRatioPercent(share, 0))}</Note>
        </div>
      )}
    </Card>
  )
}

/** Risque en % du solde à l'entrée (3.3.12). */
export function RiskCard({ report, currency }: { report: RiskReport; currency: string }) {
  const t = useT().behavior.risk
  const computed = report.tradeCount - report.withoutStopCount
  return (
    <Card title={t.title} span="xl:col-span-5">
      <p className="mb-3 text-[12.5px] text-tx3">{t.subtitle}</p>
      {computed === 0 ? (
        <EmptyLine>{t.empty}</EmptyLine>
      ) : (
        <div>
          <Row label={t.average}>{formatRatioPercent(report.avgRiskPct, 2)}</Row>
          <Row label={t.median}>{formatRatioPercent(report.medianRiskPct, 2)}</Row>
          <Row label={t.max}>{formatRatioPercent(report.maxRiskPct, 2)}</Row>
        </div>
      )}
      {report.maxRiskPercent === null ? (
        <Note>{t.noLimit}</Note>
      ) : (
        <div className="mt-3 text-sm">
          <div className="text-tx2">
            {t.limit(formatPercentValue(report.maxRiskPercent))}
            {report.limitAmount !== null && <span className="text-tx3"> ({formatMoney(roundDecimal(report.limitAmount, 2), currency)})</span>}
          </div>
          {report.overLimitCount !== null && (
            <div className={`mt-1 font-semibold ${report.overLimitCount > 0 ? 'text-warn' : 'text-tx2'}`}>{t.overLimit(report.overLimitCount)}</div>
          )}
        </div>
      )}
      {report.withoutStopCount > 0 && <Note>{t.withoutStop(report.withoutStopCount)}</Note>}
    </Card>
  )
}
