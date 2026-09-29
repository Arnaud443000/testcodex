import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatFeeRounded, instrumentLink, sortAssets, type AssetSortKey, type SortDir } from '../../lib/analysesView'
import { formatR, formatRatioPercent } from '../../lib/format'
import type { AssetRow } from '../../types/stats'
import { LowSampleBadge, PnlRounded, Section, SortTh } from './parts'

/** Vue « par actif » (3.3.13) : un instrument par ligne, tri par colonne, clic vers la liste des trades filtrée. */
export function AssetsPanel({ rows, currency }: { rows: AssetRow[]; currency: string }) {
  const t = useT().analyses
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: AssetSortKey; dir: SortDir }>({ key: 'netPnl', dir: 'desc' })
  const sorted = useMemo(() => sortAssets(rows, sort.key, sort.dir), [rows, sort])
  const onSort = (key: AssetSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'symbol' ? 'asc' : 'desc' }))
  const th = { active: sort.key, dir: sort.dir, onSort }
  return (
    <Section title={t.assets.title} subtitle={t.assets.hint}>
      <div className="-mx-3 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr>
              <SortTh sortKey="symbol" label={t.assets.columns.symbol} {...th} />
              <SortTh sortKey="trades" label={t.assets.columns.trades} align="right" {...th} />
              <SortTh sortKey="winRate" label={t.assets.columns.winRate} align="right" {...th} />
              <SortTh sortKey="avgR" label={t.assets.columns.avgR} align="right" {...th} />
              <SortTh sortKey="netPnl" label={t.assets.columns.netPnl} align="right" {...th} />
              <SortTh sortKey="fees" label={t.assets.columns.fees} align="right" {...th} />
              <SortTh sortKey="feesShare" label={t.assets.columns.feesShare} align="right" hint={t.assets.feesShareHint} {...th} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.instrumentId}
                onClick={() => navigate(instrumentLink(r.instrumentId))}
                className="h-[52px] cursor-pointer border-t transition hover:bg-white/[0.04]"
                style={{ borderColor: 'var(--hairline)' }}
              >
                <td className="px-3">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Link
                      to={instrumentLink(r.instrumentId)}
                      aria-label={t.assets.open(r.symbol)}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
                    >
                      {r.symbol}
                    </Link>
                    <span className="text-xs text-tx3">{t.assetClasses[r.assetClass] ?? r.assetClass}</span>
                    {r.lowSample && <LowSampleBadge />}
                  </div>
                </td>
                <td className="px-3 text-right tabular-nums">{r.summary.tradeCount}</td>
                <td className="px-3 text-right tabular-nums">{formatRatioPercent(r.summary.winRate, 0)}</td>
                <td className="px-3 text-right tabular-nums">{formatR(r.summary.expectancyR, 2)}</td>
                <td className="px-3 text-right font-semibold tabular-nums">
                  <PnlRounded value={r.summary.netPnl} currency={currency} />
                </td>
                <td className="px-3 text-right tabular-nums text-tx2">{formatFeeRounded(r.summary.fees, currency)}</td>
                <td className="px-3 text-right tabular-nums text-tx2">{formatRatioPercent(r.feesShareOfGross, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
