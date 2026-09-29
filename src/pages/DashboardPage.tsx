import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReadOnlyGrid } from '../components/dashboard/DashboardGrid'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { ENGINE_PERIOD, localTzOffsetMin, usePeriod } from '../lib/period'
import { clearWidgetCache } from '../lib/widgetData'
import type { ScopeEnv } from '../lib/widgetScope'
import type { DashboardLayout } from '../types/dashboardLayout'

export function DashboardPage() {
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const t = useT()
  const [layout, setLayout] = useState<DashboardLayout | null>(null)
  const [hasTrades, setHasTrades] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Instant de référence figé à l'ouverture : tous les widgets envoient exactement les mêmes requêtes.
  const [nowMs] = useState(() => {
    clearWidgetCache()
    return Date.now()
  })
  const tzOffsetMin = useMemo(() => localTzOffsetMin(), [])

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0

  useEffect(() => {
    let live = true
    api
      .getStartupDashboard()
      .then((l) => live && setLayout(l))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [])

  // Aucun trade du tout (toutes périodes) : bienvenue plutôt qu'une grille de widgets vides.
  useEffect(() => {
    if (!ready || mixedCurrencies) return
    let live = true
    api
      .getDashboard({ accountIds, period: ENGINE_PERIOD.ALL, nowMs, tzOffsetMin })
      .then((d) => live && setHasTrades(d.report.summary.tradeCount > 0 || d.report.openTradeCount > 0))
      .catch(() => live && setHasTrades(true))
    return () => {
      live = false
    }
  }, [ready, mixedCurrencies, accountIds, nowMs, tzOffsetMin])

  const env: ScopeEnv = useMemo(
    () => ({ accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin }),
    [accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin],
  )

  const header = <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />
  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-5">
      {header}
      {body}
    </div>
  )

  if (loading) return wrap(null)
  if (chosen.length === 0) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.welcomeTitle} action={<Link to="/settings" className="btn btn-primary">{t.dashboard.createFirstAccount}</Link>}>
          {t.dashboard.welcomeText}
        </EmptyState>
      </section>,
    )
  }
  if (mixedCurrencies) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.mixedCurrenciesTitle}>{t.dashboard.mixedCurrenciesText}</EmptyState>
      </section>,
    )
  }
  if (error) return wrap(<div className="nt nt-bad" role="alert">{t.dashboardBuilder.toolbar.loadError(error)}</div>)
  if (!layout || hasTrades === null) return wrap(null)
  if (!hasTrades) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{t.dashboard.addFirstTrade}</Link>}>
          {t.dashboard.noTradesText}
        </EmptyState>
      </section>,
    )
  }
  return wrap(<ReadOnlyGrid items={layout.widgets} env={env} />)
}
