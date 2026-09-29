import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AssetsPanel } from '../components/analyses/AssetsPanel'
import { ExecutionPanel } from '../components/analyses/ExecutionPanel'
import { FeesPanel } from '../components/analyses/FeesPanel'
import { StrategiesPanel } from '../components/analyses/StrategiesPanel'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Segmented } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { localTzOffsetMin, periodRange, usePeriod } from '../lib/period'
import type { AssetRow, ExecutionReport, FeeGranularity, FeeReport, StatsQuery, StrategyRow } from '../types/stats'

type Tab = 'assets' | 'fees' | 'strategies' | 'execution'

/** Page « Analyses » (étape 3) : quatre analyses de pulse-core, sans aucun calcul ici (on formate, on trie, on dessine). */
export function AnalysesPage() {
  const t = useT()
  const a = t.analyses
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const [tab, setTab] = useState<Tab>('assets')
  const [granularity, setGranularity] = useState<FeeGranularity>('month')
  const [data, setData] = useState<{ assets: AssetRow[]; strategies: StrategyRow[]; execution: ExecutionReport } | null>(null)
  const [fees, setFees] = useState<FeeReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((x) => x.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((x) => x.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixedCurrencies
  const query = useMemo<StatsQuery>(() => ({ accountIds, ...periodRange(period, Date.now(), localTzOffsetMin()) }), [accountIds, period])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setData(null)
    Promise.all([api.getAssetReport(query), api.getStrategyReport(query), api.getExecutionReport(query)])
      .then(([assets, strategies, execution]) => {
        if (cancelled) return
        setData({ assets, strategies, execution })
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, query])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setFees(null)
    api
      .getFeeReport(query, granularity)
      .then((r) => !cancelled && setFees(r))
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, query, granularity])

  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.pages.analytics.title} subtitle={a.subtitle(t.behavior.periodLabels[period])} />
      {body}
    </div>
  )
  const card = (body: React.ReactNode) => <section className="glass-card">{body}</section>

  if (loading) return wrap(null)
  if (chosen.length === 0) {
    return wrap(
      card(
        <EmptyState title={a.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{a.createAccount}</Link>}>
          {a.noAccountText}
        </EmptyState>,
      ),
    )
  }
  if (mixedCurrencies) return wrap(card(<EmptyState title={a.mixedTitle}>{a.mixedText}</EmptyState>))
  if (error) return wrap(<div className="nt nt-bad" role="alert">{a.loadError(error)}</div>)
  if (!data) return wrap(<p className="px-1 text-sm text-tx2">{t.common.loading}</p>)
  if (data.assets.length === 0) {
    return wrap(
      card(
        <EmptyState title={a.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{a.addTrade}</Link>}>
          {a.noTradesText}
        </EmptyState>,
      ),
    )
  }

  const currency = chosen[0].currency
  return wrap(
    <>
      <div className="max-w-[980px]">
        <Segmented<Tab>
          value={tab}
          label={a.tabsLabel}
          onChange={(v) => v && setTab(v)}
          options={[
            { value: 'assets', label: a.tabs.assets },
            { value: 'fees', label: a.tabs.fees },
            { value: 'strategies', label: a.tabs.strategies },
            { value: 'execution', label: a.tabs.execution },
          ]}
        />
      </div>
      {tab === 'assets' && <AssetsPanel rows={data.assets} currency={currency} />}
      {tab === 'fees' && (fees ? <FeesPanel report={fees} currency={currency} granularity={granularity} onGranularity={setGranularity} /> : <p className="px-1 text-sm text-tx2">{t.common.loading}</p>)}
      {tab === 'strategies' && <StrategiesPanel rows={data.strategies} currency={currency} />}
      {tab === 'execution' && <ExecutionPanel report={data.execution} currency={currency} />}
    </>,
  )
}
