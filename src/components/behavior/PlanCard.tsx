import { useT } from '../../i18n'
import { formatR, formatRatioPercent, formatSignedMoney } from '../../lib/format'
import { formatMoney } from '../../lib/format'
import { formatMoneyGap } from '../../lib/behaviorFormat'
import { signOf } from '../../lib/decimal'
import { formatScore } from '../../lib/behaviorFormat'
import type { FirstTradeReport, PlanReport, PlanSimulation, RankGroup, Scenario, SimulatedResult } from '../../types/behavior'
import type { Summary } from '../../types/stats'
import { Card, CompareBlock, EmptyLine, Note, toneOfDecimal, toneOfNumber } from './parts'

function summaryLines(s: Summary, currency: string, winRateLabel: (v: string) => string, extra?: string): string[] {
  const money = s.tradeCount === 0 ? '—' : formatSignedMoney(s.netPnl, currency)
  return [`${winRateLabel(formatRatioPercent(s.winRate, 0))} · ${money}`, ...(extra ? [extra] : [])]
}

export function PlanCard({ report, currency, simulation }: { report: PlanReport; currency: string; simulation?: PlanSimulation }) {
  const t = useT()
  const p = t.behavior.plan
  const by = (key: string) => report.groups.find((g) => g.key === key)
  const yes = by('yes')
  const no = by('no')
  const others = ['partial', 'none'].map((k) => by(k)).filter((g): g is NonNullable<typeof g> => !!g && g.summary.tradeCount > 0)
  const block = (label: string, g: typeof yes) =>
    !g || g.summary.tradeCount === 0 ? (
      <CompareBlock label={label} value="—" tone="text-tx2" lines={[t.behavior.trades(0), p.empty]} />
    ) : (
      <CompareBlock
        label={label}
        value={formatR(g.summary.expectancyR, 2)}
        tone={toneOfNumber(g.summary.expectancyR)}
        lines={[t.behavior.trades(g.summary.tradeCount), ...summaryLines(g.summary, currency, t.behavior.winRate)]}
      />
    )
  return (
    <Card title={p.title} span="xl:col-span-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {block(p.yes, yes)}
        {block(p.no, no)}
      </div>
      <p className="mt-2 text-xs text-tx3">{p.expectancyNote}</p>
      {others.length > 0 && (
        <div className="mt-3">
          <div className="caption mb-1">{p.others}</div>
          {others.map((g) => (
            <div key={g.key} className="hairline-row text-[13px]">
              <span className="text-tx2">
                {g.key === 'partial' ? p.partial : p.none} · {t.behavior.trades(g.summary.tradeCount)}
              </span>
              <span className="tabular-nums">
                <span className={toneOfNumber(g.summary.expectancyR)}>{formatR(g.summary.expectancyR, 2)}</span>
                <span className={`ml-2 ${toneOfDecimal(g.summary.netPnl)}`}>{formatSignedMoney(g.summary.netPnl, currency)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      <Note>{p.unknownNote}</Note>
      {simulation && <SimulationBlock simulation={simulation} currency={currency} />}
    </Card>
  )
}

function rankBlock(label: string, g: RankGroup, currency: string, t: ReturnType<typeof useT>) {
  const s = g.summary
  if (s.tradeCount === 0) return <CompareBlock label={label} value="—" tone="text-tx2" lines={[t.behavior.trades(0), t.behavior.firstTrade.empty]} />
  return (
    <CompareBlock
      label={label}
      value={formatR(s.expectancyR, 2)}
      tone={toneOfNumber(s.expectancyR)}
      lines={[t.behavior.trades(s.tradeCount), ...summaryLines(s, currency, t.behavior.winRate, t.behavior.firstTrade.discipline(formatScore(g.disciplineScore)))]}
    />
  )
}

export function FirstTradeCard({ report, currency }: { report: FirstTradeReport; currency: string }) {
  const t = useT()
  const f = t.behavior.firstTrade
  const ranks = report.byRank.filter((r) => r.summary.tradeCount > 0)
  return (
    <Card title={f.title} span="xl:col-span-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rankBlock(f.first, report.first, currency, t)}
        {rankBlock(f.subsequent, report.subsequent, currency, t)}
      </div>
      {ranks.length > 0 ? (
        <div className="mt-4">
          <div className="caption mb-1">{f.byRank}</div>
          {ranks.map((r) => (
            <div key={r.key} className="hairline-row text-[13px]">
              <span className="text-tx2">
                {f.rank[r.key] ?? r.label} · {t.behavior.trades(r.summary.tradeCount)}
              </span>
              <span className="tabular-nums">
                <span className={toneOfNumber(r.summary.expectancyR)}>{formatR(r.summary.expectancyR, 2)}</span>
                <span className={`ml-2 ${toneOfDecimal(r.summary.netPnl)}`}>{formatSignedMoney(r.summary.netPnl, currency)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>{f.empty}</EmptyLine>
      )}
    </Card>
  )
}

/** Phrase de tête de la simulation : le chiffre de la maquette, toujours présenté comme une simulation. */
function simulationHeadline(sim: PlanSimulation, currency: string, s: ReturnType<typeof useT>['behavior']['simulation']): string {
  const sc = sim.withoutOffPlan
  if (sc.difference === null) return s.noPlan
  if (sc.excludedTradeCount === 0) return s.noOffPlan
  const sign = signOf(sc.difference)
  if (sign > 0) return s.gain(formatMoney(sc.difference, currency), sc.excludedTradeCount)
  if (sign < 0) return s.loss(formatMoneyGap(sc.difference, currency), sc.excludedTradeCount)
  return s.even
}

function SimulationBlock({ simulation, currency }: { simulation: PlanSimulation; currency: string }) {
  const s = useT().behavior.simulation
  const rows: { label: string; result: SimulatedResult; scenario?: Scenario }[] = [
    { label: s.actual, result: simulation.actual },
    { label: s.withoutOffPlan, result: simulation.withoutOffPlan.result, scenario: simulation.withoutOffPlan },
    { label: s.withoutOffPlanOrPartial, result: simulation.withoutOffPlanOrPartial.result, scenario: simulation.withoutOffPlanOrPartial },
  ]
  const usable = simulation.withoutOffPlan.difference !== null
  return (
    <div className="mt-4 rounded-inner border p-4" style={{ borderColor: 'rgba(217,168,90,.45)', background: 'rgba(217,168,90,.08)' }} role="note" aria-label={s.title}>
      <div className="flex items-center gap-2">
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn" style={{ borderColor: 'rgba(217,168,90,.6)' }}>{s.badge}</span>
        <span className="text-sm font-semibold">{s.title}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{simulationHeadline(simulation, currency, s)}</p>
      {usable && (
        // Une ligne par scénario, qui se replie proprement : la carte ne fait qu'un tiers de la page et un tableau à
        // quatre colonnes y écrivait un mot par ligne (audit du lot 26).
        <ul className="mt-3 flex flex-col text-xs tabular-nums">
          {rows.map((r) => (
            <li key={r.label} className="border-t py-2.5" style={{ borderColor: 'var(--hairline)' }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[13px] font-medium text-tx">{r.label}</span>
                {r.scenario && <span className="text-tx3">{s.removed(r.scenario.excludedTradeCount)}</span>}
              </div>
              <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                <div className="flex gap-1.5">
                  <dt className="text-tx3">{s.trades}</dt>
                  <dd>{r.result.tradeCount}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-tx3">{s.netPnl}</dt>
                  <dd className={toneOfDecimal(r.result.netPnl)}>{r.result.tradeCount === 0 ? '—' : formatSignedMoney(r.result.netPnl, currency)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-tx3">{s.expectancy}</dt>
                  <dd className={toneOfNumber(r.result.expectancyR)}>{formatR(r.result.expectancyR, 2)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-tx3">{s.drawdown}</dt>
                  <dd>{r.result.tradeCount === 0 ? '—' : formatMoney(r.result.maxDrawdown, currency)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-tx3">{s.disclaimer}</p>
    </div>
  )
}
