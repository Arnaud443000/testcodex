export interface PersonalRule {
  id: string;
  label: string;
}

export interface Settings {
  /** Reference capital used to express per-trade risk as a % (3.3.12). */
  capital: number;
  /** Max risk allowed per trade, in % of capital. */
  maxRiskPercent: number;
  /** Consecutive losing trades in a day before the overtrading alert fires. */
  maxConsecutiveLosses: number;
  /** Cumulative daily loss, in % of capital, before the "stop for today" alert fires. */
  maxDailyLossPercent: number;
  /** Free-text rules the trader sets for themselves (2.4 / 3.6.9). */
  rules: PersonalRule[];
}

export const DEFAULT_SETTINGS: Settings = {
  capital: 10000,
  maxRiskPercent: 1,
  maxConsecutiveLosses: 3,
  maxDailyLossPercent: 3,
  rules: [],
};
