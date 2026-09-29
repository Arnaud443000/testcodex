import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatR } from '../../lib/format'
import { formatMoneyGap, formatRGap, formatScore, formatScoreGap } from '../../lib/behaviorFormat'
import type { Comparison, ExternalFactorReport, FactorReport } from '../../types/behavior'
import { Card, EmptyLine, Note } from './parts'

/** Une comparaison (discipline ou espérance) : avec / sans, puis une phrase prudente, jamais de « parce que ». */
function MetricLine({ f, kind, cmp, format, minDays, minTrades }: { f: FactorReport; kind: 'discipline' | 'expectancy'; cmp: Comparison; format: (v: number | null) => string; minDays: number; minTrades: number }) {
  const t = useT().behavior.factors
  const gap = kind === 'discipline' ? formatScoreGap(cmp.difference) : formatRGap(cmp.difference)
  return (
    <div className="hairline-row items-start !py-2 text-[13px]">
      <span className="text-tx2">{kind === 'discipline' ? t.discipline : t.expectancy}</span>
      <span className="text-right tabular-nums">
        <span>{t.with} {format(cmp.present)}</span>
        <span className="mx-1.5 text-tx3">·</span>
        <span>{t.without} {format(cmp.absent)}</span>
        <span className="block text-xs text-tx3">
          {cmp.verdict === 'notEnoughData'
            ? f.present.dayCount >= minDays && f.absent.dayCount >= minDays ? t.metricMissing(minTrades) : '—'
            : t.verdict(t.when[f.key], t.metricNoun[kind], t.verdictWord[cmp.verdict], gap)}
        </span>
      </span>
    </div>
  )
}

function FactorBlock({ f, report, currency }: { f: FactorReport; report: ExternalFactorReport; currency: string }) {
  const t = useT().behavior.factors
  const small = f.discipline.verdict === 'notEnoughData' && f.expectancyR.verdict === 'notEnoughData' && (f.present.dayCount < report.minDayCount || f.absent.dayCount < report.minDayCount)
  return (
    <div className="rounded-inner border p-4" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="text-[15px] font-semibold">{t.names[f.key]}</h4>
        <span className="text-xs tabular-nums text-tx3">
          {t.with} : {t.days(f.present.dayCount)} · {t.without} : {t.days(f.absent.dayCount)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-tx3">{t.rule[f.key]}</p>
      {small ? (
        <p className="mt-3 rounded-inner border px-3 py-2 text-[13px] leading-relaxed text-tx2" style={{ borderColor: 'var(--hairline)' }}>
          {t.tooSmall(report.minDayCount, f.present.dayCount, f.absent.dayCount)}
        </p>
      ) : (
        <div className="mt-2">
          <MetricLine f={f} kind="discipline" cmp={f.discipline} format={formatScore} minDays={report.minDayCount} minTrades={report.minRTradeCount} />
          <MetricLine f={f} kind="expectancy" cmp={f.expectancyR} format={(v) => formatR(v, 2)} minDays={report.minDayCount} minTrades={report.minRTradeCount} />
          {f.avgNetPnlDifference !== null && <p className="mt-2 text-xs text-tx3">{t.pnlGap(formatMoneyGap(f.avgNetPnlDifference, currency))}</p>}
        </div>
      )}
      {f.undeclaredTradeCount > 0 && <p className="mt-2 text-xs text-tx3">{t.undeclared(f.undeclaredDayCount, f.undeclaredTradeCount)}</p>}
    </div>
  )
}

/** Facteurs externes (cahier 3.4.9) : sommeil, fatigue, horaires tardifs, humeur du journal contre qualité des trades. */
export function FactorsCard({ report, currency }: { report: ExternalFactorReport; currency: string }) {
  const t = useT().behavior.factors
  return (
    <Card title={t.title} span="xl:col-span-12">
      {report.journalDayCount === 0 ? (
        <>
          <EmptyLine>
            <b className="block text-tx">{t.emptyTitle}</b>
            {t.emptyText}
          </EmptyLine>
          <div className="flex justify-center pb-2">
            <Link to="/journal" className="btn btn-primary">{t.openJournal}</Link>
          </div>
        </>
      ) : (
        <>
          <p className="-mt-2 mb-3 text-sm text-tx2">{t.subtitle}</p>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {report.factors.map((f) => (
              <FactorBlock key={f.key} f={f} report={report} currency={currency} />
            ))}
          </div>
          <Note>{t.coverage(report.journalDayCount, report.tradingDayCount)} {t.prudence}</Note>
        </>
      )}
    </Card>
  )
}
