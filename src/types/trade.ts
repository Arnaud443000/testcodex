export type TradeSide = 'long' | 'short';
export type TradeType = 'system' | 'discretionary';

export const MISTAKE_TYPES = [
  'Sortie prématurée',
  'Overtrading',
  'Mauvaise gestion du risque',
  'Pas de plan',
  'Revenge trade',
  'Autre',
] as const;

export type MistakeType = (typeof MISTAKE_TYPES)[number];

export interface Trade {
  id: string;
  accountId: string;
  asset: string;
  side: TradeSide;
  entryPrice: number;
  exitPrice: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
  fees: number;
  date: string;
  session: string;
  setup: string;
  timeframe: string;
  marketCondition: string;
  confidenceLevel: number;
  emotionBefore: string;
  emotionAfter: string;
  followedPlan: boolean;
  thesis: string;
  postMortem: string;
  executionQuality: number;
  starRating: number;
  screenshot?: string;
  closed: boolean;
  tradeType?: TradeType;
  entryTime?: string;
  exitTime?: string;
  /** Price observed after exit, filled in later to measure opportunity cost (3.3.18). */
  priceAfterExit?: number;
  mistakeTypes?: MistakeType[];
  /** Personal rule id -> respected, as ticked on the pre-trade checklist (2.4). */
  ruleCompliance?: Record<string, boolean>;
}
