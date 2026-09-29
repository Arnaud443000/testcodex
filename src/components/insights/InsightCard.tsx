import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { insightEvidence, insightHint, insightMessage, insightNotCausal, insightPeriod } from '../../lib/insightsView'
import type { Insight, InsightPriority } from '../../types/insights'

const PRIORITY_BADGE: Record<InsightPriority, string> = { high: 'badge-warn', medium: 'badge-neutral', low: 'badge-neutral' }

/** Le badge de priorité porte toujours son texte : la couleur n'est qu'un renfort. */
export function PriorityBadge({ priority }: { priority: InsightPriority }) {
  const t = useT().insights
  return <span className={`badge ${PRIORITY_BADGE[priority]} w-fit`}>{t.priorities[priority]}</span>
}

interface Props {
  insight: Insight
  /** Nom du compte, affiché quand plusieurs comptes existent. */
  accountName?: string | null
  isNew?: boolean
  /** Absent = pas de bouton « Masquer » (insight déjà masqué, historique). */
  onDismiss?: (id: string) => void
  busy?: boolean
  /** Ligne de contexte sous la carte (historique : première et dernière apparition). */
  meta?: ReactNode
}

/**
 * Une carte d'insight : priorité en texte, catégorie, phrase (gabarit + valeurs formatées), piste, mention « pas une
 * cause » sur les suggestions, fenêtre, liens de preuve. Aucun calcul : tout vient de pulse-core.
 */
export function InsightCard({ insight, accountName, isNew = false, onDismiss, busy = false, meta }: Props) {
  const t = useT()
  const x = t.insights
  const hint = insightHint(t, insight)
  const notCausal = insightNotCausal(t, insight)
  const ev = insightEvidence(insight)
  return (
    <li className="glass-card flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4" data-testid="insight-card" data-kind={insight.kind} data-key={insight.messageKey}>
      <div className="flex w-[150px] shrink-0 flex-col gap-1.5">
        <PriorityBadge priority={insight.priority} />
        <span className="text-xs text-tx2">{x.categories[insight.category]}</span>
        {isNew && <span className="badge badge-gain w-fit" data-testid="insight-new">{x.isNew}</span>}
      </div>
      <div className="min-w-[280px] flex-1">
        <p className="max-w-[80ch] text-[14.5px] leading-relaxed">{insightMessage(t, insight)}</p>
        {hint && <p className="mt-2 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{hint}</p>}
        {notCausal && <p className="mt-1 max-w-[80ch] text-xs text-tx3">{notCausal}</p>}
        <p className="mt-2 text-xs text-tx3">
          {insightPeriod(t, insight)}
          {accountName && <span> · {x.onAccount(accountName)}</span>}
        </p>
        {meta && <p className="mt-1 text-xs text-tx3">{meta}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {ev.filterTo && <Link to={ev.filterTo} className="btn btn-secondary btn-sm">{x.seeTrades}</Link>}
          <Link to={ev.reportTo} className="btn btn-secondary btn-sm">{x.reports[insight.source] ?? x.seeReport}</Link>
          {ev.tradeIds.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-tx3">
              <span>{x.tradesLabel} :</span>
              {ev.tradeIds.map((id) => (
                <Link key={id} to={`/trades/${id}`} className="btn-link">{x.tradeLink(id)}</Link>
              ))}
              {ev.moreTrades > 0 && <span>{x.moreTrades(ev.moreTrades)}</span>}
            </span>
          )}
        </div>
      </div>
      {onDismiss && (
        <div className="flex shrink-0 flex-col items-end">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDismiss(insight.id)}>
            {x.dismiss}
          </button>
        </div>
      )}
    </li>
  )
}
