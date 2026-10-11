import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { SessionForm } from '../components/backtest/SessionForm'
import { Th } from '../components/analyses/parts'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { emptySessionDraft } from '../lib/backtestForm'
import { formatR, formatRatioPercent } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import type { BacktestListItem } from '../types/backtest'

const statusBadge = { running: 'badge-warn', validated: 'badge-gain', rejected: 'badge-loss' } as const

/** Liste des backtests : une ligne par stratégie, pour voir d'un coup d'œil ce qui marche ou non. */
export function BacktestPage() {
  const t = useT()
  const b = t.backtest
  const ref = useReferenceData()
  const navigate = useNavigate()
  const [list, setList] = useState<BacktestListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    api
      .listBacktests()
      .then((l) => {
        setList(l)
        setError(null)
      })
      .catch((e) => setError(b.loadError(String(e instanceof Error ? e.message : e))))
  }, [b])
  useEffect(load, [load])

  const setups = ref.tags.filter((tag) => tag.kind === 'setup')
  const header = (
    <PageHeader
      title={t.pages.backtest.title}
      subtitle={t.pages.backtest.subtitle}
      actions={
        !creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> {b.newSession}
          </button>
        )
      }
    />
  )

  return (
    <div className="flex flex-col gap-5">
      {header}
      <p className="max-w-[90ch] text-[13px] text-tx2">{b.intro}</p>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      {creating && (
        <SessionForm
          initial={emptySessionDraft()}
          setups={setups}
          submitLabel={b.session.create}
          onCancel={() => setCreating(false)}
          onSubmit={async (data) => {
            const created = await api.createBacktest(data)
            navigate(`/backtest/${created.id}`)
          }}
        />
      )}
      {list && list.length === 0 && !creating && (
        <section className="glass-card">
          <EmptyState title={b.list.emptyTitle} action={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>{b.newSession}</button>}>
            {b.list.emptyText}
          </EmptyState>
        </section>
      )}
      {list && list.length > 0 && (
        <section className="glass-card overflow-hidden" aria-label={t.pages.backtest.title}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr>
                  <Th label={b.list.columns.name} />
                  <Th label={b.list.columns.status} />
                  <Th label={b.list.columns.market} />
                  <Th label={b.list.columns.cases} align="right" />
                  <Th label={b.list.columns.validity} align="right" />
                  <Th label={b.list.columns.winRate} align="right" />
                  <Th label={b.list.columns.expectancy} align="right" />
                  <Th label={b.list.columns.total} align="right" />
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} onClick={() => navigate(`/backtest/${x.id}`)} className="h-[56px] cursor-pointer border-t transition hover:bg-white/[0.04]" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="px-3">
                      <Link to={`/backtest/${x.id}`} aria-label={b.list.open(x.name)} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                        {x.name}
                      </Link>
                      {x.overall.tradeCount > 0 && x.overall.lowSample && <span className="badge badge-warn ml-2">{b.report.lowSample}</span>}
                    </td>
                    <td className="px-3"><span className={`badge ${statusBadge[x.status]}`}>{b.status[x.status]}</span></td>
                    <td className="px-3 text-tx2">{b.detail.marketLine(x.asset, x.timeframe) || '—'}</td>
                    <td className="px-3 text-right tabular-nums">{x.caseCount}</td>
                    <td className="px-3 text-right tabular-nums">{formatRatioPercent(x.validityRate, 0)}</td>
                    <td className="px-3 text-right tabular-nums">{formatRatioPercent(x.overall.winRate, 0)}</td>
                    <td className="px-3 text-right tabular-nums">{formatR(x.overall.expectancyR, 2)}</td>
                    <td className="px-3 text-right font-semibold tabular-nums">{x.overall.tradeCount === 0 ? '—' : formatR(x.overall.totalR, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
