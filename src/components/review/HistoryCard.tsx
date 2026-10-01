import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { periodTitle } from '../../lib/processGoalsView'
import { stateLook } from '../../lib/reviewView'
import type { WeeklyReview } from '../../types/review'
import { ANSWER_KEYS } from '../../types/review'
import { Icon } from '../Icon'
import { IntentionBadge } from './LastWeekCard'

/**
 * Les bilans déjà faits, en lecture seule, dans une liste repliable (repliée à l'ouverture). Le bilan affiché au-dessus
 * n'y figure pas. « Ouvrir cette semaine » mène à la page de cette semaine, où il se modifie.
 */
export function HistoryCard({ currentKey, refreshKey }: { currentKey: string; refreshKey: number }) {
  const t = useT()
  const r = t.review
  const [reviews, setReviews] = useState<WeeklyReview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    api
      .listWeeklyReviews(104)
      .then((list) => live && (setReviews(list), setError(null)))
      .catch((e) => live && setError(r.history.loadError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [refreshKey, r])

  const others = (reviews ?? []).filter((x) => x.periodKey !== currentKey)
  return (
    <section className="glass-card flex flex-col gap-3 px-6 py-5" aria-labelledby="review-history-title" data-testid="review-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-history-title" className="text-base font-semibold">{r.history.title}</h2>
        {others.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open} aria-controls="review-history-list" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? 'chevron' : 'right'} size={14} /> {open ? r.history.hide : r.history.show(others.length)}
          </button>
        )}
      </div>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      {reviews && others.length === 0 && <p className="text-sm text-tx2">{r.history.empty}</p>}
      {open && others.length > 0 && (
        <ul id="review-history-list" className="flex flex-col gap-4">
          {others.map((x) => {
            const title = periodTitle(t.processGoals, 'week', x.periodKey)
            const look = stateLook(x.state)
            const written = ANSWER_KEYS.filter((k) => x.answers[k].trim() !== '')
            return (
              <li key={x.id} className="flex flex-col gap-2 rounded-inner p-4" style={{ background: 'var(--control)', border: '1px solid var(--glass-border)' }} data-week={x.periodKey}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {title.title} <span className="font-normal text-tx3">{title.range}</span>
                  </p>
                  <span className="flex items-center gap-3">
                    <span className={`badge badge-icon ${look.badge}`}>
                      <Icon name={look.icon} size={13} /> {r.states[x.state]}
                    </span>
                    <Link to={`/review?week=${x.periodKey}`} className="btn-link text-[13px]">{r.history.open}</Link>
                  </span>
                </div>
                {written.length === 0 ? (
                  <p className="text-[13px] text-tx3">{r.history.noAnswer}</p>
                ) : (
                  <dl className="flex flex-col gap-2">
                    {written.map((k) => (
                      <div key={k}>
                        <dt className="text-xs text-tx3">{r.answers.questions[k]}</dt>
                        <dd className="whitespace-pre-wrap text-sm">{x.answers[k]}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {x.intentions.length > 0 && (
                  <div>
                    <p className="caption">{r.history.intentionsTitle}</p>
                    <ul className="mt-1 flex flex-col gap-1.5">
                      {x.intentions.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 flex-1 basis-[200px]">{i.text}</span>
                          <IntentionBadge outcome={i.outcome} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
