import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatFeeRounded, formatProfitFactor, setupLink, sortStrategies, toCurve, type SortDir, type StrategySortKey } from '../../lib/analysesView'
import { formatPnl, formatR, formatRatioPercent } from '../../lib/format'
import type { StrategyRow } from '../../types/stats'
import { Notice } from '../ui'
import { Legend, MultiLineChart, NEUTRAL_SERIES, SERIES_COLORS, type Series } from './AnalysisCharts'
import { LowSampleBadge, PnlRounded, Section, SortTh } from './parts'

/** Comparaison de stratégies en parallèle (3.3.16). Une stratégie = un tag « setup » ; « sans stratégie » = aucun setup. */
export function StrategiesPanel({ rows, currency }: { rows: StrategyRow[]; currency: string }) {
  const t = useT().analyses
  const s = t.strategies
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: StrategySortKey; dir: SortDir }>({ key: 'netPnl', dir: 'desc' })
  const sorted = useMemo(() => sortStrategies(rows, sort.key, sort.dir), [rows, sort])
  const onSort = (key: StrategySortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  const th = { active: sort.key, dir: sort.dir, onSort }
  const nameOf = (r: StrategyRow) => (r.tagId === null ? s.noneName : r.name)

  // Courbes : les stratégies les plus fournies en trades ; la couleur suit l'ordre donné par le moteur (gris pour « sans stratégie »).
  const MAX_LINES = SERIES_COLORS.length
  const drawn = new Set([...rows].sort((a, b) => b.summary.tradeCount - a.summary.tradeCount).slice(0, MAX_LINES))
  const named = rows.filter((r) => r.tagId !== null)
  const series: (Series & { row: StrategyRow })[] = rows
    .filter((r) => drawn.has(r))
    .map((r) => ({
      id: String(r.tagId ?? 'none'),
      label: nameOf(r),
      color: r.tagId === null ? NEUTRAL_SERIES : SERIES_COLORS[named.indexOf(r) % SERIES_COLORS.length],
      points: toCurve(r.curve, (p) => p.cumulativeNetPnl),
      row: r,
    }))

  const onlyUnclassified = rows.length === 1 && rows[0].tagId === null
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
      {onlyUnclassified ? (
        <Section title={s.noSetupTitle}>
          <p className="max-w-[70ch] text-sm leading-relaxed text-tx2">{s.noSetupText}</p>
        </Section>
      ) : (
        <>
          {rows.length === 1 && <Notice level="warn">{s.singleNote}</Notice>}
          <Section title={s.chartTitle} subtitle={s.chartSubtitle}>
            <MultiLineChart series={series} label={s.chartLabel} format={(v) => formatPnl(v, currency)} />
            <Legend
              items={series.map((x) => {
                const final = x.row.curve[x.row.curve.length - 1]?.cumulativeNetPnl
                return { id: x.id, color: x.color, text: s.finalValue(x.label, final === undefined ? '—' : formatPnl(Number(final), currency)) }
              })}
            />
            {rows.length > MAX_LINES && <p className="mt-2 text-xs text-tx3">{s.chartLimit(MAX_LINES)}</p>}
          </Section>
          <Section title={s.tableTitle} subtitle={s.tableHint}>
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr>
                    <SortTh sortKey="name" label={s.columns.name} {...th} />
                    <SortTh sortKey="trades" label={s.columns.trades} align="right" {...th} />
                    <SortTh sortKey="share" label={s.columns.share} align="right" {...th} />
                    <SortTh sortKey="winRate" label={s.columns.winRate} align="right" {...th} />
                    <SortTh sortKey="avgR" label={s.columns.avgR} align="right" {...th} />
                    <SortTh sortKey="profitFactor" label={s.columns.profitFactor} align="right" {...th} />
                    <SortTh sortKey="netPnl" label={s.columns.netPnl} align="right" {...th} />
                    <SortTh sortKey="maxDrawdown" label={s.columns.maxDrawdown} align="right" {...th} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const link = r.tagId === null ? null : setupLink(r.tagId)
                    return (
                      <tr
                        key={String(r.tagId ?? 'none')}
                        onClick={link ? () => navigate(link) : undefined}
                        className={`h-[52px] border-t transition ${link ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
                        style={{ borderColor: 'var(--hairline)' }}
                      >
                        <td className="px-3">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            {link ? (
                              <Link to={link} aria-label={s.open(nameOf(r))} onClick={(e) => e.stopPropagation()} className="font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                                {nameOf(r)}
                              </Link>
                            ) : (
                              <span className="font-semibold text-tx2">{nameOf(r)}</span>
                            )}
                            {r.lowSample && <LowSampleBadge />}
                          </div>
                        </td>
                        <td className="px-3 text-right tabular-nums">{r.summary.tradeCount}</td>
                        <td className="px-3 text-right tabular-nums text-tx2">{formatRatioPercent(r.shareOfTrades, 0)}</td>
                        <td className="px-3 text-right tabular-nums">{formatRatioPercent(r.summary.winRate, 0)}</td>
                        <td className="px-3 text-right tabular-nums">{formatR(r.summary.expectancyR, 2)}</td>
                        <td className="px-3 text-right tabular-nums">{formatProfitFactor(r.summary)}</td>
                        <td className="px-3 text-right font-semibold tabular-nums"><PnlRounded value={r.summary.netPnl} currency={currency} /></td>
                        <td className="px-3 text-right tabular-nums text-tx2">{formatFeeRounded(r.summary.maxDrawdown, currency)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
