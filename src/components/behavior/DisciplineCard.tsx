import { useT } from '../../i18n'
import { formatMoney, formatRatioPercent, formatSignedMoney } from '../../lib/format'
import { formatScore } from '../../lib/behaviorFormat'
import type { DisciplineReport } from '../../types/behavior'
import { Card, Note, toneOfDecimal } from './parts'

const R = 90
const CIRC = 2 * Math.PI * R

/** Anneau de score (charte 6) : trait arrondi en dégradé bleu → violet, valeur au centre, « / 100 ». */
function Ring({ score }: { score: number | null }) {
  const t = useT().behavior.discipline
  const shown = formatScore(score)
  const fraction = score === null ? 0 : Math.min(Math.max(score, 0), 100) / 100
  return (
    <div className="relative mx-auto h-[220px] w-[220px]" role="img" aria-label={score === null ? t.ringEmptyLabel : t.ringLabel(shown)}>
      <svg viewBox="0 0 220 220" width="220" height="220" aria-hidden="true">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4A5FD9" />
            <stop offset="1" stopColor="#8B7FE8" />
          </linearGradient>
        </defs>
        <circle cx="110" cy="110" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="17" />
        {fraction > 0 && (
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth="17"
            strokeLinecap="round"
            strokeDasharray={`${fraction * CIRC} ${CIRC}`}
            transform="rotate(-90 110 110)"
            style={{ filter: 'drop-shadow(0 0 8px rgba(139,127,232,.6))' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className="text-[52px] font-semibold leading-none tabular-nums">{shown}</div>
        <div className="mt-1 text-[13px] text-tx3">{t.outOf}</div>
      </div>
    </div>
  )
}

export function DisciplineCard({ report, currency }: { report: DisciplineReport; currency: string }) {
  const t = useT().behavior.discipline
  const q = report.quadrants
  const quadrants = [
    { label: t.wellWins, q: q.wellExecutedWins },
    { label: t.poorWins, q: q.poorlyExecutedWins },
    { label: t.wellLosses, q: q.wellExecutedLosses },
    { label: t.poorLosses, q: q.poorlyExecutedLosses },
  ]
  return (
    <Card title={t.title} span="xl:col-span-4">
      <Ring score={report.score} />
      {report.sampleTooSmall ? (
        <div className="nt nt-warn mt-3" role="status">
          <b aria-hidden="true">i</b>
          <span>
            <b>{t.tooSmallTitle}.</b> {t.tooSmall(report.scoredTradeCount, report.minTradeCount)}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-center text-xs text-tx3">{t.basedOn(report.scoredTradeCount)}</p>
      )}

      <div className="mt-4">
        {report.components.map((c) => (
          <div key={c.key} className="hairline-row">
            <span className="text-tx2">
              {t.components[c.key]}
              <span className="ml-2 text-xs text-tx3">
                {t.weight(c.weight)}
                {c.average !== null && ` · ${t.componentTrades(c.tradeCount)}`}
              </span>
            </span>
            {c.average === null ? (
              <span className="text-tx3" title={t.componentEmpty}>—</span>
            ) : (
              <b className="tabular-nums">{formatRatioPercent(c.average, 0)}</b>
            )}
          </div>
        ))}
      </div>
      {report.settings.maxRiskPercent === null && <Note>{t.riskNoLimit}</Note>}
      <Note>{t.excluded}</Note>

      {!report.sampleTooSmall && (
        <div className="mt-4">
          <div className="caption mb-2">{t.quadrants}</div>
          <div className="grid grid-cols-2 gap-2">
            {quadrants.map(({ label, q: quad }) => (
              <div key={label} className="rounded-sm border px-3 py-2 text-xs" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
                <div className="text-tx2">{label}</div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 tabular-nums">
                  <b className="text-sm">{quad.count}</b>
                  <span className={toneOfDecimal(quad.netPnl)}>{quad.count === 0 ? formatMoney(quad.netPnl, currency) : formatSignedMoney(quad.netPnl, currency)}</span>
                </div>
              </div>
            ))}
          </div>
          <Note>{t.threshold(q.threshold)}</Note>
        </div>
      )}
    </Card>
  )
}
