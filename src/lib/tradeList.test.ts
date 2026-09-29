import { describe, expect, it } from 'vitest'
import { trade, withPnl } from './fixtures'
import { NO_FILTERS, applyFilters, hasActiveFilters, isIncomplete, sortTrades, tagOfKind } from './tradeList'
import { TAGS } from './fixtures'

const ids = (l: { id: number }[]) => l.map((t) => t.id)

describe('applyFilters', () => {
  const list = [
    withPnl(1, '50', { instrumentId: 1, tagIds: [5, 3] }),
    withPnl(2, '-20', { instrumentId: 2, symbol: 'NAS100', tagIds: [6, 3] }),
    withPnl(3, '0', { instrumentId: 1, tagIds: [5, 2] }),
    trade({ id: 4, figures: null, exitPrice: null, exitTime: null, durationMs: null, tagIds: [5] }),
  ]
  it('ne filtre rien sans critère', () => {
    expect(ids(applyFilters(list, NO_FILTERS))).toEqual([1, 2, 3, 4])
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
  })
  it('filtre par actif, setup et session', () => {
    expect(ids(applyFilters(list, { ...NO_FILTERS, instrumentId: 1 }))).toEqual([1, 3, 4])
    expect(ids(applyFilters(list, { ...NO_FILTERS, setupTagId: 5 }))).toEqual([1, 3, 4])
    expect(ids(applyFilters(list, { ...NO_FILTERS, sessionTagId: 3 }))).toEqual([1, 2])
  })
  it('filtre par résultat, y compris breakeven et trades ouverts', () => {
    expect(ids(applyFilters(list, { ...NO_FILTERS, outcome: 'win' }))).toEqual([1])
    expect(ids(applyFilters(list, { ...NO_FILTERS, outcome: 'loss' }))).toEqual([2])
    expect(ids(applyFilters(list, { ...NO_FILTERS, outcome: 'breakeven' }))).toEqual([3])
    expect(ids(applyFilters(list, { ...NO_FILTERS, outcome: 'open' }))).toEqual([4])
  })
  it('combine les critères', () => {
    expect(ids(applyFilters(list, { ...NO_FILTERS, instrumentId: 1, outcome: 'win', setupTagId: 5 }))).toEqual([1])
    expect(applyFilters(list, { ...NO_FILTERS, instrumentId: 2, outcome: 'win' })).toEqual([])
  })
})

describe('sortTrades', () => {
  it('trie le P&L en décimaux exacts, pas en flottants', () => {
    const list = [
      withPnl(1, '90071992547409931.25'),
      withPnl(2, '90071992547409931.24'),
      withPnl(3, '-5'),
      withPnl(4, '1000'),
    ]
    expect(ids(sortTrades(list, 'pnl', 'desc'))).toEqual([1, 2, 4, 3])
    expect(ids(sortTrades(list, 'pnl', 'asc'))).toEqual([3, 4, 2, 1])
  })
  it('classe toujours en dernier les valeurs absentes (trade ouvert)', () => {
    const open = trade({ id: 9, figures: null })
    const list = [open, withPnl(1, '10'), withPnl(2, '-10')]
    expect(ids(sortTrades(list, 'pnl', 'desc'))).toEqual([1, 2, 9])
    expect(ids(sortTrades(list, 'pnl', 'asc'))).toEqual([2, 1, 9])
  })
  it('trie par date, actif et durée', () => {
    const list = [
      trade({ id: 1, entryTime: 300, symbol: 'nas100', durationMs: 5 }),
      trade({ id: 2, entryTime: 100, symbol: 'BTCUSD', durationMs: 50 }),
      trade({ id: 3, entryTime: 200, symbol: 'EURUSD', durationMs: null }),
    ]
    expect(ids(sortTrades(list, 'date', 'desc'))).toEqual([1, 3, 2])
    expect(ids(sortTrades(list, 'symbol', 'asc'))).toEqual([2, 3, 1])
    expect(ids(sortTrades(list, 'duration', 'desc'))).toEqual([2, 1, 3])
  })
  it('trie par R avec les trades sans stop en dernier', () => {
    const r = (id: number, v: number | null) =>
      trade({ id, figures: { grossPnl: '1', fees: '0', netPnl: '1', initialRisk: null, rMultiple: v, plannedRewardRisk: null, outcome: 'win' } })
    expect(ids(sortTrades([r(1, null), r(2, -1), r(3, 2.5)], 'r', 'desc'))).toEqual([3, 2, 1])
  })
  it('ne modifie pas la liste d’origine', () => {
    const list = [withPnl(1, '1'), withPnl(2, '2')]
    sortTrades(list, 'pnl', 'desc')
    expect(ids(list)).toEqual([1, 2])
  })
})

describe('isIncomplete et tagOfKind', () => {
  it('un trade sans thèse ou sans émotion est à compléter', () => {
    expect(isIncomplete(trade({ id: 1 }))).toBe(false)
    expect(isIncomplete(trade({ id: 1, thesis: '  ' }))).toBe(true)
    expect(isIncomplete(trade({ id: 1, emotions: [] }))).toBe(true)
  })
  it('retrouve le setup et la session d’un trade', () => {
    const t = trade({ id: 1, tagIds: [5, 3, 9] })
    expect(tagOfKind(t, TAGS, 'setup')?.name).toBe('Breakout NY')
    expect(tagOfKind(t, TAGS, 'session')?.name).toBe('New York')
    expect(tagOfKind(t, TAGS, 'timeframe')).toBeUndefined()
  })
})
