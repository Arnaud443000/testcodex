import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { Tooltip } from '../ui/Tooltip'
import { Link } from 'react-router-dom'
import { DisciplineCard } from '../behavior/DisciplineCard'
import { EmotionsCard, type Moment } from '../behavior/EmotionsCard'
import { FactorsCard } from '../behavior/FactorsCard'
import { HesitationCard } from '../behavior/HesitationCard'
import { InsightsWidgetCard } from '../insights/InsightsWidgetCard'
import { MistakesCard } from '../behavior/MistakesCard'
import { FirstTradeCard, PlanCard } from '../behavior/PlanCard'
import { RulesCard } from '../behavior/RulesCard'
import { HeatmapCard, LongShortCard, RDistributionCard, RiskCard } from '../behavior/StatsCards'
import { StreaksCard } from '../behavior/StreaksCard'
import { ImportanceMark, SimulationBadge } from '../news/ImportanceMark'
import { countdown, widgetImportances } from '../../lib/newsView'
import { OutcomeBadge, Pnl } from '../ui'
import { CalendarCard, CapitalCard, DailyCard, HeroCard, KPI_MODES, KpiCard, type KpiMode } from './DashboardCards'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { currentMonth, formatActual, formatTarget } from '../../lib/goalFormat'
import { formatDateTime, formatNumber, formatR } from '../../lib/format'
import { dayKey } from '../../lib/journalPeriod'
import { ENGINE_PERIOD } from '../../lib/period'
import { sortTrades } from '../../lib/tradeList'
import { statsQueryOf, type Scope } from '../../lib/widgetScope'
import { useCached, type Loaded } from '../../lib/widgetData'
import type { WidgetInstance } from '../../types/dashboardLayout'
import type { Dashboard, StatsQuery } from '../../types/stats'

/**
 * La bibliothèque de widgets (cahier 3.8.3). Un widget ne calcule rien : il choisit une commande qui existe déjà
 * (`get_dashboard`, `get_discipline`…), lui donne sa période et son compte, et affiche le rapport avec les cartes
 * de l'application. Chaque widget a son état vide : pas de trade, devises mélangées, compte disparu, erreur.
 */

export interface WidgetProps {
  scope: Scope
  instance: WidgetInstance
}

// --- États communs ------------------------------------------------------------------------------

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass-card flex h-full flex-col overflow-auto p-6">
      <h3 className="mb-3 whitespace-nowrap text-base font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Message({ title, tone, children, action }: { title: string; tone?: 'bad'; children?: ReactNode; action?: ReactNode }) {
  return (
    <Frame title={title}>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center" role={tone === 'bad' ? 'alert' : 'status'}>
        {children && <p className={`max-w-[40ch] text-sm leading-relaxed ${tone === 'bad' ? 'text-[#F5A198]' : 'text-tx2'}`}>{children}</p>}
        {action}
      </div>
    </Frame>
  )
}

/** Les garde-fous communs à tout widget lié à des comptes ; renvoie l'état vide à afficher, ou `null` si on peut charger. */
function useGate(scope: Scope, title: string): ReactNode {
  const t = useT().dashboardBuilder
  if (scope.accountMissing) return <Message title={title}>{t.accountGone}</Message>
  if (scope.mixed) return <Message title={title}>{t.mixedCurrencies}</Message>
  return null
}

function useDashboardData(scope: Scope, enabled: boolean): Loaded<Dashboard> {
  const query = { accountIds: scope.accountIds, period: ENGINE_PERIOD[scope.period], nowMs: scope.nowMs, tzOffsetMin: scope.tzOffsetMin }
  return useCached(enabled ? `dashboard|${JSON.stringify(query)}` : null, () => api.getDashboard(query))
}

function useTitle(kind: string): string {
  return useT().dashboardBuilder.widgets[kind]?.title ?? kind
}

function Pending({ title }: { title: string }) {
  const t = useT().dashboardBuilder
  return (
    <Frame title={title}>
      <p className="py-6 text-center text-sm text-tx3">{t.loading}</p>
    </Frame>
  )
}

function Failed({ title, detail }: { title: string; detail: string }) {
  return <Message title={title} tone="bad">{useT().dashboardBuilder.loadError(detail)}</Message>
}

// --- Widgets fondés sur get_dashboard (l'ancien tableau de bord) -------------------------------

function OnDashboard({ scope, kind, children }: { scope: Scope; kind: string; children: (data: Dashboard) => ReactNode }) {
  const title = useTitle(kind)
  const gate = useGate(scope, title)
  const { data, error } = useDashboardData(scope, gate === null)
  if (gate) return gate
  if (error) return <Failed title={title} detail={error} />
  if (!data) return <Pending title={title} />
  return <>{children(data)}</>
}

const NetPnlEquity = ({ scope }: WidgetProps) => <OnDashboard scope={scope} kind="net_pnl_equity">{(d) => <HeroCard data={d} period={scope.period} />}</OnDashboard>
const Capital = ({ scope }: WidgetProps) => <OnDashboard scope={scope} kind="capital">{(d) => <CapitalCard data={d} />}</OnDashboard>
const DailyResults = ({ scope }: WidgetProps) => <OnDashboard scope={scope} kind="daily_results">{(d) => <DailyCard data={d} />}</OnDashboard>
const Kpi = ({ scope, instance }: WidgetProps) => {
  const mode: KpiMode = KPI_MODES.includes(instance.mode as KpiMode) ? (instance.mode as KpiMode) : 'win_rate'
  return <OnDashboard scope={scope} kind="kpi">{(d) => <KpiCard mode={mode} data={d} />}</OnDashboard>
}

function CalendarWidget({ scope }: WidgetProps) {
  const title = useTitle('calendar')
  const gate = useGate(scope, title)
  const now = new Date(scope.nowMs)
  const query = { accountIds: scope.accountIds, year: now.getFullYear(), month: now.getMonth() + 1, tzOffsetMin: scope.tzOffsetMin }
  const { data, error } = useCached(gate === null ? `calendar|${JSON.stringify(query)}` : null, () => api.getCalendar(query))
  if (gate) return gate
  if (error) return <Failed title={title} detail={error} />
  if (!data) return <Pending title={title} />
  return <CalendarCard month={data} />
}

// --- Widgets fondés sur un rapport de statistiques ---------------------------------------------

/**
 * Charge un rapport pour la période et le compte du widget. Sans aucun trade clôturé sur la période, le widget
 * affiche son état vide au lieu d'un rapport de zéros.
 */
function Report<T>({
  scope,
  kind,
  name,
  load,
  render,
}: {
  scope: Scope
  kind: string
  name: string
  load: (q: StatsQuery) => Promise<T>
  render: (data: T) => ReactNode
}) {
  const t = useT().dashboardBuilder
  const title = useTitle(kind)
  const gate = useGate(scope, title)
  const counted = useDashboardData(scope, gate === null)
  const hasTrades = (counted.data?.report.summary.tradeCount ?? 0) > 0
  const query = statsQueryOf(scope)
  const report = useCached(gate === null && hasTrades ? `${name}|${JSON.stringify(query)}` : null, () => load(query))
  if (gate) return gate
  if (counted.error) return <Failed title={title} detail={counted.error} />
  if (!counted.data) return <Pending title={title} />
  if (!hasTrades) return <Message title={title}>{`${t.noTradesOnPeriod} ${t.noTradesOnPeriodHint}`}</Message>
  if (report.error) return <Failed title={title} detail={report.error} />
  if (!report.data) return <Pending title={title} />
  return <>{render(report.data)}</>
}

const Discipline = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="discipline" name="discipline" load={api.getDiscipline} render={(r) => <DisciplineCard report={r} />} />
)
const EMOTION_MOMENTS: Moment[] = ['before', 'during', 'after', 'any']
const Emotions = ({ scope, instance }: WidgetProps) => {
  const moment = EMOTION_MOMENTS.includes(instance.mode as Moment) ? (instance.mode as Moment) : 'before'
  return (
    <Report scope={scope} kind="emotions" name="emotions" load={api.getEmotions} render={(r) => <EmotionsCard key={moment} report={r} currency={scope.currency} initialMoment={moment} />} />
  )
}
const Streaks = ({ scope }: WidgetProps) => (
  <Report
    scope={scope}
    kind="streaks"
    name="streaks+"
    load={async (q) => {
      const [streaks, afterLosses, sizeChange] = await Promise.all([api.getStreaks(q), api.getAfterLosses(q), api.getSizeChange(q)])
      return { streaks, afterLosses, sizeChange }
    }}
    render={(r) => <StreaksCard report={r.streaks} currency={scope.currency} afterLosses={r.afterLosses} sizeChange={r.sizeChange} />}
  />
)
const Plan = ({ scope }: WidgetProps) => (
  <Report
    scope={scope}
    kind="plan"
    name="plan+"
    load={async (q) => {
      const [plan, simulation] = await Promise.all([api.getPlanComparison(q), api.getPlanSimulation(q)])
      return { plan, simulation }
    }}
    render={(r) => <PlanCard report={r.plan} currency={scope.currency} simulation={r.simulation} />}
  />
)
const FirstTrade = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="first_trade" name="firstTrade" load={api.getFirstTrade} render={(r) => <FirstTradeCard report={r} currency={scope.currency} />} />
)
const Mistakes = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="mistakes" name="mistakes" load={api.getMistakes} render={(r) => <MistakesCard report={r} currency={scope.currency} />} />
)
const Rules = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="rules" name="ruleAdherence" load={api.getRuleAdherence} render={(r) => <RulesCard report={r} />} />
)
const Hesitation = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="hesitation" name="patterns" load={api.getPatterns} render={(r) => <HesitationCard report={r} />} />
)
const Factors = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="factors" name="factors" load={api.getExternalFactors} render={(r) => <FactorsCard report={r} currency={scope.currency} />} />
)
const RDistribution = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="r_distribution" name="rDistribution" load={api.getRDistribution} render={(r) => <RDistributionCard report={r} />} />
)
const Risk = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="risk" name="risk" load={api.getRisk} render={(r) => <RiskCard report={r} currency={scope.currency} />} />
)
const Heatmap = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="heatmap" name="heatmap" load={api.getHeatmap} render={(r) => <HeatmapCard report={r} currency={scope.currency} />} />
)
const LongShort = ({ scope }: WidgetProps) => (
  <Report scope={scope} kind="long_short" name="longShort" load={api.getLongShort} render={(r) => <LongShortCard report={r} currency={scope.currency} />} />
)

// --- Suivi : derniers trades, objectifs du mois ------------------------------------------------

function RecentTrades({ scope, instance }: WidgetProps) {
  const t = useT()
  const w = t.dashboardBuilder
  const title = useTitle('recent_trades')
  const gate = useGate(scope, title)
  const count = Math.max(1, Number(instance.mode ?? '5') || 5)
  const filter = scope.accountIds.length === 0 ? {} : { accountIds: scope.accountIds }
  const { data, error } = useCached(gate === null ? `trades|${JSON.stringify(filter)}` : null, () => api.listTrades(filter))
  const rows = useMemo(() => (data ? sortTrades(data, 'date', 'desc').slice(0, count) : []), [data, count])
  if (gate) return gate
  if (error) return <Failed title={title} detail={error} />
  if (!data) return <Pending title={title} />
  if (data.length === 0) {
    return (
      <Message title={title} action={<Link to="/trades/new" className="btn btn-primary btn-sm">{w.recent.emptyAction}</Link>}>
        {w.recent.empty}
      </Message>
    )
  }
  return (
    <section className="glass-card flex h-full flex-col overflow-auto p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="whitespace-nowrap text-base font-semibold">{title}</h3>
        <Link to="/trades" className="btn-link whitespace-nowrap">{w.recent.seeAll}</Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {[w.recent.columns.date, w.recent.columns.asset, w.recent.columns.direction, w.recent.columns.result, w.recent.columns.r, ''].map((c, i) => (
              <th key={i} scope="col" className={`caption pb-2 font-semibold ${i === 3 || i === 4 ? 'text-right' : 'text-left'}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((tr) => (
            <tr key={tr.id} className="h-10 border-t" style={{ borderColor: 'var(--hairline)' }}>
              <td className="whitespace-nowrap pr-3 text-tx2">{formatDateTime(tr.entryTime)}</td>
              <td className="pr-3 font-semibold">
                <Link to={`/trades/${tr.id}`} className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">{tr.symbol}</Link>
              </td>
              <td className={`pr-3 font-semibold ${tr.direction === 'long' ? 'text-gain' : 'text-loss'}`}>{t.common.directions[tr.direction]}</td>
              <td className="pr-3 text-right font-semibold tabular-nums">
                {tr.figures ? <Pnl value={tr.figures.netPnl} currency={tr.currency} /> : <span className="text-tx3">—</span>}
              </td>
              <td className="pr-3 text-right tabular-nums">{tr.figures ? formatR(tr.figures.rMultiple) : '—'}</td>
              <td className="text-right"><OutcomeBadge outcome={tr.figures?.outcome ?? 'open'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function GoalsWidget({ scope }: WidgetProps) {
  const t = useT()
  const g = t.goalsPage
  const w = t.dashboardBuilder
  const title = useTitle('goals')
  const gate = useGate(scope, title)
  const now = new Date(scope.nowMs)
  const month = currentMonth(now)
  const query = { accountIds: scope.accountIds, month, tzOffsetMin: scope.tzOffsetMin, today: dayKey(now) }
  const { data, error } = useCached(gate === null ? `goals|${JSON.stringify(query)}` : null, () => api.getGoalProgress(query))
  if (gate) return gate
  if (error) return <Failed title={title} detail={error} />
  if (!data) return <Pending title={title} />
  if (data.length === 0) {
    return (
      <Message title={title} action={<Link to="/goals" className="btn btn-secondary btn-sm">{w.goals.emptyAction}</Link>}>
        {w.goals.empty}
      </Message>
    )
  }
  return (
    <section className="glass-card flex h-full flex-col overflow-auto p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="whitespace-nowrap text-base font-semibold">{title}</h3>
        <Link to="/goals" className="btn-link whitespace-nowrap">{w.goals.manage}</Link>
      </div>
      <ul className="flex flex-col gap-4">
        {data.map((p) => {
          const label = g.metrics[p.goal.metric]
          const pct = p.fraction === null ? 0 : Math.min(100, p.fraction * 100)
          const bad = p.status === 'exceeded' || p.status === 'missed'
          const badge = p.status === 'reached' ? 'badge-gain' : bad ? 'badge-loss' : p.status === 'in_progress' ? 'badge-warn' : 'badge-neutral'
          const statusText = p.direction === 'at_most' && g.statusCeiling[p.status] ? g.statusCeiling[p.status] : g.status[p.status]
          const currency = p.currency ?? scope.currency
          return (
            <li key={p.goal.id} className="flex flex-col gap-1.5" aria-label={label}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{label}</span>
                <span className={`badge ${badge}`}>{statusText}</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-5 text-[13px] text-tx2">
                <span>{p.direction === 'at_most' ? g.ceiling : w.goals.target} : <b className="text-tx tabular-nums">{formatTarget(p.goal.metric, p.goal.target, currency)}</b></span>
                <span>{w.goals.actual} : <b className="text-tx tabular-nums">{formatActual(p, currency)}</b></span>
              </div>
              <div
                role="progressbar"
                aria-label={g.progress(label, p.fraction === null ? '—' : `${formatNumber(p.fraction * 100, 0)} %`)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                className="h-2 overflow-hidden rounded-full"
                style={{ background: 'rgba(255,255,255,.12)' }}
              >
                <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: bad ? '#F0776B' : 'var(--grad)' }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Insights (lot 19 bis) : fenêtres fixes du moteur, donc ni période ni « rien sur cette période ». Le widget suit le
 * compte ; les devises mélangées ne le concernent pas (chaque compte est évalué seul, chaque insight porte sa devise).
 */
function InsightsWidget({ scope }: WidgetProps) {
  const t = useT().dashboardBuilder
  const title = useTitle('insights')
  const { data, error } = useCached(scope.accountMissing ? null : `insights|${JSON.stringify(scope.accountIds)}|${scope.tzOffsetMin}`, () =>
    api.getInsights(scope.accountIds, scope.tzOffsetMin),
  )
  if (scope.accountMissing) return <Message title={title}>{t.accountGone}</Message>
  if (error) return <Failed title={title} detail={error} />
  if (!data) return <Pending title={title} />
  return <InsightsWidgetCard title={title} insights={data} />
}

/** Correspondance `kind` → composant. La bibliothèque de pulse-core décide de ce qui peut être enregistré. */
export const WIDGET_COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  net_pnl_equity: NetPnlEquity,
  capital: Capital,
  kpi: Kpi,
  daily_results: DailyResults,
  calendar: CalendarWidget,
  heatmap: Heatmap,
  r_distribution: RDistribution,
  risk: Risk,
  long_short: LongShort,
  recent_trades: RecentTrades,
  goals: GoalsWidget,
  discipline: Discipline,
  emotions: Emotions,
  streaks: Streaks,
  plan: Plan,
  first_trade: FirstTrade,
  mistakes: Mistakes,
  rules: Rules,
  hesitation: Hesitation,
  factors: Factors,
  insights: InsightsWidget,
  upcoming_news: UpcomingNewsWidget,
}

/**
 * Prochaines news (lot 25) : ni compte ni période ; le mode choisit l'importance. Heures de Paris fournies par
 * pulse-core ; seul le temps restant est recompté chaque minute pour l'affichage.
 */
function UpcomingNewsWidget({ instance }: WidgetProps) {
  const t = useT()
  const n = t.news
  const title = useTitle('upcoming_news')
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const importances = widgetImportances(instance.mode)
  const minute = Math.floor(tick / 60_000)
  const status = useCached(`news-status|${minute}`, () => api.getNewsStatus())
  const upcoming = useCached(status.data?.settings.enabled ? `news-upcoming|${importances.join(',')}|${minute}` : null, () => api.getUpcomingNews(4, importances))
  if (status.error) return <Failed title={title} detail={status.error} />
  if (!status.data) return <Pending title={title} />
  if (!status.data.settings.enabled) {
    return (
      <Message title={title} action={<Link to="/settings#news" className="btn btn-secondary btn-sm">{n.widget.enable}</Link>}>
        {n.widget.disabled}
      </Message>
    )
  }
  if (upcoming.error) return <Failed title={title} detail={upcoming.error} />
  if (!upcoming.data) return <Pending title={title} />
  const events = upcoming.data
  return (
    <Frame title={title}>
      {events.length === 0 ? (
        <p className="py-4 text-sm text-tx2">{n.widget.none}</p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--hairline)' }}>
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="w-[44px] shrink-0 self-start pt-px tabular-nums text-tx2">{e.parisTime ?? n.allDay}</span>
              <span className="min-w-0 flex-1">
                <Tooltip content={e.title}>
                  <span className="block truncate font-medium">{e.title}</span>
                </Tooltip>
                <span className="block truncate text-xs text-tx3">
                  <Tooltip content={e.currency ? undefined : n.noCurrencyHint}>
                    <span className="font-semibold text-tx2">{e.currency || n.noCurrency}</span>
                  </Tooltip>
                  {' · '}
                  {countdown(e, tick, n)}
                </span>
              </span>
              <ImportanceMark importance={e.importance} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-tx3">
        <span>{n.widget.parisShort}</span>
        {events.some((e) => e.source === 'simulation') && <SimulationBadge />}
        <Link to="/calendar/news" className="shrink-0 font-semibold text-[#B7AEF5] hover:underline">{n.widget.seeAll}</Link>
      </div>
    </Frame>
  )
}
