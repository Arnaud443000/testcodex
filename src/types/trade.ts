export type TradeSide = 'long' | 'short';

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
}
