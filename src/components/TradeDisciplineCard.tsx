import { useEffect, useState } from 'react'
import { Tooltip } from './ui/Tooltip'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatPercentValue, formatScore } from '../lib/behaviorFormat'
import { componentRows, excludedRows, weakRows, type ComponentRow } from '../lib/disciplineExplain'
import { formatDuration, formatNumber, formatRatioPercent } from '../lib/format'
import type { TradeDiscipline } from '../types/behavior'
import { Ring } from './behavior/ScoreRing'

/** Score de discipline d'un trade (détail d'un trade) : jauge, composantes, pourquoi il est bas, composantes exclues. */
export function TradeDisciplineCard({ tradeId }: { tradeId: number }) {
  const t = useT()
  const s = t.tradeDiscipline
  const [data, setData] = useState<TradeDiscipline | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    api
      .getTradeDiscipline(tradeId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e instanceof Error ? e.message : e)))
    return () => {
      live = false
    }
  }, [tradeId])

  if (error) return <section className="glass-card px-6 py-[22px]"><div className="nt nt-bad" role="alert">{s.loadError(error)}</div></section>
  if (!data) return null

  const rows = componentRows(data)
  const weak = weakRows(rows)
  const excluded = excludedRows(rows)

  /** Phrase expliquant une composante, fabriquée à partir des faits fournis par pulse-core. */
  const sentence = (r: ComponentRow): string => {
    const d = r.detail
    switch (d.kind) {
      case 'plan':
        return s.detail.plan[d.plan ?? 'none']
      case 'rules':
        return d.checked === 0 ? s.detail.rulesNone : s.detail.rules(d.respected, d.checked)
      case 'checklist':
        return d.total === 0 ? s.detail.checklistNone : s.detail.checklist(d.checked, d.total)
      case 'stopLoss':
        return d.present ? s.detail.stopLossYes : s.detail.stopLossNo
      case 'risk':
        if (d.limit === null) return s.detail.riskNoLimit
        if (!d.hasStopLoss) return s.detail.riskNoStop
        if (d.riskPct === null) return s.detail.riskNoBalance
        return (r.value === 1 ? s.detail.riskWithin : s.detail.riskOver)(formatRatioPercent(d.riskPct, 2), formatPercentValue(d.limit))
      case 'behavior':
        if (d.revenge) return s.detail.revenge(formatDuration(d.revenge.gapMs), d.revenge.ratio === null ? null : formatNumber(d.revenge.ratio, 1))
        if (d.overtrading) return s.detail.overtrading(d.dayRank)
        return s.detail.behaviorOk
    }
  }

  return (
    <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="discipline-title">
      <div>
        <h2 id="discipline-title" className="text-[15px] font-semibold">{s.title}</h2>
        <p className="text-xs text-tx3">{s.subtitle}</p>
      </div>
      <Ring score={data.score} size={132} label={data.score === null ? s.ringEmptyLabel : s.ringLabel(formatScore(data.score))} />
      <p className="text-center text-xs text-tx3">{data.score === null ? s.noScore : s.coverage(formatRatioPercent(data.coverage, 0))}</p>

      {data.score !== null && (
        <div>
          <div className="caption mb-1.5">{s.lowTitle}</div>
          {weak.length === 0 ? (
            <p className="text-sm text-tx2">{s.lowNone}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {weak.map((r) => (
                <li key={r.key} className="text-sm leading-snug">
                  <b>{t.behavior.discipline.components[r.key]}</b> <span className="text-xs text-tx3">({s.weight(r.weight)})</span>
                  <br />
                  <span className="text-tx2">{sentence(r)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <div className="caption mb-1">{s.reasonHeading}</div>
        {rows.map((r) => (
          <div key={r.key} className="hairline-row items-start gap-3">
            <span className="min-w-0 text-tx2">
              {t.behavior.discipline.components[r.key]}
              <span className="ml-2 text-xs text-tx3">{s.weight(r.weight)}</span>
              {r.status === 'excluded' && <span className="mt-0.5 block text-xs text-[#E5C078]">{sentence(r)}</span>}
            </span>
            {r.status === 'excluded' ? (
              <Tooltip content={s.excluded}>
                <span className="shrink-0 text-xs text-tx3">— {s.excluded}</span>
              </Tooltip>
            ) : (
              <Tooltip content={r.status === 'weak' ? s.weak : s.full}>
                <b className="shrink-0 tabular-nums">
                  {formatRatioPercent(r.value, 0)}
                </b>
              </Tooltip>
            )}
          </div>
        ))}
        {excluded.length > 0 && <p className="mt-2 text-xs leading-relaxed text-tx3">{s.excludedIntro}</p>}
      </div>
    </section>
  )
}
