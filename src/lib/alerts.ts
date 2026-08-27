import type { Trade } from '../types/trade';
import type { Settings } from '../types/settings';
import { computeTradePnl } from './pnl';
import { chronological, detectRevengeTrades } from './behavior';

export type AlertKind =
  | 'overtrading'
  | 'daily-loss'
  | 'revenge'
  | 'missing-stop';

export interface ActiveAlert {
  kind: AlertKind;
  title: string;
  detail: string;
  severity: 'warning' | 'danger';
}

export interface AlertsResult {
  /** The day these guardrails were evaluated against (YYYY-MM-DD). */
  day: string;
  tradesToday: number;
  alerts: ActiveAlert[];
}

export function todayIso(now: Date = new Date()): string {
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/**
 * Length of the CURRENT run of losing trades at the end of the day — not the
 * longest run of the day. A trader who lost three times and then won is no
 * longer on a losing streak, so the guardrail should be silent.
 * A breakeven trade interrupts the run without extending it.
 */
function currentLosingRun(dayTrades: Trade[]): number {
  let run = 0;
  for (const trade of dayTrades) {
    const pnl = computeTradePnl(trade);
    if (pnl < 0) run += 1;
    else run = 0;
  }
  return run;
}

/**
 * Real-time guardrails for the CURRENT session (3.6). Every alert is scoped to
 * `day` — these answer "should I stop trading right now?", so a breach from
 * last week must not keep firing today. Historical context is still used where
 * a baseline is needed (revenge detection compares against the trader's whole
 * history), but only today's trades can raise an alert.
 */
export function computeActiveAlerts(
  trades: Trade[],
  settings: Settings,
  day: string = todayIso(),
): AlertsResult {
  const ordered = chronological(trades);
  const dayTrades = ordered.filter((t) => t.date === day);
  const alerts: ActiveAlert[] = [];

  if (dayTrades.length === 0) {
    return { day, tradesToday: 0, alerts };
  }

  // --- Overtrading: consecutive losses today
  const losingRun = currentLosingRun(dayTrades);
  if (losingRun >= settings.maxConsecutiveLosses) {
    alerts.push({
      kind: 'overtrading',
      title: 'Risque d’overtrading',
      detail: `${losingRun} trades perdants d'affilée aujourd'hui (seuil : ${settings.maxConsecutiveLosses}). Envisage une pause.`,
      severity: 'danger',
    });
  }

  // --- Daily loss vs % of capital
  const dayPnl = dayTrades.reduce((sum, t) => sum + computeTradePnl(t), 0);
  if (dayPnl < 0 && settings.capital > 0) {
    const lossPercent = (Math.abs(dayPnl) / settings.capital) * 100;
    if (lossPercent >= settings.maxDailyLossPercent) {
      alerts.push({
        kind: 'daily-loss',
        title: 'Stop pour aujourd’hui',
        detail: `Perte du jour de ${lossPercent.toFixed(2)}% du capital (seuil : ${settings.maxDailyLossPercent}%).`,
        severity: 'danger',
      });
    }
  }

  // --- Revenge trading: baseline from the full history, flagged only today
  const revengeIds = detectRevengeTrades(trades);
  const revengeToday = dayTrades.filter((t) => revengeIds.has(t.id));
  if (revengeToday.length > 0) {
    alerts.push({
      kind: 'revenge',
      title: 'Signal de revenge trading',
      detail: `${revengeToday.length} trade(s) aujourd'hui (${revengeToday
        .map((t) => t.asset)
        .join(', ')}) nettement plus gros que ta taille habituelle sur cet actif, juste après une perte.`,
      severity: 'danger',
    });
  }

  // --- Trades entered without a stop loss
  const withoutStop = dayTrades.filter((t) => !t.stopLoss);
  if (withoutStop.length > 0) {
    alerts.push({
      kind: 'missing-stop',
      title: 'Trade sans stop loss',
      detail: `${withoutStop.length} trade(s) aujourd'hui (${withoutStop
        .map((t) => t.asset)
        .join(', ')}) saisi(s) sans stop loss.`,
      severity: 'warning',
    });
  }

  return { day, tradesToday: dayTrades.length, alerts };
}
