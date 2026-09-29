import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ExecutionScoreLine } from '../components/ExecutionScoreLine'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ChipButton, OutcomeBadge, Pnl, QualityBar, StarRating } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDateTime, formatDuration, formatR } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import type { Level, ReplayCard, ReplayFilter, ReplayItem, ReplayOutcome } from '../types/replay'

type RatingMode = 'all' | 'review' | 'good' | 'none'

interface Filters {
  rating: RatingMode
  outcome: ReplayOutcome | null
  instrumentId: number | null
  withScreenshot: boolean
  withNotes: boolean
}

const NO_FILTERS: Filters = { rating: 'all', outcome: null, instrumentId: null, withScreenshot: false, withNotes: false }

/** « À revoir » = 1 à 2 étoiles, « bonnes » = 4 à 5 (cahier 3.7.4 : filtre par la notation manuelle). */
function toQuery(f: Filters, accountIds: number[]): ReplayFilter {
  return {
    accountIds,
    maxRating: f.rating === 'review' ? 2 : null,
    minRating: f.rating === 'good' ? 4 : null,
    unratedOnly: f.rating === 'none',
    outcome: f.outcome,
    instrumentId: f.instrumentId,
    withScreenshot: f.withScreenshot,
    withNotes: f.withNotes,
  }
}

/** Les niveaux du trade, du plus haut au plus bas ; la petite piste montre où chacun se situe entre le plus bas et le plus haut. */
function Ladder({ levels }: { levels: Level[] }) {
  const t = useT()
  const r = t.replay
  const prices = levels.map((l) => Number(l.price))
  const min = Math.min(...prices)
  const span = Math.max(...prices) - min || 1
  const tone = (l: Level) => (l.kind === 'planned_sl' || l.kind === 'actual_sl' ? 'text-loss' : l.kind === 'planned_tp' || l.kind === 'actual_tp' ? 'text-gain' : l.kind === 'entry' ? 'text-tx-accent' : 'text-tx')
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col">
        {levels.map((l) => (
          <li key={l.kind} className="hairline-row !gap-3" aria-label={`${r.levels[l.kind]} ${l.price}`}>
            <span className={`w-[150px] shrink-0 font-medium ${tone(l)}`}>{r.levels[l.kind]}</span>
            <span className="w-[100px] shrink-0 tabular-nums">{l.price}</span>
            <span className="relative h-1.5 flex-1 rounded-full" style={{ background: 'rgba(255,255,255,.1)' }} aria-hidden="true">
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${((Number(l.price) - min) / span) * 100}%`, background: l.kind === 'entry' ? 'var(--grad)' : 'rgba(255,255,255,.7)' }}
              />
            </span>
            <span className="w-[70px] shrink-0 text-right font-semibold tabular-nums">{formatR(l.r)}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-tx3">{r.ladderNote}</p>
      {levels.every((l) => l.r === null) && <p className="text-xs text-warn">{r.ladderNoStop}</p>}
    </div>
  )
}

export function ReplayPage() {
  const t = useT()
  const r = t.replay
  const { accounts, loading, selectedId } = useAccounts()
  const ref = useReferenceData()
  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [items, setItems] = useState<ReplayItem[] | null>(null)
  const [selected, setSelected] = useState<number | null>(params.get('trade') ? Number(params.get('trade')) : null)
  const [card, setCard] = useState<ReplayCard | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])

  useEffect(() => {
    if (loading || accounts.length === 0) return
    let live = true
    api
      .listReplay(toQuery(filters, accountIds))
      .then((l) => {
        if (!live) return
        setItems(l)
        setError(null)
        // La sélection reste valable tant que le trade passe les filtres ; sinon on prend le premier.
        setSelected((cur) => (cur !== null && l.some((x) => x.tradeId === cur) ? cur : (l[0]?.tradeId ?? null)))
      })
      .catch((e) => live && setError(r.loadError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [filters, accountIds, loading, accounts.length, r])

  useEffect(() => {
    if (selected === null) {
      setCard(null)
      return
    }
    let live = true
    api
      .getReplayCard(selected)
      .then((c) => live && setCard(c))
      .catch((e) => live && setError(r.cardError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [selected, r])

  useEffect(() => {
    let live = true
    setScreenshot(null)
    if (card?.trade.screenshotPath) {
      api
        .readScreenshot(card.trade.screenshotPath)
        .then((u) => live && setScreenshot(u))
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [card?.trade.screenshotPath])

  const index = items && selected !== null ? items.findIndex((x) => x.tradeId === selected) : -1
  const go = (delta: number) => {
    if (!items || index < 0) return
    const next = items[index + delta]
    if (next) {
      setSelected(next.tradeId)
      setParams({ trade: String(next.tradeId) }, { replace: true })
    }
  }

  // Flèches du clavier (sauf pendant une saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowLeft') go(1) // liste du plus récent au plus ancien : « précédent » = plus ancien à gauche
      if (e.key === 'ArrowRight') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tagName = (id: number) => ref.allTags.find((g) => g.id === id)?.name ?? '—'
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)

  const header = <PageHeader title={r.title} subtitle={r.subtitle} />
  if (loading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {r.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }

  const trade = card?.trade
  const f = trade?.figures ?? null
  const emotions = trade ? (['before', 'during', 'after'] as const).flatMap((m) => trade.emotions.filter((e) => e.moment === m)) : []
  const mistakes = trade ? trade.tagIds.filter((id) => ref.allTags.find((g) => g.id === id)?.kind === 'mistake') : []

  return (
    <div className="flex flex-col gap-5">
      {header}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}

      <section className="glass-card flex flex-wrap items-end gap-x-6 gap-y-4 px-6 py-[18px]" aria-label={r.filters.rating}>
        <div className="flex flex-col gap-1.5">
          <span className="caption">{r.filters.rating}</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['all', r.filters.ratingAll],
                ['review', r.filters.ratingReview],
                ['good', r.filters.ratingGood],
                ['none', r.filters.ratingNone],
              ] as [RatingMode, string][]
            ).map(([mode, label]) => (
              <ChipButton key={mode} on={filters.rating === mode} onClick={() => set('rating', mode)}>{label}</ChipButton>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="caption">{r.filters.result}</span>
          <select className="input !w-auto" value={filters.outcome ?? ''} onChange={(e) => set('outcome', (e.target.value || null) as ReplayOutcome | null)}>
            <option value="" className="bg-bg">{r.filters.all}</option>
            {Object.entries(r.outcomes).map(([k, l]) => (
              <option key={k} value={k} className="bg-bg">{l}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="caption">{r.filters.asset}</span>
          <select className="input !w-auto" value={filters.instrumentId ?? ''} onChange={(e) => set('instrumentId', e.target.value ? Number(e.target.value) : null)}>
            <option value="" className="bg-bg">{r.filters.all}</option>
            {ref.instruments.map((i) => (
              <option key={i.id} value={i.id} className="bg-bg">{i.symbol}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-violet" checked={filters.withScreenshot} onChange={(e) => set('withScreenshot', e.target.checked)} />
          {r.filters.withScreenshot}
        </label>
        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-violet" checked={filters.withNotes} onChange={(e) => set('withNotes', e.target.checked)} />
          {r.filters.withNotes}
        </label>
        {filtered && (
          <button type="button" className="btn-link pb-2.5" onClick={() => setFilters(NO_FILTERS)}>{r.filters.reset}</button>
        )}
      </section>

      {items !== null && items.length === 0 ? (
        <section className="glass-card">
          <EmptyState title={filtered ? r.noMatchTitle : r.emptyTitle}>{filtered ? r.noMatchText : r.emptyText}</EmptyState>
        </section>
      ) : (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-5">
          <section className="glass-card flex max-h-[calc(100vh-260px)] flex-col overflow-hidden" aria-label={r.count(items?.length ?? 0)}>
            <p className="caption px-5 pb-2 pt-4">{r.count(items?.length ?? 0)}</p>
            <ul className="flex-1 overflow-y-auto px-2 pb-2">
              {(items ?? []).map((x) => {
                const on = x.tradeId === selected
                return (
                  <li key={x.tradeId}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => {
                        setSelected(x.tradeId)
                        setParams({ trade: String(x.tradeId) }, { replace: true })
                      }}
                      className={`flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left transition hover:bg-white/5 ${on ? 'bg-white/10' : ''}`}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-semibold">{x.symbol} <span className="text-xs font-normal text-tx3">{t.common.directions[x.direction]}</span></span>
                        {x.netPnl !== null ? <Pnl value={x.netPnl} currency={x.currency} className="text-[13px] font-semibold" /> : <OutcomeBadge outcome="open" />}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-xs text-tx3">
                        <span>{formatDateTime(x.entryTime)}</span>
                        <span className="flex items-center gap-2">
                          {x.rating !== null && <span aria-label={t.form.star(x.rating)} className="text-warn">{'★'.repeat(x.rating)}</span>}
                          {x.hasScreenshot && <span title={r.chartTitle}>▣</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {trade && card ? (
            <div className="flex min-w-0 flex-col gap-5">
              <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="replay-trade">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id="replay-trade" className="text-[20px] font-semibold">
                      {trade.symbol} <span className="text-sm font-normal text-tx2">{t.common.directions[trade.direction]}</span>
                    </h2>
                    <p className="text-xs text-tx3">
                      {formatDateTime(trade.entryTime)} · {trade.accountName}
                      {trade.durationMs !== null && ` · ${r.duration} ${formatDuration(trade.durationMs)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="mr-2 text-xs text-tx3">{index >= 0 && items ? r.position(index + 1, items.length) : ''}</span>
                    <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2 disabled:opacity-40" aria-label={r.previous} disabled={!items || index >= items.length - 1} onClick={() => go(1)}>
                      <Icon name="left" size={16} />
                    </button>
                    <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2 disabled:opacity-40" aria-label={r.next} disabled={index <= 0} onClick={() => go(-1)}>
                      <Icon name="right" size={16} />
                    </button>
                    <Link to={`/trades/${trade.id}`} className="btn btn-secondary btn-sm">{r.openTrade}</Link>
                    <Link to={`/trades/${trade.id}/edit`} className="btn btn-secondary btn-sm">{r.editTrade}</Link>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                  {f ? (
                    <>
                      <p className="text-sm text-tx2">{r.result} : <Pnl value={f.netPnl} currency={trade.currency} className="text-[20px] font-semibold" /></p>
                      <p className="text-sm text-tx2">R : <strong className="text-[17px] text-tx">{formatR(f.rMultiple)}</strong></p>
                      <OutcomeBadge outcome={f.outcome} />
                    </>
                  ) : (
                    <OutcomeBadge outcome="open" />
                  )}
                </div>
                <p className="text-xs text-tx3">{r.keyboardHint}</p>
              </section>

              <div className="grid grid-cols-2 gap-5">
                <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="replay-chart">
                  <h2 id="replay-chart" className="text-[15px] font-semibold">{r.chartTitle}</h2>
                  {screenshot ? (
                    <img src={screenshot} alt={t.form.screenshot.alt} className="block max-h-[320px] w-full rounded-inner border object-contain" style={{ borderColor: 'var(--hairline)' }} />
                  ) : (
                    <p className="flex flex-col items-start gap-2 text-sm text-tx3">
                      {r.noScreenshot}
                      <Link to={`/trades/${trade.id}/edit`} className="btn-link">{r.addScreenshot}</Link>
                    </p>
                  )}
                </section>
                <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="replay-ladder">
                  <h2 id="replay-ladder" className="text-[15px] font-semibold">{r.ladderTitle}</h2>
                  <Ladder levels={card.levels} />
                </section>
              </div>

              <div className="grid grid-cols-2 gap-5">
                {[
                  { id: 'thesis', title: r.thesis, text: trade.thesis, empty: r.thesisEmpty },
                  { id: 'post', title: r.postMortem, text: trade.postMortem, empty: r.postMortemEmpty },
                ].map((b) => (
                  <section key={b.id} className="glass-card flex flex-col gap-2.5 px-6 py-[22px]" aria-labelledby={`replay-${b.id}`}>
                    <h2 id={`replay-${b.id}`} className="caption">{b.title}</h2>
                    {b.text.trim() ? (
                      <p className="whitespace-pre-wrap text-sm leading-[1.6]">{b.text}</p>
                    ) : (
                      <p className="flex items-center justify-between gap-3 text-sm text-tx3">
                        {b.empty} <Link to={`/trades/${trade.id}/edit`} className="btn-link">{r.write}</Link>
                      </p>
                    )}
                  </section>
                ))}
              </div>

              <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="replay-process">
                <h2 id="replay-process" className="text-[15px] font-semibold">{r.processTitle}</h2>
                <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="caption">{r.rating}</span>
                    {trade.rating ? <StarRating label={r.rating} value={trade.rating} /> : <span className="text-sm text-tx3">{t.common.unset}</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="caption">{r.execution}</span>
                    {trade.executionQuality ? <QualityBar label={r.execution} value={trade.executionQuality} /> : <span className="text-sm text-tx3">{t.common.unset}</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="caption">{r.conviction}</span>
                    <span className="text-sm">{trade.conviction ? `${trade.conviction} / 10` : <span className="text-tx3">{t.common.unset}</span>}</span>
                  </div>
                  <ExecutionScoreLine tradeId={trade.id} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="caption">{r.emotions}</span>
                  {emotions.length === 0 ? (
                    <span className="text-sm text-tx3">{r.noEmotions}</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {emotions.map((e) => (
                        <span key={`${e.moment}-${e.tagId}`} className="chip chip-on chip-static">
                          <span className="mr-1.5 text-[11px] uppercase text-tx2">{t.common.moments[e.moment]}</span>
                          {tagName(e.tagId)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {mistakes.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="caption">{r.mistakes}</span>
                    <div className="flex flex-wrap gap-2">
                      {mistakes.map((m) => (
                        <span key={m} className="chip chip-bad chip-static">{tagName(m)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  )
}
