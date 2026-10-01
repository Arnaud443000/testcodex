import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { InsightCard } from '../components/insights/InsightCard'
import { PageHeader } from '../components/PageHeader'
import { Segmented } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useInsights } from '../lib/insights'
import { groupInsights, isNewInsight, MIN_TRADES_FOR_INSIGHTS, readSeenAt } from '../lib/insightsView'
import { localTzOffsetMin } from '../lib/period'
import type { Insight, InsightRecord } from '../types/insights'

type View = 'active' | 'dismissed' | 'history'
const HISTORY_LIMIT = 200

/**
 * Page « Insights » (cahier 3.5.1 à 3.5.3) : ce que le moteur du lot 19 met en avant. Suit le compte de la barre du
 * haut, pas la période (fenêtres fixes : 20 derniers trades, 90 jours). Trois vues : actifs, masqués, historique.
 */
export function InsightsPage() {
  const t = useT()
  const x = t.insights
  const { accounts, allAccounts, loading: accountsLoading, selectedId } = useAccounts()
  const { insights, error, dismiss, markSeen } = useInsights()
  const [view, setView] = useState<View>('active')
  const [dismissError, setDismissError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Ce qui était « nouveau » à l'arrivée sur la page le reste pendant la visite.
  const seenBefore = useRef(readSeenAt()).current
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const accountName = (id: number) => (accounts.length > 1 ? (allAccounts.find((a) => a.id === id)?.name ?? null) : null)

  useEffect(() => {
    if (insights) markSeen()
  }, [insights, markSeen])

  const [dismissed, setDismissed] = useState<Insight[] | null>(null)
  const [history, setHistory] = useState<InsightRecord[] | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  // Incrémenté après un masquage : recharge la vue « masqués » ou « historique » si elle est ouverte.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (view === 'active') return
    let live = true
    setViewError(null)
    if (view === 'dismissed') {
      setDismissed(null)
      api.getInsights(accountIds, localTzOffsetMin(), true).then(
        (l) => live && setDismissed(l.filter((i) => i.dismissedAt !== null)),
        (e) => live && setViewError(String(e instanceof Error ? e.message : e)),
      )
    } else {
      setHistory(null)
      api.getInsightHistory(accountIds, HISTORY_LIMIT).then(
        (l) => live && setHistory(l),
        (e) => live && setViewError(String(e instanceof Error ? e.message : e)),
      )
    }
    return () => {
      live = false
    }
  }, [view, accountIds, version])

  // undefined = pas encore lu ; null = lecture impossible (on retombe sur « rien à signaler »).
  const [tradeCount, setTradeCount] = useState<number | null | undefined>(undefined)
  const noneActive = insights !== null && insights.length === 0
  useEffect(() => {
    if (!noneActive) return
    let live = true
    api
      .getDashboard({ accountIds, period: 'all', nowMs: Date.now(), tzOffsetMin: localTzOffsetMin() })
      .then((d) => live && setTradeCount(d.report.summary.tradeCount))
      .catch(() => live && setTradeCount(null))
    return () => {
      live = false
    }
  }, [noneActive, accountIds])

  const accountLabel = selectedId === null ? x.allAccounts : (allAccounts.find((a) => a.id === selectedId)?.name ?? x.allAccounts)
  const header = <PageHeader title={x.title} subtitle={x.subtitle(accountLabel)} />

  if (accountsLoading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={x.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{x.createAccount}</Link>}>
            {x.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }

  async function onDismiss(id: string) {
    setDismissError(null)
    setBusyId(id)
    try {
      await dismiss(id)
      setVersion((v) => v + 1)
    } catch (e) {
      setDismissError(x.dismissError(String(e instanceof Error ? e.message : e)))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-[420px] max-w-full">
          <Segmented<View>
            value={view}
            label={x.viewsLabel}
            onChange={(v) => v && setView(v)}
            options={[
              { value: 'active', label: x.views.active },
              { value: 'dismissed', label: x.views.dismissed },
              { value: 'history', label: x.views.history },
            ]}
          />
        </div>
        <p className="max-w-[70ch] text-xs leading-relaxed text-tx3">{x.windowsNote} {x.localNote}</p>
      </div>

      {dismissError && <div className="nt nt-bad" role="alert">{dismissError}</div>}

      {view === 'active' && (
        <>
          {error && <div className="nt nt-bad" role="alert">{x.loadError(error)}</div>}
          {!error && insights === null && <p className="px-1 text-sm text-tx2">{x.loading}</p>}
          {insights !== null && insights.length === 0 && tradeCount !== undefined && <NoInsights tradeCount={tradeCount} />}
          {insights !== null &&
            groupInsights(insights).map((g) => (
              <section key={g.category} aria-labelledby={`insights-${g.category}`} className="flex flex-col gap-3" data-testid={`group-${g.category}`}>
                <h2 id={`insights-${g.category}`} className="px-1 text-base font-semibold">
                  {x.groups[g.category]} <span className="ml-1 text-sm font-normal text-tx3">{g.items.length}</span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {g.items.map((i) => (
                    <InsightCard key={i.id} insight={i} accountName={accountName(i.accountId)} isNew={isNewInsight(i, seenBefore)} onDismiss={onDismiss} busy={busyId === i.id} />
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}

      {view === 'dismissed' && (
        <>
          <p className="px-1 text-xs text-tx3">{x.dismissedHint}</p>
          {viewError && <div className="nt nt-bad" role="alert">{x.loadError(viewError)}</div>}
          {!viewError && dismissed === null && <p className="px-1 text-sm text-tx2">{x.loading}</p>}
          {dismissed !== null && dismissed.length === 0 && (
            <section className="glass-card"><EmptyState title={x.dismissedEmptyTitle}>{x.dismissedEmptyText}</EmptyState></section>
          )}
          {dismissed !== null && dismissed.length > 0 && (
            <ul className="flex flex-col gap-3" data-testid="dismissed-list">
              {dismissed.map((i) => (
                <InsightCard key={i.id} insight={i} accountName={accountName(i.accountId)} meta={i.dismissedAt !== null ? x.dismissedOn(formatDateTime(i.dismissedAt)) : null} />
              ))}
            </ul>
          )}
        </>
      )}

      {view === 'history' && (
        <>
          <p className="px-1 text-xs text-tx3">{x.historyHint(HISTORY_LIMIT)}</p>
          {viewError && <div className="nt nt-bad" role="alert">{x.loadError(viewError)}</div>}
          {!viewError && history === null && <p className="px-1 text-sm text-tx2">{x.loading}</p>}
          {history !== null && history.length === 0 && (
            <section className="glass-card"><EmptyState title={x.historyEmptyTitle}>{x.historyEmptyText}</EmptyState></section>
          )}
          {history !== null && history.length > 0 && (
            <ul className="flex flex-col gap-3" data-testid="history-list">
              {history.map((r) => (
                <InsightCard
                  key={r.insightId}
                  insight={r.insight}
                  accountName={accountName(r.accountId)}
                  meta={`${x.firstSeen(formatDateTime(r.firstSeenAt))}, ${x.lastSeen(formatDateTime(r.lastSeenAt))} · ${r.dismissedAt === null ? x.stateActive : x.dismissedOn(formatDateTime(r.dismissedAt))}`}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** Deux états vides distincts : « trop tôt pour le dire » et « rien à signaler ». */
function NoInsights({ tradeCount }: { tradeCount: number | null }) {
  const x = useT().insights
  if (tradeCount !== null && tradeCount < MIN_TRADES_FOR_INSIGHTS) {
    return (
      <section className="glass-card" data-testid="insights-not-enough">
        <EmptyState title={x.notEnoughTitle} action={<Link to="/trades/new" className="btn btn-primary">{x.notEnoughLink}</Link>}>
          {x.notEnoughText(tradeCount, MIN_TRADES_FOR_INSIGHTS)}
        </EmptyState>
      </section>
    )
  }
  return (
    <section className="glass-card" data-testid="insights-nothing">
      <EmptyState title={x.emptyTitle}>{x.empty} {x.emptyHint}</EmptyState>
    </section>
  )
}
