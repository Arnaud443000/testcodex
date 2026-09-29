import type { Tag, TradeView } from '../types/trade'

/** Données de test (jamais importées par l'application). */
export const TAGS: Tag[] = [
  { id: 1, kind: 'session', name: 'Asie', archived: false },
  { id: 2, kind: 'session', name: 'Londres', archived: false },
  { id: 3, kind: 'session', name: 'New York', archived: false },
  { id: 4, kind: 'timeframe', name: 'M15', archived: false },
  { id: 5, kind: 'setup', name: 'Breakout NY', archived: false },
  { id: 6, kind: 'setup', name: 'Mean reversion', archived: false },
  { id: 7, kind: 'market_condition', name: 'Tendance', archived: false },
  { id: 8, kind: 'emotion', name: 'Calme', archived: false },
  { id: 9, kind: 'mistake', name: 'Early exit', archived: false },
]

export function trade(over: Partial<TradeView> & { id: number }): TradeView {
  return {
    createdAt: '',
    updatedAt: '',
    accountId: 1,
    instrumentId: 1,
    direction: 'long',
    size: '1',
    entryPrice: '100',
    exitPrice: '110',
    entryTime: 1_000_000,
    exitTime: 1_600_000,
    tzOffsetMin: 0,
    fees: '0',
    thesis: 'ok',
    postMortem: '',
    tagIds: [],
    emotions: [{ moment: 'before', tagId: 8 }],
    ruleChecks: [],
    checklist: [],
    symbol: 'EURUSD',
    assetClass: 'forex',
    accountName: 'Main',
    currency: 'USD',
    figures: { grossPnl: '10', fees: '0', netPnl: '10', initialRisk: null, rMultiple: null, plannedRewardRisk: null, outcome: 'win' },
    initialRisk: null,
    durationMs: 600_000,
    opportunityCost: null,
    ...over,
  }
}

export function withPnl(id: number, netPnl: string, over: Partial<TradeView> = {}): TradeView {
  const n = Number(netPnl)
  return trade({
    id,
    figures: {
      grossPnl: netPnl,
      fees: '0',
      netPnl,
      initialRisk: null,
      rMultiple: null,
      plannedRewardRisk: null,
      outcome: n > 0 ? 'win' : n < 0 ? 'loss' : 'breakeven',
    },
    ...over,
  })
}
