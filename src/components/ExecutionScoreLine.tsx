import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { formatNumber } from '../lib/format'
import type { ExecutionScore } from '../types/journal'

/** Qualité d'exécution calculée par pulse-core (checklist, plan, règles), à côté de la note manuelle. */
export function ExecutionScoreLine({ tradeId }: { tradeId: number }) {
  const t = useT()
  const e = t.executionScore
  const [score, setScore] = useState<ExecutionScore | null>(null)

  useEffect(() => {
    let live = true
    api
      .getExecutionScore(tradeId)
      .then((s) => live && setScore(s))
      .catch(() => live && setScore(null))
    return () => {
      live = false
    }
  }, [tradeId])

  if (!score) return null
  const part = (label: string, v: number | null) => (v === null ? null : `${label} ${formatNumber(v, 0)} %`)
  const parts = [part(e.checklist, score.components.checklist), part(e.plan, score.components.plan), part(e.rules, score.components.rules)].filter(Boolean)
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="caption">{e.title}</span>
      {score.score === null ? (
        <span className="text-tx3">{e.none}</span>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2.5">
            <strong className="text-base">{e.value(formatNumber(score.score, 0))}</strong>
            <span className={`badge ${score.grade === 'good' ? 'badge-gain' : 'badge-warn'}`}>{score.grade === 'good' ? e.good : e.poor}</span>
          </span>
          {parts.length > 0 && <span className="text-tx2">{parts.join(' · ')}</span>}
          {score.source === 'manual' && score.autoScore !== null && <span className="text-tx3">{e.autoLabel(formatNumber(score.autoScore, 0))}</span>}
          {score.source && <span className="text-xs text-tx3">{e.source[score.source]}</span>}
        </>
      )}
    </div>
  )
}
