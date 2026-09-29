import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { groupInsights, insightMessage } from '../../lib/insightsView'
import type { Insight } from '../../types/insights'
import { PriorityBadge } from './InsightCard'

/** Nombre d'insights montrés dans le widget ; les autres sont sur la page. */
const SHOWN = 4

/** Corps du widget « Insights » du dashboard : les premiers insights (ordre du moteur), sans bouton d'action. */
export function InsightsWidgetCard({ title, insights }: { title: string; insights: Insight[] }) {
  const t = useT()
  const x = t.insights
  // Même ordre que la page : tendances, mises en avant, suggestions.
  const ordered = groupInsights(insights).flatMap((g) => g.items)
  const shown = ordered.slice(0, SHOWN)
  const rest = ordered.length - shown.length
  return (
    <section className="glass-card flex h-full flex-col overflow-auto p-6" data-testid="widget-insights">
      <h3 className="mb-3 whitespace-nowrap text-base font-semibold">{title}</h3>
      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center" role="status">
          <p className="max-w-[40ch] text-sm leading-relaxed text-tx2">{x.empty}</p>
          <p className="max-w-[40ch] text-xs leading-relaxed text-tx3">{x.emptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-3">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 border-b pb-3 last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
              <div className="flex items-center gap-2">
                <PriorityBadge priority={i.priority} />
                <span className="text-xs text-tx3">{x.categories[i.category]}</span>
              </div>
              <p className="text-[13px] leading-relaxed">{insightMessage(t, i)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        {rest > 0 ? <span className="text-xs text-tx3">{x.widget.more(rest)}</span> : <span />}
        <Link to="/insights" className="btn-link text-sm">{ordered.length > 0 ? x.widget.viewAllCount(ordered.length) : x.widget.viewAll}</Link>
      </div>
    </section>
  )
}
