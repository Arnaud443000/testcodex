import { useMemo, useState } from 'react';
import { tradesStore } from '../lib/tradesStore';
import { computeStats, periodRanges, tradesInRange, type Period } from '../lib/stats';
import { formatCurrency, formatPercent, formatRatio } from '../lib/format';
import { PeriodSelector } from '../components/PeriodSelector';
import { StatCard } from '../components/StatCard';
import { EquityCurveChart } from '../components/EquityCurveChart';
import { WinLossDonut } from '../components/WinLossDonut';
import { AlertsPanel } from '../components/AlertsPanel';
import { computeActiveAlerts } from '../lib/alerts';
import { settingsStore } from '../lib/settingsStore';

export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('1M');
  const trades = useMemo(() => tradesStore.getAll(), []);
  const alerts = useMemo(() => computeActiveAlerts(trades, settingsStore.get()), [trades]);

  const { current, previous } = useMemo(() => {
    const now = new Date();
    const { currentStart, previousStart } = periodRanges(period, now);
    const currentTrades =
      period === 'ALL' ? trades : tradesInRange(trades, currentStart, now.getTime());
    const previousTrades =
      period === 'ALL' ? [] : tradesInRange(trades, previousStart, currentStart);
    return {
      current: computeStats(currentTrades),
      previous: period === 'ALL' ? null : computeStats(previousTrades),
    };
  }, [trades, period]);

  const hasPrevious = previous !== null && previous.tradeCount > 0;

  const netPnlDelta =
    hasPrevious && previous!.netPnl !== 0
      ? formatPercent(((current.netPnl - previous!.netPnl) / Math.abs(previous!.netPnl)) * 100) +
        ' vs période précédente'
      : undefined;

  const winRateDelta = hasPrevious
    ? formatPercent(current.winRate - previous!.winRate) + ' pts vs période précédente'
    : undefined;

  const profitFactorDelta = hasPrevious
    ? formatRatio(current.profitFactor - previous!.profitFactor) + ' vs période précédente'
    : undefined;

  const avgTradeDelta = hasPrevious
    ? formatCurrency(
        current.netPnl / (current.tradeCount || 1) -
          previous!.netPnl / (previous!.tradeCount || 1),
      ) + ' vs période précédente'
    : undefined;

  const riskRewardDelta = hasPrevious
    ? formatRatio(current.riskReward - previous!.riskReward) + ' vs période précédente'
    : undefined;

  const drawdownDelta = hasPrevious
    ? formatCurrency(current.maxDrawdown - previous!.maxDrawdown) + ' vs période précédente'
    : undefined;

  const avgTrade = current.tradeCount > 0 ? current.netPnl / current.tradeCount : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-cream">Pulse — Dashboard</h1>
        <PeriodSelector value={period} onChange={setPeriod} />
      </header>

      <AlertsPanel result={alerts} />

      {current.tradeCount === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-surface/40 px-4 py-10 text-center text-sm text-cream/50">
          Aucun trade clôturé sur cette période. Ajoute des trades pour voir tes stats.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5 lg:col-span-1">
              <span className="text-xs uppercase tracking-wide text-cream/50">
                Net PnL ({current.tradeCount} trade{current.tradeCount > 1 ? 's' : ''})
              </span>
              <span
                className={`text-3xl font-semibold tabular-nums ${
                  current.netPnl >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {formatCurrency(current.netPnl)}
              </span>
              <span className="text-sm text-cream/60">
                {formatPercent(current.netPnlPercent)} du capital engagé · brut{' '}
                {formatCurrency(current.grossPnl)}
              </span>
              {netPnlDelta && <span className="text-xs text-cream/50">{netPnlDelta}</span>}
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface p-5 lg:col-span-2">
              <EquityCurveChart data={current.equityCurve} />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Win rate"
              value={formatPercent(current.winRate, 0).replace('+', '')}
              delta={winRateDelta}
              tone={current.winRate >= 50 ? 'success' : 'danger'}
              trend={current.winRateTrend}
            />
            <StatCard
              label="Profit factor"
              value={formatRatio(current.profitFactor).replace('+', '')}
              delta={profitFactorDelta}
              tone={current.profitFactor >= 1 ? 'success' : 'danger'}
              trend={current.profitFactorTrend}
            />
            <StatCard
              label="Trade moyen"
              value={formatCurrency(avgTrade)}
              delta={avgTradeDelta}
              tone={avgTrade >= 0 ? 'success' : 'danger'}
              trend={current.avgTradeTrend}
            />
            <StatCard
              label="Risk / Reward"
              value={formatRatio(current.riskReward).replace('+', '')}
              delta={riskRewardDelta}
              tone="accent"
              trend={current.riskRewardTrend}
            />
            <StatCard
              label="Expectancy"
              value={`${formatRatio(current.expectancy)} R`}
              tone={current.expectancy >= 0 ? 'success' : 'danger'}
            />
            <StatCard
              label="Max drawdown"
              value={formatCurrency(current.maxDrawdown, false)}
              delta={drawdownDelta}
              tone="danger"
              trend={current.drawdownTrend}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-surface p-5 lg:col-span-1">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-cream/80">
                Gagnants / Perdants
              </h2>
              <WinLossDonut data={current.winLossDistribution} />
            </div>
            <div className="rounded-2xl border border-white/10 bg-surface p-5 lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cream/80">
                Gain moyen / Perte moyenne
              </h2>
              <div className="flex items-center gap-8">
                <div>
                  <span className="block text-xs uppercase tracking-wide text-cream/50">
                    Gain moyen
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-success">
                    {formatCurrency(current.avgWin)}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-cream/50">
                    Perte moyenne
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-danger">
                    {formatCurrency(-current.avgLoss)}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-wide text-cream/50">
                    Drawdown en cours
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-danger">
                    {formatCurrency(current.currentDrawdown, false)}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
