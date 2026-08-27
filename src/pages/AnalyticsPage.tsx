import { useMemo } from 'react';
import { useAccountTrades } from '../lib/accountContext';
import {
  durationByOutcome,
  longVsShort,
  opportunityCostTrades,
  performanceByAsset,
  performanceByHour,
  performanceBySetup,
  performanceByWeekday,
  rMultipleDistribution,
  systemVsDiscretionary,
  type SegmentPerf,
} from '../lib/analytics';
import { formatCurrency } from '../lib/format';
import { SegmentBarChart } from '../components/SegmentBarChart';
import { HeatmapStrip } from '../components/HeatmapStrip';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">{title}</h2>
      {children}
    </section>
  );
}

function SegmentTable({ rows }: { rows: SegmentPerf[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-cream/40">Pas encore de données.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-cream/50">
            <th className="pb-2 pr-4">Label</th>
            <th className="pb-2 pr-4 text-right">Trades</th>
            <th className="pb-2 pr-4 text-right">Win rate</th>
            <th className="pb-2 text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/10">
              <td className="py-2 pr-4 font-medium text-cream">{row.label}</td>
              <td className="py-2 pr-4 text-right text-cream/70">{row.count}</td>
              <td className="py-2 pr-4 text-right text-cream/70">{row.winRate.toFixed(0)}%</td>
              <td
                className={`py-2 text-right font-semibold tabular-nums ${
                  row.pnl >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {formatCurrency(row.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuoComparison({ a, b }: { a: SegmentPerf; b: SegmentPerf }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[a, b].map((seg) => (
        <div key={seg.label} className="rounded-xl bg-background/60 p-4">
          <span className="text-xs uppercase tracking-wide text-cream/50">{seg.label}</span>
          <div
            className={`text-xl font-semibold tabular-nums ${
              seg.pnl >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {formatCurrency(seg.pnl)}
          </div>
          <div className="text-xs text-cream/60">
            {seg.count} trade{seg.count > 1 ? 's' : ''} · {seg.winRate.toFixed(0)}% win rate
          </div>
        </div>
      ))}
    </div>
  );
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}

export function AnalyticsPage() {
  const trades = useAccountTrades();

  const bySetup = useMemo(() => performanceBySetup(trades), [trades]);
  const byAsset = useMemo(() => performanceByAsset(trades), [trades]);
  const byWeekday = useMemo(() => performanceByWeekday(trades), [trades]);
  const byHour = useMemo(() => performanceByHour(trades), [trades]);
  const sides = useMemo(() => longVsShort(trades), [trades]);
  const rDistribution = useMemo(() => rMultipleDistribution(trades), [trades]);
  const tradeTypes = useMemo(() => systemVsDiscretionary(trades), [trades]);
  const duration = useMemo(() => durationByOutcome(trades), [trades]);
  const opportunityRows = useMemo(() => opportunityCostTrades(trades), [trades]);

  const hourCellsWithData = byHour.filter((h) => h.count > 0).length;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-cream">Pulse — Analytics</h1>
        <p className="text-sm text-cream/60">
          Analyse détaillée des {trades.filter((t) => t.closed).length} trades clôturés.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Performance par setup">
          <SegmentBarChart data={bySetup.map((s) => ({ label: s.label, value: s.pnl }))} />
          <SegmentTable rows={bySetup} />
        </Panel>

        <Panel title="Performance par actif">
          <SegmentBarChart data={byAsset.map((s) => ({ label: s.label, value: s.pnl }))} />
          <SegmentTable rows={byAsset} />
        </Panel>
      </div>

      <Panel title="Performance par jour de la semaine">
        <HeatmapStrip cells={byWeekday} />
      </Panel>

      <Panel title="Performance par heure de la journée">
        {hourCellsWithData === 0 ? (
          <p className="text-sm text-cream/40">
            Renseigne l'heure d'entrée sur tes trades pour voir cette vue.
          </p>
        ) : (
          <HeatmapStrip cells={byHour} />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Long vs Short">
          <DuoComparison a={sides.long} b={sides.short} />
        </Panel>

        <Panel title="Système vs discrétionnaire">
          {tradeTypes.system.count + tradeTypes.discretionary.count === 0 ? (
            <p className="text-sm text-cream/40">
              Tague tes trades comme "Système" ou "Discrétionnaire" dans le formulaire pour voir
              cette comparaison.
            </p>
          ) : (
            <>
              <DuoComparison a={tradeTypes.system} b={tradeTypes.discretionary} />
              {tradeTypes.untaggedCount > 0 && (
                <p className="text-xs text-cream/40">
                  {tradeTypes.untaggedCount} trade(s) non tagué(s) exclus de la comparaison.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel title="Distribution des R-multiples">
        <SegmentBarChart data={rDistribution.map((b) => ({ label: b.label, value: b.count }))} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Durée moyenne en position">
          {duration.sampleSize === 0 ? (
            <p className="text-sm text-cream/40">
              Renseigne les heures d'entrée et de sortie pour voir cette vue.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-background/60 p-4">
                <span className="text-xs uppercase tracking-wide text-cream/50">
                  Trades gagnants
                </span>
                <div className="text-xl font-semibold text-success">
                  {formatMinutes(duration.avgWinMinutes)}
                </div>
              </div>
              <div className="rounded-xl bg-background/60 p-4">
                <span className="text-xs uppercase tracking-wide text-cream/50">
                  Trades perdants
                </span>
                <div className="text-xl font-semibold text-danger">
                  {formatMinutes(duration.avgLossMinutes)}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Coût d'opportunité">
          {opportunityRows.length === 0 ? (
            <p className="text-sm text-cream/40">
              Renseigne le "prix après sortie" sur un trade clôturé (depuis sa vue détail) pour
              voir cette analyse.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-cream/50">
                    <th className="pb-2 pr-4">Trade</th>
                    <th className="pb-2 text-right">Gains laissés sur la table</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunityRows.map(({ trade, opportunityCost }) => (
                    <tr key={trade.id} className="border-t border-white/10">
                      <td className="py-2 pr-4 text-cream/80">
                        {trade.asset} · {trade.date}
                      </td>
                      <td
                        className={`py-2 text-right font-semibold tabular-nums ${
                          opportunityCost >= 0 ? 'text-success' : 'text-danger'
                        }`}
                      >
                        {formatCurrency(opportunityCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
