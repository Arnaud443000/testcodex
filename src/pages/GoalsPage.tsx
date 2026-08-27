import { useMemo, useState } from 'react';
import type { Goal, GoalMetric } from '../types/goal';
import { GOAL_METRIC_LABELS } from '../types/goal';
import { goalsStore } from '../lib/goalsStore';
import { useAccounts, useAccountTrades } from '../lib/accountContext';
import { computeTradePnl } from '../lib/pnl';
import { formatCurrency } from '../lib/format';
import { Field, inputClass } from '../components/Field';

const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return MONTH_LABEL.format(new Date(year, m - 1, 1));
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function computeProgress(goal: Goal, monthTrades: ReturnType<typeof useAccountTrades>) {
  const closed = monthTrades.filter((t) => t.closed);
  let current: number;
  switch (goal.metric) {
    case 'profit':
      current = closed.reduce((sum, t) => sum + computeTradePnl(t), 0);
      break;
    case 'winRate': {
      const wins = closed.filter((t) => computeTradePnl(t) > 0).length;
      current = closed.length > 0 ? (wins / closed.length) * 100 : 0;
      break;
    }
    case 'tradeCount':
      current = closed.length;
      break;
  }
  const percent = goal.target > 0 ? Math.min(100, Math.max(0, (current / goal.target) * 100)) : 0;
  return { current, percent };
}

function formatMetricValue(metric: GoalMetric, value: number): string {
  if (metric === 'profit') return formatCurrency(value);
  if (metric === 'winRate') return `${value.toFixed(0)}%`;
  return `${value.toFixed(0)}`;
}

export function GoalsPage() {
  const { selectedAccountId, accounts } = useAccounts();
  const trades = useAccountTrades();
  const [month, setMonth] = useState(currentMonth);
  const [goals, setGoals] = useState(() => goalsStore.getAll());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ metric: GoalMetric; target: string }>({
    metric: 'profit',
    target: '',
  });

  const goal = goals.find(
    (g) => g.month === month && (g.accountId ?? null) === selectedAccountId,
  );

  const monthTrades = useMemo(
    () => trades.filter((t) => t.date.startsWith(month)),
    [trades, month],
  );

  const scopeLabel =
    selectedAccountId === null
      ? 'Tous les comptes'
      : accounts.find((a) => a.id === selectedAccountId)?.name ?? 'Compte';

  function startEditing() {
    setForm({
      metric: goal?.metric ?? 'profit',
      target: goal ? String(goal.target) : '',
    });
    setEditing(true);
  }

  function saveGoal() {
    const target = Number(form.target);
    if (!Number.isFinite(target) || target <= 0) return;

    if (goal) {
      goalsStore.update(goal.id, { metric: form.metric, target });
    } else {
      goalsStore.create({
        id: crypto.randomUUID(),
        accountId: selectedAccountId ?? undefined,
        month,
        metric: form.metric,
        target,
      });
    }
    setGoals(goalsStore.getAll());
    setEditing(false);
  }

  function removeGoal() {
    if (!goal) return;
    goalsStore.remove(goal.id);
    setGoals(goalsStore.getAll());
    setEditing(false);
  }

  const progress = goal ? computeProgress(goal, monthTrades) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-cream">Pulse — Objectifs</h1>
          <p className="text-sm text-cream/60">{scopeLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="rounded-full bg-surface px-3 py-1.5 text-sm text-cream/70 hover:text-cream"
          >
            ←
          </button>
          <span className="w-40 text-center text-sm font-medium capitalize text-cream">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="rounded-full bg-surface px-3 py-1.5 text-sm text-cream/70 hover:text-cream"
          >
            →
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-6">
        {!goal && !editing && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-cream/50">
              Aucun objectif défini pour {monthLabel(month)} ({scopeLabel}).
            </p>
            <button
              type="button"
              onClick={startEditing}
              className="rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-cream transition hover:brightness-110"
            >
              Définir un objectif
            </button>
          </div>
        )}

        {editing && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4">
              <Field label="Métrique">
                <select
                  className={inputClass}
                  value={form.metric}
                  onChange={(e) =>
                    setForm({ ...form, metric: e.target.value as GoalMetric })
                  }
                >
                  {(Object.keys(GOAL_METRIC_LABELS) as GoalMetric[]).map((metric) => (
                    <option key={metric} value={metric}>
                      {GOAL_METRIC_LABELS[metric]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cible">
                <input
                  type="number"
                  step="any"
                  min={0}
                  className={inputClass}
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={saveGoal}
                className="rounded-full bg-gradient-to-r from-primary to-accent px-5 py-2 text-sm font-semibold text-cream transition hover:brightness-110"
              >
                Enregistrer
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full bg-cream px-5 py-2 text-sm font-semibold text-background transition hover:brightness-95"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {goal && !editing && progress && (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-cream/70">{GOAL_METRIC_LABELS[goal.metric]}</span>
              <span className="text-sm font-semibold text-cream">
                {formatMetricValue(goal.metric, progress.current)} /{' '}
                {formatMetricValue(goal.metric, goal.target)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-background/60">
              <div
                className={`h-3 rounded-full transition-all ${
                  progress.percent >= 100
                    ? 'bg-success'
                    : 'bg-gradient-to-r from-primary to-accent'
                }`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-xs text-cream/50">{progress.percent.toFixed(0)}% atteint</span>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={startEditing}
                className="text-sm font-medium text-accent hover:text-cream"
              >
                Modifier
              </button>
              <button
                type="button"
                onClick={removeGoal}
                className="text-sm font-medium text-danger/80 hover:text-danger"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
