import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { MIN_CHECKS_FOR_TREND, formatMonthKey } from '../../lib/behaviorFormat'
import { formatPoints, formatRatioPercent } from '../../lib/format'
import type { MonthAdherence, RuleAdherence, RuleAdherenceReport } from '../../types/behavior'
import { Card, EmptyLine, Note } from './parts'

/** Une barre par mois : la hauteur est le taux de respect (0 à 100 %), fourni par pulse-core. Un mois sans coche reste vide. */
function MonthBars({ months }: { months: MonthAdherence[] }) {
  const t = useT().behavior.rules
  return (
    <div className="flex h-8 items-end gap-1" role="group" aria-label={t.monthAria}>
      {months.map((m) => (
        <span
          key={m.month}
          className="block w-[14px] rounded-t-[3px]"
          style={{ height: m.rate === null ? '2px' : `${Math.max(m.rate * 100, 4)}%`, background: m.rate === null ? 'rgba(255,255,255,.18)' : 'var(--grad)', opacity: 0.85 }}
          role="img"
          aria-label={t.monthBar(formatMonthKey(m.month), formatRatioPercent(m.rate, 0), m.respected, m.checks)}
          title={t.monthBar(formatMonthKey(m.month), formatRatioPercent(m.rate, 0), m.respected, m.checks)}
        />
      ))}
    </div>
  )
}

/** Tendance = écart de taux entre la moitié récente et la moitié ancienne ; le sens est écrit (▲ ▼ ■) et signé, jamais la couleur seule. */
function Trend({ trend }: { trend: number | null }) {
  const t = useT().behavior.rules
  if (trend === null) return <span className="text-tx3" title={t.trendNoneHint(MIN_CHECKS_FOR_TREND)}>{t.trendNone}</span>
  const text = formatPoints(trend, 0)
  if (text.startsWith('+')) return <span className="text-gain">{t.trendUp(text)}</span>
  if (text.startsWith('−')) return <span className="text-loss">{t.trendDown(text)}</span>
  return <span className="text-neutral">{t.trendFlat(text)}</span>
}

function RuleRow({ rule }: { rule: RuleAdherence }) {
  const t = useT().behavior.rules
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words text-sm font-medium leading-snug">
          {rule.text}
          {rule.archived && <span className="ml-2 text-xs font-normal text-tx3">({t.archived})</span>}
        </span>
        <b className="shrink-0 text-lg tabular-nums">{formatRatioPercent(rule.rate, 0)}</b>
      </div>
      <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5 text-xs text-tx3">
        <span className="tabular-nums">
          {rule.checks === 0 ? t.neverChecked : `${t.checks(rule.checks)} · ${rule.respected} / ${rule.checks}`}
          {' · '}
          {t.trend} <Trend trend={rule.trend} />
        </span>
        {rule.monthly.length > 0 && <MonthBars months={rule.monthly} />}
      </div>
    </li>
  )
}

export function RulesCard({ report }: { report: RuleAdherenceReport }) {
  const t = useT().behavior.rules
  return (
    <Card title={t.title} span="xl:col-span-6">
      {report.checks === 0 ? (
        <>
          <EmptyLine>{t.empty}</EmptyLine>
          <Link to="/settings" className="btn btn-secondary self-center">{t.manage}</Link>
        </>
      ) : (
        <>
          <div className="mb-1 flex items-baseline justify-between gap-3 rounded-inner border px-4 py-3" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
            <div>
              <div className="caption">{t.overall}</div>
              <div className="mt-0.5 text-xs text-tx3 tabular-nums">{t.summary(report.respected, report.checks, report.tradesWithChecks)}</div>
            </div>
            <b className="text-[28px] font-semibold leading-none tabular-nums">{formatRatioPercent(report.rate, 0)}</b>
          </div>
          <ul>
            {report.rules.map((r) => (
              <RuleRow key={r.ruleId} rule={r} />
            ))}
          </ul>
          <Note>{t.trendNote}</Note>
        </>
      )}
    </Card>
  )
}
