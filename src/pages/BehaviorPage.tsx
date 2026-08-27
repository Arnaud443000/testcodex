import { useMemo, useState } from 'react';
import type { Trade } from '../types/trade';
import { tradesStore } from '../lib/tradesStore';
import { settingsStore } from '../lib/settingsStore';
import {
  computeDisciplineScore,
  computeStreaks,
  emotionPerformance,
  firstVsLaterTrades,
  mistakeRanking,
  planComparison,
  type GroupPerf,
} from '../lib/behavior';
import { formatCurrency } from '../lib/format';
import { DisciplineGauge } from '../components/DisciplineGauge';
import { EmotionBars } from '../components/EmotionBars';
import { Modal } from '../components/Modal';
import { computeTradePnl } from '../lib/pnl';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">{title}</h2>
      {children}
    </section>
  );
}

function GroupCompare({ a, b }: { a: GroupPerf; b: GroupPerf }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[a, b].map((group) => (
        <div key={group.label} className="rounded-xl bg-background/60 p-4">
          <span className="text-xs uppercase tracking-wide text-cream/50">{group.label}</span>
          <div
            className={`text-xl font-semibold tabular-nums ${
              group.avgPnl >= 0 ? 'text-success' : 'text-danger'
            }`}
          >
            {formatCurrency(group.avgPnl)}
            <span className="ml-1 text-xs font-normal text-cream/50">/ trade</span>
          </div>
          <div className="text-xs text-cream/60">
            {group.count} trade{group.count > 1 ? 's' : ''} · {group.winRate.toFixed(0)}% win rate ·
            total {formatCurrency(group.pnl)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BehaviorPage() {
  const trades = useMemo(() => tradesStore.getAll(), []);
  const settings = useMemo(() => settingsStore.get(), []);
  const [mistakeDrilldown, setMistakeDrilldown] = useState<{
    label: string;
    trades: Trade[];
  } | null>(null);

  const discipline = useMemo(
    () => computeDisciplineScore(trades, settings),
    [trades, settings],
  );
  const emotions = useMemo(() => emotionPerformance(trades), [trades]);
  const streaks = useMemo(() => computeStreaks(trades), [trades]);
  const plan = useMemo(() => planComparison(trades), [trades]);
  const dayOrder = useMemo(() => firstVsLaterTrades(trades), [trades]);
  const mistakes = useMemo(() => mistakeRanking(trades), [trades]);

  if (discipline.tradeCount === 0) {
    return (
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold text-cream">Pulse — Comportement</h1>
        <p className="rounded-2xl border border-white/10 bg-surface/40 px-4 py-10 text-center text-sm text-cream/50">
          Aucun trade clôturé. Ajoute des trades pour analyser ton comportement.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-cream">Pulse — Comportement</h1>
        <p className="text-sm text-cream/60">
          Analyse sur {discipline.tradeCount} trade{discipline.tradeCount > 1 ? 's' : ''} clôturé
          {discipline.tradeCount > 1 ? 's' : ''}.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Score de discipline">
          <div className="flex flex-col items-center gap-4">
            <DisciplineGauge score={discipline.score} />
          </div>
        </Panel>

        <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">
            Détail du score
          </h2>
          <div className="flex flex-col gap-3">
            {discipline.components.map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-cream/80">{c.label}</span>
                  <span className="font-semibold tabular-nums text-cream">
                    {c.ratio.toFixed(0)}%
                    <span className="ml-2 text-xs font-normal text-cream/50">
                      {c.compliant}/{c.total}
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-background/60">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-primary to-accent"
                    style={{ width: `${c.ratio}%` }}
                  />
                </div>
                <span className="text-xs text-cream/50">{c.detail}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-cream/40">
            Moyenne des trois composantes. Risque max courant : {settings.maxRiskPercent}% d'un
            capital de {formatCurrency(settings.capital, false)} (modifiable dans Réglages).
          </p>
        </section>
      </div>

      <Panel title="Émotion avant le trade vs résultat">
        <EmotionBars data={emotions} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Séries en cours">
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-background/60 p-4">
              <span className="text-xs uppercase tracking-wide text-cream/50">Série actuelle</span>
              <div
                className={`text-2xl font-semibold ${
                  streaks.currentType === 'win'
                    ? 'text-success'
                    : streaks.currentType === 'loss'
                      ? 'text-danger'
                      : 'text-cream/60'
                }`}
              >
                {streaks.currentType === null
                  ? '—'
                  : `${streaks.currentLength} ${
                      streaks.currentType === 'win' ? 'gain' : 'perte'
                    }${streaks.currentLength > 1 ? 's' : ''}`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-background/60 p-3">
                <span className="text-xs uppercase tracking-wide text-cream/50">
                  Record gains
                </span>
                <div className="text-lg font-semibold text-success">{streaks.longestWin}</div>
              </div>
              <div className="rounded-xl bg-background/60 p-3">
                <span className="text-xs uppercase tracking-wide text-cream/50">
                  Record pertes
                </span>
                <div className="text-lg font-semibold text-danger">{streaks.longestLoss}</div>
              </div>
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel title="Dans le plan vs hors plan">
            <GroupCompare a={plan.inPlan} b={plan.offPlan} />
          </Panel>
          <Panel title="Premier trade du jour vs suivants">
            <GroupCompare a={dayOrder.first} b={dayOrder.later} />
          </Panel>
        </div>
      </div>

      <Panel title="Erreurs récurrentes">
        {mistakes.length === 0 ? (
          <p className="text-sm text-cream/40">
            Tague tes trades avec un type d'erreur dans le formulaire pour voir ce classement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-cream/50">
                  <th className="pb-2 pr-4">Erreur</th>
                  <th className="pb-2 pr-4 text-right">Fréquence</th>
                  <th className="pb-2 text-right">PnL perdu</th>
                </tr>
              </thead>
              <tbody>
                {mistakes.map((row) => (
                  <tr
                    key={row.mistake}
                    onClick={() =>
                      setMistakeDrilldown({ label: row.mistake, trades: row.trades })
                    }
                    className="cursor-pointer border-t border-white/10 hover:bg-white/5"
                  >
                    <td className="py-2 pr-4 font-medium text-cream">{row.mistake}</td>
                    <td className="py-2 pr-4 text-right text-cream/70">{row.count}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-danger">
                      {formatCurrency(row.lostPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {mistakeDrilldown && (
        <Modal
          title={`Trades — ${mistakeDrilldown.label}`}
          onClose={() => setMistakeDrilldown(null)}
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-cream/50">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Actif</th>
                <th className="pb-2 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {mistakeDrilldown.trades.map((trade) => {
                const pnl = computeTradePnl(trade);
                return (
                  <tr key={trade.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 text-cream/80">{trade.date}</td>
                    <td className="py-2 pr-4 font-medium text-cream">{trade.asset}</td>
                    <td
                      className={`py-2 text-right font-semibold tabular-nums ${
                        pnl >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatCurrency(pnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
