import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { FactsCard } from '../components/review/FactsCard'
import { HistoryCard } from '../components/review/HistoryCard'
import { LastWeekCard } from '../components/review/LastWeekCard'
import { ReviewForm } from '../components/review/ReviewForm'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { localTzOffsetMin } from '../lib/period'
import { periodTitle } from '../lib/processGoalsView'
import { boundaryOffsets, currentPeriodKey, parsePeriod } from '../lib/processPeriods'
import { stateLook } from '../lib/reviewView'
import type { ReviewState, WeeklyReviewView } from '../types/review'

/**
 * Le bilan hebdomadaire (lot 36) : les faits de la semaine (calculés par pulse-core, jamais ici), les intentions de la
 * semaine d'avant à suivre, trois questions courtes et 1 à 3 intentions pour la suivante. Un constat, jamais un conseil.
 * La semaine se choisit par `?week=AAAA-Www` (liens de l'historique et de la bannière) ; sans paramètre, c'est la semaine en cours.
 */
export function ReviewPage() {
  const t = useT()
  const r = t.review
  const { accounts, loading, selectedId } = useAccounts()
  const [params, setParams] = useSearchParams()
  const current = currentPeriodKey('week', Date.now(), localTzOffsetMin())
  const asked = params.get('week')
  const key = asked && parsePeriod('week', asked) ? asked : current
  const [view, setView] = useState<WeeklyReviewView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const chosen = useMemo(() => (selectedId === null ? accounts : accounts.filter((a) => a.id === selectedId)), [accounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixed = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixed

  const load = useCallback(async () => {
    const tz = localTzOffsetMin()
    try {
      const next = await api.getWeeklyReview({ accountIds, periodKey: key, nowMs: Date.now(), tzOffsetMin: tz, boundaryOffsets: boundaryOffsets('week', key, tz) })
      setView(next)
      setError(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(r.loadError(String(e instanceof Error ? e.message : e).replace(/^invalid input: /, '')))
    }
  }, [accountIds, key, r])

  useEffect(() => {
    if (!ready) return
    setView(null)
    void load()
  }, [ready, load])

  const goTo = (week: string) => setParams(week === current ? {} : { week })
  const title = periodTitle(t.processGoals, 'week', key)
  const state: ReviewState = view?.review?.state ?? 'todo'
  const look = stateLook(state)
  const periodState = view?.period.state

  return (
    <div className="flex flex-col gap-5" data-testid="review-page">
      <PageHeader title={r.title} subtitle={r.subtitle} />
      <p className="max-w-[80ch] text-sm text-tx2">{r.intro}</p>

      {!loading && accounts.length === 0 && (
        <section className="glass-card">
          <EmptyState icon="review" title={r.noAccountTitle}>{r.noAccountText}</EmptyState>
        </section>
      )}
      {mixed && <div className="nt nt-warn" role="status">{r.mixedCurrencies}</div>}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}

      {ready && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={r.week.previous} disabled={!view} onClick={() => view && goTo(view.period.previousKey)}>
              <Icon name="left" size={16} />
            </button>
            <div className="min-w-[230px] text-center" aria-live="polite">
              <p className="text-[17px] font-semibold">{title.title}</p>
              {title.range && <p className="text-xs text-tx3">{title.range}</p>}
            </div>
            <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={r.week.next} disabled={!view} onClick={() => view && goTo(view.period.nextKey)}>
              <Icon name="right" size={16} />
            </button>
            {periodState && <span className="badge badge-neutral">{r.week.periodState[periodState]}</span>}
            {view && (
              <span className={`badge badge-icon ${look.badge}`} data-review-state={state}>
                <Icon name={look.icon} size={13} /> {r.states[state]}
              </span>
            )}
            {key !== current && <button type="button" className="btn-link" onClick={() => goTo(current)}>{r.week.current}</button>}
          </div>
          {!view && !error && <p className="text-sm text-tx3">{r.loading}</p>}
        </>
      )}

      {ready && view && (
        <>
          <p className="-mt-2 text-xs text-tx3">{r.stateHelp[state]}</p>
          {view.period.state === 'future' && <div className="nt nt-warn" role="status">{r.futureWeek}</div>}
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <FactsCard view={view} />
            <div className="flex flex-col gap-5">
              <LastWeekCard last={view.lastWeek} streak={view.streak} onChanged={() => void load()} />
              {view.period.state !== 'future' && <ReviewForm periodKey={key} review={view.review} onChanged={() => void load()} />}
            </div>
          </div>
          <HistoryCard currentKey={key} refreshKey={version} />
        </>
      )}
    </div>
  )
}
