import type { Decimal } from './money'
import type { Direction, Outcome, TradeView } from './trade'

/** Miroir de pulse-core::replay. */
export type ReplayOutcome = 'win' | 'loss' | 'breakeven' | 'open'

export interface ReplayFilter {
  accountIds?: number[]
  minRating?: number | null
  maxRating?: number | null
  unratedOnly?: boolean
  outcome?: ReplayOutcome | null
  instrumentId?: number | null
  withScreenshot?: boolean
  withNotes?: boolean
}

export interface ReplayItem {
  tradeId: number
  symbol: string
  direction: Direction
  currency: string
  entryTime: number
  exitTime: number | null
  netPnl: Decimal | null
  rMultiple: number | null
  outcome: Outcome | null
  rating: number | null
  hasScreenshot: boolean
  hasThesis: boolean
  hasPostMortem: boolean
}

export type LevelKind = 'planned_tp' | 'actual_tp' | 'price_after_exit' | 'exit' | 'entry' | 'actual_sl' | 'planned_sl'

export interface Level {
  kind: LevelKind
  price: Decimal
  /** Distance à l'entrée, dans le sens du trade, en multiples du risque prévu ; null sans stop prévu. Prix seul : frais exclus. */
  r: number | null
}

export interface ReplayCard {
  trade: TradeView
  /** Prix le plus haut d'abord. */
  levels: Level[]
}
