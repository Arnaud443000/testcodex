import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatDayLong, formatTimeOfDay, snippet } from '../../lib/analysisView'
import { api } from '../../lib/api'
import { useLocalDay } from '../../lib/useLocalDay'
import type { TradeLinks } from '../../types/analysis'

/** Détail d'un trade : l'analyse et les idées auxquelles il est lié (rien si aucune). */
export function TradeLinksCard({ tradeId }: { tradeId: number }) {
  const t = useT()
  const d = t.analysis.tradeDetail
  const { day } = useLocalDay()
  const [links, setLinks] = useState<TradeLinks | null>(null)

  useEffect(() => {
    let live = true
    api.getTradeLinks(tradeId).then((x) => live && setLinks(x)).catch(() => live && setLinks({ ideas: [], analyses: [] }))
    return () => {
      live = false
    }
  }, [tradeId])

  if (!links) return null
  const empty = links.ideas.length === 0 && links.analyses.length === 0
  return (
    <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="trade-links-title">
      <h2 id="trade-links-title" className="text-base font-semibold">{d.title}</h2>
      {empty ? (
        <p className="text-sm text-tx3">{d.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {links.analyses.map((a) => (
            <li key={`a${a.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="capitalize tabular-nums">{d.analysis(formatTimeOfDay(a.createdAt, a.tzOffsetMin), formatDayLong(a.day))}</span>
              <Link className="btn-link" to={a.day === day ? '/analysis' : '/analysis?tab=archives'}>{d.open}</Link>
            </li>
          ))}
          {links.ideas.map((i) => (
            <li key={`i${i.id}`} className="flex flex-col gap-0.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{d.idea(i.symbol)}</span>
                <span className="flex items-center gap-3">
                  <span className={`badge ${i.status === 'closed' ? 'badge-neutral' : 'badge-warn'}`}>{d.status[i.status]}</span>
                  <Link className="btn-link" to={i.status === 'closed' ? '/analysis?tab=archives' : '/analysis?tab=ideas'}>{d.open}</Link>
                </span>
              </div>
              <p className="text-[13px] text-tx2">{snippet(i.note, 140)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
