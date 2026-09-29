import { useT } from '../../i18n'
import { formatR, formatRatioPercent, formatSignedMoney } from '../../lib/format'
import { formatScore } from '../../lib/behaviorFormat'
import type { FirstTradeReport, PlanReport, RankGroup } from '../../types/behavior'
import type { Summary } from '../../types/stats'
import { Card, CompareBlock, EmptyLine, Note, toneOfDecimal, toneOfNumber } from './parts'

function summaryLines(s: Summary, currency: string, winRateLabel: (v: string) => string, extra?: string): string[] {
  const money = s.tradeCount === 0 ? '—' : formatSignedMoney(s.netPnl, currency)
  return [`${winRateLabel(formatRatioPercent(s.winRate, 0))} · ${money}`, ...(extra ? [extra] : [])]
}

export function PlanCard({ report, currency }: { report: PlanReport; currency: string }) {
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
