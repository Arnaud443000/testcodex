import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { Notice } from '../ui'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { ideaSections } from '../../lib/analysisView'
import { notifyReviewChanged } from '../../lib/reviewEvents'
import { useReferenceData } from '../../lib/referenceData'
import { useLocalDay } from '../../lib/useLocalDay'
import type { IdeaInput, IdeaView, ReviewQueue } from '../../types/analysis'
import { IdeaCard } from './IdeaCard'
import { IdeaForm } from './IdeaForm'

/**
 * Onglet « Idées » : la revue du matin (5 idées d'abord, « Voir les N autres »), les idées actives, les reportées
 * (visibles, avec leur jour de retour). Les idées clôturées sont dans les Archives.
 */
export function IdeasTab({ initialInstrumentId = null, openNew = false }: { initialInstrumentId?: number | null; openNew?: boolean }) {
  const t = useT()
  const a = t.analysis.ideas
  const { tz } = useLocalDay()
  const ref = useReferenceData()
  const [ideas, setIdeas] = useState<IdeaView[] | null>(null)
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(openNew)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const [list, q] = await Promise.all([api.listIdeas('active', null, tz), api.getReviewQueue(tz)])
      setIdeas(list)
      setQueue(q)
      setError(null)
    } catch (e) {
      setError(t.analysis.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [tz, t])
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <Notice level="bad">{error}</Notice>
  if (!ideas || !queue || ref.loading) return <p className="text-sm text-tx3" role="status">…</p>

  const reviewIds = new Set(queue.items.map((v) => v.id))
  const sections = ideaSections(ideas, reviewIds)
  const visibleReview = showAll ? queue.items : queue.items.slice(0, queue.visible)
  const create = async (input: IdeaInput) => {
    await api.createIdea(input)
    setCreating(false)
    notifyReviewChanged()
    await load()
  }
  const card = (v: IdeaView, emphasis = false) => <IdeaCard key={v.id} idea={v} tz={tz} instruments={ref.instruments} emphasis={emphasis} onChanged={load} />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-sm text-tx2">{a.newIntro}</p>
        {!creating && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> {a.newButton}
          </button>
        )}
      </div>

      {creating && (
        <section className="glass-card p-6" aria-labelledby="new-idea-title">
          <h2 id="new-idea-title" className="mb-4 text-lg font-semibold">{a.newTitle}</h2>
          <IdeaForm instruments={ref.instruments} initialInstrumentId={initialInstrumentId} onSubmit={create} onCancel={() => setCreating(false)} />
        </section>
      )}

      {queue.items.length > 0 && (
        <section aria-labelledby="review-title" className="flex flex-col gap-3">
          <div>
            <h2 id="review-title" className="text-base font-semibold">{a.reviewTitle(queue.items.length)}</h2>
            <p className="text-[13px] text-tx3">{a.reviewIntro}</p>
          </div>
          <ul className="flex flex-col gap-3">{visibleReview.map((v) => card(v, true))}</ul>
          {queue.hidden > 0 && (
            <button type="button" className="btn-link self-start" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? a.seeLess : a.seeMore(queue.hidden)}
            </button>
          )}
        </section>
      )}

      {sections.active.length > 0 && (
        <section aria-labelledby="active-title" className="flex flex-col gap-3">
          <h2 id="active-title" className="text-base font-semibold">{a.sections.active}</h2>
          <ul className="flex flex-col gap-3">{sections.active.map((v) => card(v))}</ul>
        </section>
      )}

      {sections.snoozed.length > 0 && (
        <section aria-labelledby="snoozed-title" className="flex flex-col gap-3">
          <h2 id="snoozed-title" className="text-base font-semibold">{a.sections.snoozed}</h2>
          <ul className="flex flex-col gap-3">{sections.snoozed.map((v) => card(v))}</ul>
        </section>
      )}

      {ideas.length === 0 && !creating && (
        <div className="glass-card">
          <EmptyState icon="analysis" title={a.emptyTitle} action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>{a.newButton}</button>}>
            {a.emptyText}
          </EmptyState>
        </div>
      )}
      {queue.items.length === 0 && ideas.length > 0 && <p className="text-[13px] text-tx3">{a.reviewDone}</p>}
    </div>
  )
}
