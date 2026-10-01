import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockTradeCard } from './mockBackend'
import type { TradeData } from '../types/trade'

/** Même journal que `stats/trade_card.rs` (calculé à la main) : capital 10 000, multiplicateur 1. */
let instrumentId = 0
beforeAll(async () => {
  instrumentId = (await mock.listInstruments())[0].id
})

const add = async (accountId: number, d: Partial<TradeData>) =>
  (await mock.createTrade({
    accountId, instrumentId, direction: 'long', size: '10', multiplier: '1', entryPrice: '100', exitPrice: '110',
    entryTime: 1_800_000_000_000, exitTime: 1_800_003_600_000, tzOffsetMin: 0, plannedSl: '95', fees: '0',
    thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], ...d,
  } as TradeData)).id

describe('faux backend : chiffres de la carte', () => {
  it('R, rendement et P&L d’un trade clôturé ; « — » pour un trade ouvert ; jamais de solde', async () => {
    const acc = (await mock.createAccount({ name: 'Carte', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    const t1 = await add(acc, {}) // +100, risque 50 → R +2, 100 / 10 000 = 1 %
    const open = await add(acc, { exitPrice: null, exitTime: null, entryTime: 1_800_100_000_000 })
    const a = await mockTradeCard.getTradeCardFigures(t1)
    expect(a.closed).toBe(true)
    expect(a.rMultiple).toBe(2)
    expect(a.returnFraction).toBeCloseTo(0.01, 12)
    expect(a.netPnl).toBe('100')
    expect(Object.keys(a).sort()).toEqual(['closed', 'netPnl', 'outcome', 'rMultiple', 'returnFraction', 'tradeId'])
    const o = await mockTradeCard.getTradeCardFigures(open)
    expect(o).toEqual({ tradeId: open, closed: false, outcome: null, rMultiple: null, returnFraction: null, netPnl: null })
    await expect(mockTradeCard.getTradeCardFigures(99_999)).rejects.toThrow()
  })
})
