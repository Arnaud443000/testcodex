import { useState } from 'react'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { outcomeLook, weekNumber } from '../../lib/reviewView'
import type { IntentionOutcome, LastWeekIntentions } from '../../types/review'
import { INTENTION_OUTCOMES } from '../../types/review'
import { Icon } from '../Icon'
import { Segmented } from '../ui'
import { Tooltip } from '../ui/Tooltip'

/** Statut d'une intention : texte + icône ; la couleur ne fait que doubler le sens. */
export function IntentionBadge({ outcome }: { outcome: IntentionOutcome | null }) {
  const r = useT().review.lastWeek
  const look = outcomeLook(outcome)
  return (
    <span className={`badge badge-icon shrink-0 whitespace-nowrap ${look.badge}`} data-outcome={outcome ?? 'none'}>
      <Icon name={look.icon} size={13} />
      {outcome ? r.outcomes[outcome] : r.notEvaluated}
    </span>
  )
}

/**
 * La boucle d'intention : les intentions fixées dans le bilan de la semaine d'avant, avec trois réponses de suivi et
 * « Je ne sais pas » (reste non évalué). Aucun reproche : « Pas tenue » est un fait, pas une faute. Le compteur de
 * semaines de suite vient de pulse-core.
 */
export function LastWeekCard({ last, streak, onChanged }: { last: LastWeekIntentions | null; streak: number; onChanged: () => void }) {
  const r = useT().review.lastWeek
  const [error, setError] = useState<string | null>(null)

  async function choose(id: number, outcome: IntentionOutcome | null) {
    setError(null)
    try {
      await api.setIntentionOutcome(id, outcome)
      onChanged()
    } catch (e) {
      setError(r.saveError(String(e instanceof Error ? e.message : e).replace(/^invalid input: /, '')))
    }
  }

  return (
    <section className="glass-card flex flex-col gap-3 px-6 py-5" aria-labelledby="review-last-title" data-testid="review-last-week">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="review-last-title" className="text-base font-semibold">{r.title}</h2>
          {last && <p className="mt-0.5 text-xs text-tx3">{r.from(weekNumber(last.periodKey))}</p>}
        </div>
        {streak >= 2 && (
          <Tooltip content={r.streakHelp}>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tx-accent" data-streak={streak}>
              <Icon name="star" size={14} />
              {r.streak(streak)}
            </span>
          </Tooltip>
        )}
      </div>
      {!last ? (
        <p className="text-sm text-tx2">{r.none}</p>
      ) : (
        <>
          <p className="max-w-[70ch] text-[13px] text-tx2">{r.hint}</p>
          <ul className="flex flex-col gap-4">
            {last.intentions.map((i) => (
              <li key={i.id} className="flex flex-col gap-2" data-intention={i.position}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 basis-[200px] text-[15px] font-medium">{i.text}</p>
                  <IntentionBadge outcome={i.outcome} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-[260px] max-w-[360px] flex-1">
                    <Segmented<IntentionOutcome>
                      label={r.choiceLabel(i.text)}
                      value={i.outcome}
                      allowClear
                      onChange={(v) => void choose(i.id, v)}
                      options={INTENTION_OUTCOMES.map((o) => ({ value: o, label: r.outcomes[o] }))}
                    />
                  </div>
                  <button type="button" className="btn-link text-[13px]" disabled={i.outcome === null} onClick={() => void choose(i.id, null)}>
                    {r.unknown}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
    </section>
  )
}
