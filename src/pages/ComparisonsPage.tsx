import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AccountsPanel } from '../components/comparisons/AccountsPanel'
import { ExposurePanel } from '../components/comparisons/ExposurePanel'
import { RiskPanel } from '../components/comparisons/RiskPanel'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Segmented } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { toggleSelection } from '../lib/comparisonsView'
import { localTzOffsetMin, periodRange, usePeriod } from '../lib/period'
import type { AccountComparison, ExposureReport, RiskBenchmark, StatsQuery } from '../types/stats'

type Tab = 'accounts' | 'risk' | 'exposure'

/**
 * Page « Comparaisons » (lot 17) : comptes côte à côte, benchmark du risque max, exposition par catégorie d'actif.
 * Aucun calcul ici : on choisit, on formate, on dessine. La période vient de la barre du haut ; l'onglet « Comptes »
 * a son propre choix de comptes (les autres onglets suivent le compte de la barre du haut et refusent de mélanger deux devises).
 */
export function ComparisonsPage() {
  const t = useT()
  const c = t.comparisons
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const [tab, setTab] = useState<Tab>('accounts')
  const [picked, setPicked] = useState<number[] | null>(null)
  const [comparison, setComparison] = useState<AccountComparison | null>(null)
  const [risk, setRisk] = useState<RiskBenchmark | null>(null)
  const [exposure, setExposure] = useState<ExposureReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => periodRange(period, Date.now(), localTzOffsetMin()), [period])
  // Comptes comparés : tous les comptes actifs tant que l'utilisateur n'a rien coché.
  const selected = useMemo(() => picked ?? accounts.map((a) => a.id), [picked, accounts])
  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((x) => x.id === selectedId)), [accounts, allAccounts, selectedId])
  const mixedCurrencies = chosen.some((x) => x.currency !== chosen[0].currency)
  const singleQuery = useMemo<StatsQuery>(() => ({ accountIds: selectedId === null ? [] : [selectedId], ...range }), [selectedId, range])

  useEffect(() => {
    if (loading || tab !== 'accounts' || selected.length < 2) return
    let live = true
    setComparison(null)
    api
      .getAccountComparison({ accountIds: selected, ...range })
      .then((r) => live && (setComparison(r), setError(null)))
      .catch((e) => live && setError(String(e instanceof Error ? e.message : e)))
    return () => {
      live = false
    }
  }, [loading, tab, selected, range])

  useEffect(() => {
    if (loading || tab === 'accounts' || chosen.length === 0 || mixedCurrencies) return
    let live = true
    setRisk(null)
    setExposure(null)
    const load = tab === 'risk' ? api.getRiskBenchmark(singleQuery).then((r) => live && setRisk(r)) : api.getExposureReport(singleQuery).then((r) => live && setExposure(r))
    load.then(() => live && setError(null)).catch((e) => live && setError(String(e instanceof Error ? e.message : e)))
    return () => {
      live = false
    }
  }, [loading, tab, singleQuery, chosen.length, mixedCurrencies])

  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-5">
      <PageHeader title={c.title} subtitle={c.subtitle(t.behavior.periodLabels[period])} />
      {body}
    </div>
  )
  const card = (body: React.ReactNode) => <section className="glass-card">{body}</section>

  if (loading) return wrap(null)
  if (accounts.length === 0) {
    return wrap(
      card(
        <EmptyState title={c.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{c.createAccount}</Link>}>
          {c.noAccountText}
        </EmptyState>,
      ),
    )
  }

  const currency = chosen[0]?.currency ?? 'USD'
  let body: React.ReactNode
  if (error) body = <div className="nt nt-bad" role="alert">{c.loadError(error)}</div>
  else if (tab === 'accounts') {
    body = <AccountsPanel candidates={accounts} selected={selected} onToggle={(id) => setPicked(toggleSelection(selected, id))} comparison={comparison} />
  } else if (mixedCurrencies) {
    body = card(<EmptyState title={c.mixedTitle}>{c.mixedText}</EmptyState>)
  } else if (tab === 'risk') {
    body = risk ? <RiskPanel report={risk} currency={currency} /> : <p className="px-1 text-sm text-tx2">{t.common.loading}</p>
  } else {
    body = exposure ? <ExposurePanel report={exposure} currency={currency} /> : <p className="px-1 text-sm text-tx2">{t.common.loading}</p>
  }

  return wrap(
    <>
      <div className="max-w-[720px]">
        <Segmented<Tab>
          value={tab}
          label={c.tabsLabel}
          onChange={(v) => v && setTab(v)}
          options={[
            { value: 'accounts', label: c.tabs.accounts },
            { value: 'risk', label: c.tabs.risk },
            { value: 'exposure', label: c.tabs.exposure },
          ]}
        />
      </div>
      {body}
    </>,
  )
}
