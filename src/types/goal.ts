export type GoalMetric = 'profit' | 'winRate' | 'tradeCount';

export interface Goal {
  id: string;
  /** undefined = objectif toutes comptes confondus. */
  accountId?: string;
  /** YYYY-MM */
  month: string;
  metric: GoalMetric;
  target: number;
}

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  profit: 'Profit net (€)',
  winRate: 'Win rate (%)',
  tradeCount: 'Nombre de trades',
};
