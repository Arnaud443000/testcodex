import type { MistakeType, Trade } from '../types/trade';
import type { Settings } from '../types/settings';
import { computeTradePnl } from './pnl';

/**
 * Chronological order. Date alone is not enough: several trades share a date,
 * and streaks / "first trade of the day" / revenge detection all depend on
 * intra-day order. entryTime is used when present; trades without it keep
 * their insertion order within the day (stable sort).
 */
export function chronological(trades: Trade[]): Trade[] {
  return trades
    .filter((t) => t.closed)
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => {
      const byDate = a.trade.date.localeCompare(b.trade.date);
      if (byDate !== 0) return byDate;
      const aTime = a.trade.entryTime ?? '';
      const bTime = b.trade.entryTime ?? '';
      if (aTime && bTime) {
        const byTime = aTime.localeCompare(bTime);
        if (byTime !== 0) return byTime;
      }
      return a.index - b.index;
    })
    .map(({ trade }) => trade);
}

// ---------------------------------------------------------------------------
// Risk per trade
// ---------------------------------------------------------------------------

/**
 * Money at risk if the stop loss is hit: |entry - SL| * size.
 * Returns null when no stop loss is set — risk is then unquantifiable,
 * which callers treat as a discipline violation rather than as "no risk".
 */
export function riskAmount(trade: Trade): number | null {
  if (!trade.stopLoss) return null;
  const distance = Math.abs(trade.entryPrice - trade.stopLoss);
  if (distance === 0) return null;
  return distance * trade.size;
}

export function riskPercent(trade: Trade, capital: number): number | null {
  const amount = riskAmount(trade);
  if (amount === null || capital <= 0) return null;
  return (amount / capital) * 100;
}

// ---------------------------------------------------------------------------
// Revenge trading detection
// ---------------------------------------------------------------------------

/** How much bigger than the recent baseline a position must be to look like revenge. */
const REVENGE_SIZE_FACTOR = 1.5;
const REVENGE_LOOKBACK = 10;

/**
 * A trade is flagged as revenge trading when it is BOTH
 *   (a) taken right after a losing trade, and
 *   (b) sized well above that trader's own recent baseline for the SAME asset.
 *
 * The same-asset restriction matters: raw position size is not comparable
 * across instruments (0.1 BTC vs 1000 units of EURUSD), so averaging sizes
 * across a mixed portfolio would produce meaningless flags. Assets with fewer
 * than two prior trades have no baseline yet and are never flagged.
 */
export function detectRevengeTrades(trades: Trade[]): Set<string> {
  const ordered = chronological(trades);
  const flagged = new Set<string>();

  ordered.forEach((trade, index) => {
    if (index === 0) return;
    const previous = ordered[index - 1];
    if (computeTradePnl(previous) >= 0) return;

    const priorSameAsset = ordered
      .slice(0, index)
      .filter((t) => t.asset === trade.asset)
      .slice(-REVENGE_LOOKBACK);
    if (priorSameAsset.length < 2) return;

    const baseline =
      priorSameAsset.reduce((sum, t) => sum + t.size, 0) / priorSameAsset.length;
    if (baseline > 0 && trade.size > baseline * REVENGE_SIZE_FACTOR) {
      flagged.add(trade.id);
    }
  });

  return flagged;
}

// ---------------------------------------------------------------------------
// Discipline score
// ---------------------------------------------------------------------------

export interface DisciplineComponent {
  label: string;
  compliant: number;
  total: number;
  /** 0-100; 100 when there is nothing to check. */
  ratio: number;
  detail: string;
}

export interface DisciplineScore {
  score: number;
  components: DisciplineComponent[];
  tradeCount: number;
}

function component(
  label: string,
  compliant: number,
  total: number,
  detail: string,
): DisciplineComponent {
  return {
    label,
    compliant,
    total,
    ratio: total === 0 ? 100 : (compliant / total) * 100,
    detail,
  };
}

/**
 * Discipline out of 100, as an equally weighted mean of three compliance
 * ratios: plan followed, no revenge trading detected, declared max risk
 * respected. The exact weighting is flagged as an open product decision in
 * the spec (3.4.1), so each component is exposed separately and the score is
 * explainable trade by trade rather than being a black box.
 */
export function computeDisciplineScore(
  trades: Trade[],
  settings: Settings,
): DisciplineScore {
  const closed = chronological(trades);
  if (closed.length === 0) {
    return { score: 0, components: [], tradeCount: 0 };
  }

  const planFollowed = closed.filter((t) => t.followedPlan).length;

  const revenge = detectRevengeTrades(trades);
  const withoutRevenge = closed.filter((t) => !revenge.has(t.id)).length;

  // A trade with no stop loss counts as a risk violation: without one the
  // risk taken is unbounded, so it cannot be shown to respect the limit.
  const riskCompliant = closed.filter((t) => {
    const percent = riskPercent(t, settings.capital);
    return percent !== null && percent <= settings.maxRiskPercent;
  }).length;
  const missingStop = closed.filter((t) => riskAmount(t) === null).length;

  const components = [
    component(
      'Plan respecté',
      planFollowed,
      closed.length,
      `${closed.length - planFollowed} trade(s) hors plan`,
    ),
    component(
      'Aucun revenge trade',
      withoutRevenge,
      closed.length,
      `${revenge.size} revenge trade(s) détecté(s)`,
    ),
    component(
      'Risque max respecté',
      riskCompliant,
      closed.length,
      missingStop > 0
        ? `${closed.length - riskCompliant} dépassement(s), dont ${missingStop} sans stop loss`
        : `${closed.length - riskCompliant} dépassement(s) de ${settings.maxRiskPercent}%`,
    ),
  ];

  const score =
    components.reduce((sum, c) => sum + c.ratio, 0) / components.length;

  return { score, components, tradeCount: closed.length };
}

// ---------------------------------------------------------------------------
// Emotion / result correlation
// ---------------------------------------------------------------------------

export interface EmotionPerf {
  emotion: string;
  count: number;
  pnl: number;
  winRate: number;
}

export function emotionPerformance(trades: Trade[]): EmotionPerf[] {
  const groups = new Map<string, Trade[]>();
  for (const trade of chronological(trades)) {
    const key = trade.emotionBefore || 'Non renseignée';
    const existing = groups.get(key);
    if (existing) existing.push(trade);
    else groups.set(key, [trade]);
  }

  return Array.from(groups.entries())
    .map(([emotion, group]) => {
      const pnl = group.reduce((sum, t) => sum + computeTradePnl(t), 0);
      const wins = group.filter((t) => computeTradePnl(t) > 0).length;
      return {
        emotion,
        count: group.length,
        pnl,
        winRate: (wins / group.length) * 100,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakInfo {
  currentType: 'win' | 'loss' | null;
  currentLength: number;
  longestWin: number;
  longestLoss: number;
}

/**
 * Consecutive wins/losses in chronological order. A breakeven trade (PnL
 * exactly 0) interrupts a streak without starting one of its own.
 */
export function computeStreaks(trades: Trade[]): StreakInfo {
  const ordered = chronological(trades);

  let longestWin = 0;
  let longestLoss = 0;
  let runType: 'win' | 'loss' | null = null;
  let runLength = 0;

  for (const trade of ordered) {
    const pnl = computeTradePnl(trade);
    const type = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : null;

    if (type === null) {
      runType = null;
      runLength = 0;
      continue;
    }

    if (type === runType) runLength += 1;
    else {
      runType = type;
      runLength = 1;
    }

    if (type === 'win') longestWin = Math.max(longestWin, runLength);
    else longestLoss = Math.max(longestLoss, runLength);
  }

  return {
    currentType: runLength > 0 ? runType : null,
    currentLength: runLength,
    longestWin,
    longestLoss,
  };
}

// ---------------------------------------------------------------------------
// Grouped comparisons
// ---------------------------------------------------------------------------

export interface GroupPerf {
  label: string;
  count: number;
  pnl: number;
  avgPnl: number;
  winRate: number;
}

function groupPerf(label: string, group: Trade[]): GroupPerf {
  const pnl = group.reduce((sum, t) => sum + computeTradePnl(t), 0);
  const wins = group.filter((t) => computeTradePnl(t) > 0).length;
  return {
    label,
    count: group.length,
    pnl,
    avgPnl: group.length > 0 ? pnl / group.length : 0,
    winRate: group.length > 0 ? (wins / group.length) * 100 : 0,
  };
}

export function planComparison(trades: Trade[]): { inPlan: GroupPerf; offPlan: GroupPerf } {
  const closed = chronological(trades);
  return {
    inPlan: groupPerf('Dans le plan', closed.filter((t) => t.followedPlan)),
    offPlan: groupPerf('Hors plan', closed.filter((t) => !t.followedPlan)),
  };
}

/**
 * First trade of each day vs every trade taken after it that day — discipline
 * tends to degrade as the session goes on (3.4.10).
 */
export function firstVsLaterTrades(trades: Trade[]): {
  first: GroupPerf;
  later: GroupPerf;
} {
  const ordered = chronological(trades);
  const seenDates = new Set<string>();
  const first: Trade[] = [];
  const later: Trade[] = [];

  for (const trade of ordered) {
    if (seenDates.has(trade.date)) later.push(trade);
    else {
      seenDates.add(trade.date);
      first.push(trade);
    }
  }

  return {
    first: groupPerf('Premier trade du jour', first),
    later: groupPerf('Trades suivants', later),
  };
}

// ---------------------------------------------------------------------------
// Recurring mistakes
// ---------------------------------------------------------------------------

export interface MistakeStat {
  mistake: MistakeType;
  count: number;
  /** Sum of the losses on trades carrying this tag (negative or zero). */
  lostPnl: number;
  trades: Trade[];
}

export function mistakeRanking(trades: Trade[]): MistakeStat[] {
  const groups = new Map<MistakeType, Trade[]>();

  for (const trade of chronological(trades)) {
    for (const mistake of trade.mistakeTypes ?? []) {
      const existing = groups.get(mistake);
      if (existing) existing.push(trade);
      else groups.set(mistake, [trade]);
    }
  }

  return Array.from(groups.entries())
    .map(([mistake, group]) => ({
      mistake,
      count: group.length,
      lostPnl: group.reduce((sum, t) => {
        const pnl = computeTradePnl(t);
        return pnl < 0 ? sum + pnl : sum;
      }, 0),
      trades: group,
    }))
    .sort((a, b) => a.lostPnl - b.lostPnl || b.count - a.count);
}
