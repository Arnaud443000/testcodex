import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DisciplineCard } from '../components/behavior/DisciplineCard'
import { EmotionsCard } from '../components/behavior/EmotionsCard'
import { MistakesCard } from '../components/behavior/MistakesCard'
import { FirstTradeCard, PlanCard } from '../components/behavior/PlanCard'
import { HeatmapCard, LongShortCard, RDistributionCard, RiskCard } from '../components/behavior/StatsCards'
import { StreaksCard } from '../components/behavior/StreaksCard'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { buildAlerts, type BehaviorAlert } from '../lib/behaviorAlerts'
import { formatSignedMoney } from '../lib/format'
import { localTzOffsetMin, periodRange, usePeriod } from '../lib/period'
import type { Heatmap, LongShort, RDistribution, RiskReport } from '../types/stats'
import type { DisciplineReport, EmotionReport, FirstTradeReport, MistakeReport, PatternReport, PlanReport, StreakReport } from '../types/behavior'

/** Tout ce que la page affiche, chargé d'un bloc : une seule requête par rapport, aucun calcul ici. */
interface Data {
  discipline: DisciplineReport
  emotions: EmotionReport
  streaks: StreakReport
  plan: PlanReport
  firstTrade: FirstTradeReport
  mistakes: MistakeReport
  patterns: PatternReport
  rDistribution: RDistribution
  heatmap: Heatmap
  longShort: LongShort
  risk: RiskReport
  alerts: BehaviorAlert[]
}

export function BehaviorPage() {
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const t = useT()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixedCurrencies

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setData(null)
    const now = Date.now()
    const tzOffsetMin = localTzOffsetMin()
    const query = { accountIds, ...periodRange(period, now, tzOffsetMin) }
    Promise.all([
      api.getDiscipline(query),
      api.getEmotions(query),
      api.getStreaks(query),
      api.getPlanComparison(query),
      api.getFirstTrade(query),
      api.getMistakes(query),
      api.getPatterns(query),
      api.getRDistribution(query),
      api.getHeatmap(query),
      api.getLongShort(query),
      api.getRisk(query),
    ])
      .then(([discipline, emotions, streaks, plan, firstTrade, mistakes, patterns, rDistribution, heatmap, longShort, risk]) => {
        if (cancelled) return
        setData({ discipline, emotions, streaks, plan, firstTrade, mistakes, patterns, rDistribution, heatmap, longShort, risk, alerts: buildAlerts(patterns, now, tzOffsetMin) })
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ready, accountIds, period])

  const b = t.behavior
  const header = <PageHeader title={t.pages.behavior.title} subtitle={b.subtitle(b.periodLabels[period])} />
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
        <EmptyState title={b.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{b.createAccount}</Link>}>
          {b.noAccountText}
        </EmptyState>
      </section>,
    )
  }
  if (mixedCurrencies) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={b.mixedTitle}>{b.mixedText}</EmptyState>
      </section>,
    )
  }
  if (error) return wrap(<div className="nt nt-bad" role="alert">{b.loadError(error)}</div>)
  if (!data) return wrap(null)

  const currency = chosen[0].currency
  if (data.streaks.tradeCount === 0) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={b.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{b.addTrade}</Link>}>
          {b.noTradesText}
        </EmptyState>
      </section>,
    )
  }

  return wrap(
    <>
      <Alerts data={data} currency={currency} />
      <div className="grid grid-cols-12 gap-6">
        <DisciplineCard report={data.discipline} currency={currency} />
        <EmotionsCard report={data.emotions} currency={currency} />
        <StreaksCard report={data.streaks} currency={currency} />
        <PlanCard report={data.plan} currency={currency} />
        <FirstTradeCard report={data.firstTrade} currency={currency} />
        <MistakesCard report={data.mistakes} currency={currency} />
        <RDistributionCard report={data.rDistribution} />
        <RiskCard report={data.risk} currency={currency} />
        <HeatmapCard report={data.heatmap} currency={currency} />
        <LongShortCard report={data.longShort} currency={currency} />
      </div>
    </>,
  )
}

/** Bandeau d'alerte comportementale : un message par schéma détecté par pulse-core. */
function Alerts({ data, currency }: { data: Data; currency: string }) {
  const a = useT().behavior.alerts
  if (data.alerts.length === 0) return null
  const text = (al: BehaviorAlert): string => {
    if (al.key === 'overtrading') return al.level === 'critical' ? a.overtradingToday(al.count, al.limit ?? 0) : a.overtrading(al.count, al.limit ?? 0)
    return al.level === 'critical' ? a.revengeToday(al.count) : a.revenge(al.count, formatSignedMoney(data.patterns.revengeSummary.netPnl, currency))
  }
  return (
    <div className="flex flex-col gap-2" role="region" aria-label={a.title}>
      {data.alerts.map((al) => (
        <div key={al.key} className={`nt ${al.level === 'critical' ? 'nt-bad' : 'nt-warn'} !px-[18px] !py-[15px] !text-sm`} role="alert">
          <b aria-hidden="true">!</b>
          <span>
            <b>{a.title}</b> — {text(al)}
          </span>
        </div>
      ))}
    </div>
  )
}
