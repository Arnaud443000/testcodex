export type TradeSide = 'long' | 'short';
export type TradeType = 'system' | 'discretionary';

export interface Trade {
  id: string;
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
}
