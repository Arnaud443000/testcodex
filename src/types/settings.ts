export interface Settings {
  /** Reference capital used to express per-trade risk as a % (3.3.12). */
  capital: number;
  /** Max risk allowed per trade, in % of capital. */
  maxRiskPercent: number;
}

export const DEFAULT_SETTINGS: Settings = {
  capital: 10000,
  maxRiskPercent: 1,
};
