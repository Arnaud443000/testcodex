import type { Trade, TradeType } from '../types/trade';
import { computeTradePnl } from './pnl';
import { rMultiple } from './stats';

export interface SegmentPerf {
  label: string;
  count: number;
  pnl: number;
  winRate: number;
}

function summarize(label: string, trades: Trade[]): SegmentPerf {
  const count = trades.length;
  const pnl = trades.reduce((sum, t) => sum + computeTradePnl(t), 0);
  const wins = trades.filter((t) => computeTradePnl(t) > 0).length;
  return { label, count, pnl, winRate: count > 0 ? (wins / count) * 100 : 0 };
}

function groupBy(trades: Trade[], keyFn: (trade: Trade) => string): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = keyFn(trade);
    const existing = groups.get(key);
    if (existing) existing.push(trade);
    else groups.set(key, [trade]);
  }
  return groups;
}

function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.closed);
}

export function performanceBySetup(trades: Trade[]): SegmentPerf[] {
  const groups = groupBy(closedTrades(trades), (t) => t.setup.trim() || 'Sans setup');
  return Array.from(groups.entries())
    .map(([label, group]) => summarize(label, group))
    .sort((a, b) => b.pnl - a.pnl);
}

export function performanceByAsset(trades: Trade[]): SegmentPerf[] {
  const groups = groupBy(closedTrades(trades), (t) => t.asset.trim() || 'Sans actif');
  return Array.from(groups.entries())
    .map(([label, group]) => summarize(label, group))
    .sort((a, b) => b.pnl - a.pnl);
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function performanceByWeekday(trades: Trade[]): SegmentPerf[] {
  const groups = groupBy(closedTrades(trades), (t) => {
    const day = new Date(`${t.date}T00:00:00`).getDay();
    return String((day + 6) % 7);
  });
  return WEEKDAY_LABELS.map((label, index) =>
    summarize(label, groups.get(String(index)) ?? []),
  );
}

export function performanceByHour(trades: Trade[]): SegmentPerf[] {
  const withHour = closedTrades(trades).filter((t) => !!t.entryTime);
  const groups = groupBy(withHour, (t) => String(Number(t.entryTime!.split(':')[0])));
  return Array.from({ length: 24 }, (_, hour) =>
    summarize(`${hour}h`, groups.get(String(hour)) ?? []),
  );
}

export function longVsShort(trades: Trade[]): { long: SegmentPerf; short: SegmentPerf } {
  const closed = closedTrades(trades);
  return {
    long: summarize('Long', closed.filter((t) => t.side === 'long')),
    short: summarize('Short', closed.filter((t) => t.side === 'short')),
  };
}

const R_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '< -2R', min: -Infinity, max: -2 },
  { label: '-2R à -1R', min: -2, max: -1 },
  { label: '-1R à 0R', min: -1, max: 0 },
  { label: '0R à 1R', min: 0, max: 1 },
  { label: '1R à 2R', min: 1, max: 2 },
  { label: '2R à 3R', min: 2, max: 3 },
  { label: '> 3R', min: 3, max: Infinity },
];

export function rMultipleDistribution(trades: Trade[]): { label: string; count: number }[] {
  const values = closedTrades(trades)
    .map(rMultiple)
    .filter((r): r is number => r !== null);

  return R_BUCKETS.map(({ label, min, max }) => ({
    label,
    count: values.filter((r) => r >= min && r < max).length,
  }));
}

export function systemVsDiscretionary(trades: Trade[]): {
  system: SegmentPerf;
  discretionary: SegmentPerf;
  untaggedCount: number;
} {
  const closed = closedTrades(trades);
  const byType = (type: TradeType) => closed.filter((t) => t.tradeType === type);
  return {
    system: summarize('Système', byType('system')),
    discretionary: summarize('Discrétionnaire', byType('discretionary')),
    untaggedCount: closed.filter((t) => !t.tradeType).length,
  };
}

function durationMinutes(trade: Trade): number | null {
  if (!trade.entryTime || !trade.exitTime) return null;
  const [entryH, entryM] = trade.entryTime.split(':').map(Number);
  const [exitH, exitM] = trade.exitTime.split(':').map(Number);
  const minutes = exitH * 60 + exitM - (entryH * 60 + entryM);
  return minutes >= 0 ? minutes : null;
}

export function durationByOutcome(trades: Trade[]): {
  avgWinMinutes: number | null;
  avgLossMinutes: number | null;
  sampleSize: number;
} {
  const closed = closedTrades(trades);
  const winDurations: number[] = [];
  const lossDurations: number[] = [];

  for (const trade of closed) {
    const minutes = durationMinutes(trade);
    if (minutes === null) continue;
    const pnl = computeTradePnl(trade);
    if (pnl > 0) winDurations.push(minutes);
    else if (pnl < 0) lossDurations.push(minutes);
  }

  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  return {
    avgWinMinutes: avg(winDurations),
    avgLossMinutes: avg(lossDurations),
    sampleSize: winDurations.length + lossDurations.length,
  };
}

export interface OpportunityCostRow {
  trade: Trade;
  opportunityCost: number;
}

/**
 * Favorable move still available after exit: (priceAfterExit - exitPrice),
 * sign-flipped for shorts. Positive means price kept moving your way after
 * you closed the trade — money left on the table.
 */
export function opportunityCostTrades(trades: Trade[]): OpportunityCostRow[] {
  return closedTrades(trades)
    .filter((t) => t.priceAfterExit !== undefined)
    .map((trade) => {
      const direction = trade.side === 'long' ? 1 : -1;
      const opportunityCost = (trade.priceAfterExit! - trade.exitPrice) * direction;
      return { trade, opportunityCost };
    })
    .sort((a, b) => b.opportunityCost - a.opportunityCost);
}
