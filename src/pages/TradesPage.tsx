import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { OutcomeBadge, Pnl } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDateTime, formatDuration, formatR } from '../lib/format'
import { MISTAKE_PARAM, parseMistakeParam } from '../lib/mistakeFilter'
import { useReferenceData } from '../lib/referenceData'
import { NO_FILTERS, applyFilters, hasActiveFilters, isIncomplete, sortTrades, tagOfKind, type ListFilters, type SortDir, type SortKey } from '../lib/tradeList'
import type { Outcome, TradeView } from '../types/trade'

export function TradesPage() {
  const t = useT()
  const navigate = useNavigate()
  const { accounts, loading: accountsLoading, selectedId } = useAccounts()
  const ref = useReferenceData()
  const [trades, setTrades] = useState<TradeView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS)
  const [params, setParams] = useSearchParams()
  const mistake = useMemo(() => parseMistakeParam(params.get(MISTAKE_PARAM)), [params])
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })

  useEffect(() => {
    let live = true
    setTrades(null)
    api
      .listTrades({ ...(selectedId === null ? {} : { accountIds: [selectedId] }), mistake })
      .then((l) => live && setTrades(l))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [selectedId, mistake])

  const visible = useMemo(() => (trades ? sortTrades(applyFilters(trades, filters), sort.key, sort.dir) : []), [trades, filters, sort])

  const header = (
    <PageHeader
      title={t.pages.trades.title}
      subtitle={t.pages.trades.subtitle}
      actions={
        accounts.length > 0 && (
          <>
            <Link to="/trades/new?mode=quick" className="btn btn-secondary">
              {t.trades.quickAdd}
            </Link>
            <Link to="/trades/new" className="btn btn-primary">
              <Icon name="plus" size={18} /> {t.trades.newTrade}
            </Link>
          </>
        )
      }
    />
  )

  if (accountsLoading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {t.common.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="nt nt-bad" role="alert">{t.trades.loadError(error)}</div>
      </div>
    )
  }

  const setSortKey = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'symbol' || key === 'direction' ? 'asc' : 'desc' }))

  const cols: { key: SortKey | null; label: string; align?: 'right' }[] = [
    { key: 'date', label: t.trades.columns.date },
    { key: 'symbol', label: t.trades.columns.symbol },
    { key: 'direction', label: t.trades.columns.direction },
    { key: null, label: t.trades.columns.setup },
    { key: null, label: t.trades.columns.session },
    { key: null, label: t.trades.columns.size, align: 'right' },
    { key: 'pnl', label: t.trades.columns.pnl, align: 'right' },
    { key: 'r', label: t.trades.columns.r, align: 'right' },
    { key: 'duration', label: t.trades.columns.duration, align: 'right' },
    { key: null, label: t.trades.columns.status },
  ]

  return (
    <div className="flex flex-col gap-5">
      {header}
      {mistake && (
        <div className="nt nt-warn items-center justify-between" role="status">
          <span>
            <strong>
              {mistake.source === 'tag'
                ? t.trades.mistakeFilter.tag(ref.allTags.find((g) => g.id === mistake.id)?.name ?? t.trades.mistakeFilter.unknown)
                : t.trades.mistakeFilter.rule(ref.allRules.find((r) => r.id === mistake.id)?.text ?? t.trades.mistakeFilter.unknown)}
            </strong>{' '}
            — {t.trades.mistakeFilter.allPeriods}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete(MISTAKE_PARAM); return n })}
          >
            {t.trades.mistakeFilter.remove}
          </button>
        </div>
      )}
      <section className="glass-card overflow-hidden">
        {trades === null ? (
          <p className="px-6 py-10 text-center text-sm text-tx2">{t.common.loading}</p>
        ) : trades.length === 0 ? (
          <EmptyState
            title={t.trades.emptyTitle}
            action={<Link to="/trades/new" className="btn btn-primary">{t.trades.emptyAction}</Link>}
          >
            {t.trades.emptyText}
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 px-6 pt-5">
              <FilterSelect
                label={t.trades.filters.asset}
                allLabel={t.trades.filters.all}
                value={filters.instrumentId}
                options={ref.instruments.map((i) => ({ value: i.id, label: i.symbol }))}
                onChange={(v) => setFilters((f) => ({ ...f, instrumentId: v }))}
              />
              <FilterSelect
                label={t.trades.filters.setup}
                allLabel={t.trades.filters.all}
                value={filters.setupTagId}
                options={ref.allTags.filter((g) => g.kind === 'setup').map((g) => ({ value: g.id, label: g.name }))}
                onChange={(v) => setFilters((f) => ({ ...f, setupTagId: v }))}
              />
              <FilterSelect
                label={t.trades.filters.session}
                allLabel={t.trades.filters.allF}
                value={filters.sessionTagId}
                options={ref.allTags.filter((g) => g.kind === 'session').map((g) => ({ value: g.id, label: g.name }))}
                onChange={(v) => setFilters((f) => ({ ...f, sessionTagId: v }))}
              />
              <label className="flex flex-col gap-1.5">
                <span className="caption">{t.trades.filters.result}</span>
                <span className="relative">
                  <select
                    className="input !h-[38px] min-w-[140px]"
                    value={filters.outcome ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, outcome: (e.target.value || null) as Outcome | 'open' | null }))}
                  >
                    <option value="" className="bg-bg">{t.trades.filters.all}</option>
                    {(['win', 'loss', 'breakeven', 'open'] as const).map((o) => (
                      <option key={o} value={o} className="bg-bg">{t.common.outcomes[o]}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
                </span>
              </label>
              {hasActiveFilters(filters) && (
                <button type="button" className="btn-link pb-2" onClick={() => setFilters(NO_FILTERS)}>
                  {t.trades.resetFilters}
                </button>
              )}
              <p className="ml-auto pb-2 text-sm text-tx2" aria-live="polite">{t.trades.count(visible.length, trades.length)}</p>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title={t.trades.noMatchTitle}
                action={<button type="button" className="btn btn-secondary" onClick={() => setFilters(NO_FILTERS)}>{t.trades.resetFilters}</button>}
              >
                {t.trades.noMatchText}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto px-3 pb-3 pt-2">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr>
                      {cols.map((c) => {
                        const active = c.key !== null && sort.key === c.key
                        return (
                          <th
                            key={c.label}
                            scope="col"
                            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                            className={`caption px-3 py-3 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                          >
                            {c.key ? (
                              <button
                                type="button"
                                title={t.trades.sortBy(c.label)}
                                onClick={() => setSortKey(c.key!)}
                                className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet ${active ? 'text-tx' : ''}`}
                              >
                                {c.label}
                                {active && <Icon name={sort.dir === 'asc' ? 'sortUp' : 'sortDown'} size={14} />}
                              </button>
                            ) : (
                              c.label
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((tr) => {
                      const setup = tagOfKind(tr, ref.allTags, 'setup')
                      const session = tagOfKind(tr, ref.allTags, 'session')
                      return (
                        <tr
                          key={tr.id}
                          onClick={() => navigate(`/trades/${tr.id}`)}
                          className="h-12 cursor-pointer border-t transition hover:bg-white/[0.04]"
                          style={{ borderColor: 'var(--hairline)' }}
                        >
                          <td className="whitespace-nowrap px-3 text-tx2">{formatDateTime(tr.entryTime)}</td>
                          <td className="px-3 font-semibold">
                            <Link to={`/trades/${tr.id}`} className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet" onClick={(e) => e.stopPropagation()}>
                              {tr.symbol}
                            </Link>
                          </td>
                          <td className={`px-3 font-semibold ${tr.direction === 'long' ? 'text-gain' : 'text-loss'}`}>{t.common.directions[tr.direction]}</td>
                          <td className="px-3 text-tx2">{setup?.name ?? '—'}</td>
                          <td className="px-3 text-tx2">{session?.name ?? '—'}</td>
                          <td className="px-3 text-right">{tr.size}</td>
                          <td className="px-3 text-right font-semibold">
                            {tr.figures ? <Pnl value={tr.figures.netPnl} currency={tr.currency} /> : <span className="text-tx3">—</span>}
                          </td>
                          <td className="px-3 text-right">{tr.figures ? formatR(tr.figures.rMultiple) : '—'}</td>
                          <td className="whitespace-nowrap px-3 text-right text-tx2">{formatDuration(tr.durationMs)}</td>
                          <td className="px-3">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <OutcomeBadge outcome={tr.figures?.outcome ?? 'open'} />
                              {isIncomplete(tr) && (
                                <span className="badge badge-warn" title={t.trades.incompleteHint}>{t.trades.incomplete}</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: number | null
  options: { value: number; label: string }[]
  onChange: (v: number | null) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="caption">{label}</span>
      <span className="relative">
        <select className="input !h-[38px] min-w-[140px]" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="" className="bg-bg">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-bg">{o.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
      </span>
    </label>
  )
}
