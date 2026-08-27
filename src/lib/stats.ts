import type { Trade } from '../types/trade';
import { computeTradePnl } from './pnl';

export type Period = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

export const PERIODS: Period[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

const PERIOD_DAYS: Record<Exclude<Period, 'ALL'>, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
};

function toDate(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

/**
 * Current-period window and the immediately preceding window of the same
 * length, so every stat can show "vs previous period".
 */
export function periodRanges(
  period: Period,
  now: Date = new Date(),
): { currentStart: number; previousStart: number } {
  if (period === 'ALL') {
    return { currentStart: -Infinity, previousStart: -Infinity };
  }
  const days = PERIOD_DAYS[period];
  const currentStart = now.getTime() - days * 24 * 60 * 60 * 1000;
  const previousStart = currentStart - days * 24 * 60 * 60 * 1000;
  return { currentStart, previousStart };
}

export function tradesInRange(trades: Trade[], start: number, end: number): Trade[] {
  return trades.filter((t) => {
    const time = toDate(t.date);
    return time >= start && time < end;
  });
}

export interface DashboardStats {
  tradeCount: number;
  grossPnl: number;
  netPnl: number;
  netPnlPercent: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  riskReward: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  currentDrawdown: number;
  equityCurve: { date: string; cumulative: number }[];
  winLossDistribution: { name: string; value: number }[];
  netPnlTrend: number[];
  winRateTrend: number[];
  profitFactorTrend: number[];
  avgTradeTrend: number[];
  riskRewardTrend: number[];
  drawdownTrend: number[];
}

const EMPTY_STATS: DashboardStats = {
  tradeCount: 0,
  grossPnl: 0,
  netPnl: 0,
  netPnlPercent: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
  riskReward: 0,
  expectancy: 0,
  profitFactor: 0,
  maxDrawdown: 0,
  currentDrawdown: 0,
  equityCurve: [],
  winLossDistribution: [],
  netPnlTrend: [],
  winRateTrend: [],
  profitFactorTrend: [],
  avgTradeTrend: [],
  riskRewardTrend: [],
  drawdownTrend: [],
};

/** R-multiple, or null if no stop loss distance is defined for this trade. */
function rMultiple(trade: Trade): number | null {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  if (!trade.stopLoss || risk === 0) return null;
  const direction = trade.side === 'long' ? 1 : -1;
  return ((trade.exitPrice - trade.entryPrice) * direction) / risk;
}

export function computeStats(trades: Trade[]): DashboardStats {
  const closed = trades
    .filter((t) => t.closed)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (closed.length === 0) return EMPTY_STATS;

  let grossPnl = 0;
  let netPnl = 0;
  let engagedCapital = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let winSum = 0;
  let lossSum = 0;
  let winRSum = 0;
  let winRCount = 0;
  let lossRSum = 0;
  let lossRCount = 0;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  const equityCurve: { date: string; cumulative: number }[] = [];
  const netPnlTrend: number[] = [];
  const winRateTrend: number[] = [];
  const profitFactorTrend: number[] = [];
  const avgTradeTrend: number[] = [];
  const riskRewardTrend: number[] = [];
  const drawdownTrend: number[] = [];

  let runningWins = 0;
  let runningWinSum = 0;
  let runningLossSum = 0;
  let runningCount = 0;

  for (const trade of closed) {
    const pnl = computeTradePnl(trade);
    const gross = pnl + trade.fees;

    grossPnl += gross;
    netPnl += pnl;
    engagedCapital += Math.abs(trade.entryPrice * trade.size);

    if (pnl > 0) {
      wins += 1;
      winSum += pnl;
    } else if (pnl < 0) {
      losses += 1;
      lossSum += Math.abs(pnl);
    } else {
      breakeven += 1;
    }

    const r = rMultiple(trade);
    if (r !== null) {
      if (r > 0) {
        winRSum += r;
        winRCount += 1;
      } else if (r < 0) {
        lossRSum += Math.abs(r);
        lossRCount += 1;
      }
    }

    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
    equityCurve.push({ date: trade.date, cumulative });
    drawdownTrend.push(cumulative - peak);

    runningCount += 1;
    if (pnl > 0) {
      runningWins += 1;
      runningWinSum += pnl;
    } else if (pnl < 0) {
      runningLossSum += Math.abs(pnl);
    }
    netPnlTrend.push(cumulative);
    winRateTrend.push((runningWins / runningCount) * 100);
    profitFactorTrend.push(runningLossSum > 0 ? runningWinSum / runningLossSum : runningWinSum > 0 ? runningWinSum : 0);
    avgTradeTrend.push(netPnl === 0 ? 0 : cumulative / runningCount);
    const runningAvgWin = runningWins > 0 ? runningWinSum / runningWins : 0;
    const runningLosses = runningCount - runningWins - (pnl === 0 ? 1 : 0);
    const runningAvgLoss = runningLosses > 0 ? runningLossSum / runningLosses : 0;
    riskRewardTrend.push(runningAvgLoss > 0 ? runningAvgWin / runningAvgLoss : 0);
  }

  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const winRate = (wins / closed.length) * 100;
  const avgWinR = winRCount > 0 ? winRSum / winRCount : 0;
  const avgLossR = lossRCount > 0 ? lossRSum / lossRCount : 0;
  const winRateFraction = wins / closed.length;
  const lossRateFraction = losses / closed.length;

  return {
    tradeCount: closed.length,
    grossPnl,
    netPnl,
    netPnlPercent: engagedCapital > 0 ? (netPnl / engagedCapital) * 100 : 0,
    winRate,
    avgWin,
    avgLoss,
    riskReward: avgLoss > 0 ? avgWin / avgLoss : 0,
    expectancy: winRateFraction * avgWinR - lossRateFraction * avgLossR,
    profitFactor: lossSum > 0 ? winSum / lossSum : winSum > 0 ? winSum : 0,
    maxDrawdown,
    currentDrawdown: cumulative - peak,
    equityCurve,
    winLossDistribution: [
      { name: 'Gagnants', value: wins },
      { name: 'Perdants', value: losses },
      { name: 'Breakeven', value: breakeven },
    ].filter((d) => d.value > 0),
    netPnlTrend,
    winRateTrend,
    profitFactorTrend,
    avgTradeTrend,
    riskRewardTrend,
    drawdownTrend,
  };
}
