import { describe, expect, it } from 'vitest'
import { feePeriodLabel, formatFee, formatFeeRounded, formatProfitFactor, instrumentLink, parseIdParam, setupLink, sortAssets, sortStrategies, toCurve } from './analysesView'
import type { AssetRow, StrategyRow, Summary } from '../types/stats'

const summary = (over: Partial<Summary>): Summary => ({
  tradeCount: 1, winCount: 0, lossCount: 0, breakevenCount: 0, grossPnl: '0', fees: '0', netPnl: '0', totalGains: '0', totalLosses: '0',
  returnPct: null, winRate: null, avgWin: null, avgLoss: null, avgWinLossRatio: null, profitFactor: null, expectancyR: null, rTradeCount: 0,
  avgNetPnl: null, sharpe: null, maxDrawdown: '0', maxDrawdownPct: null, currentDrawdown: '0', currentDrawdownPct: null, ...over,
})
const asset = (id: number, symbol: string, over: Partial<Summary>, share: number | null = null): AssetRow => ({
  instrumentId: id, symbol, assetClass: 'forex', summary: summary(over), feesShareOfGross: share, lowSample: false,
})

describe('tri des lignes déjà calculées', () => {
  const rows = [
    asset(1, 'EURUSD', { netPnl: '54', expectancyR: 0.45, fees: '6' }, 0.1),
    asset(2, 'BTCUSD', { netPnl: '229', expectancyR: null, fees: '5' }, 0.02),
    asset(3, 'XAUUSD', { netPnl: '-1', expectancyR: -0.2, fees: '1' }, null),
    asset(4, 'ES', { netPnl: '1000.5', expectancyR: 1.2, fees: '10' }, 0.3),
  ]
  it('compare les montants comme des décimaux exacts, pas comme du texte', () => {
    expect(sortAssets(rows, 'netPnl', 'desc').map((r) => r.symbol)).toEqual(['ES', 'BTCUSD', 'EURUSD', 'XAUUSD'])
    expect(sortAssets(rows, 'netPnl', 'asc').map((r) => r.symbol)).toEqual(['XAUUSD', 'EURUSD', 'BTCUSD', 'ES'])
    expect(sortAssets(rows, 'fees', 'desc').map((r) => r.symbol)).toEqual(['ES', 'EURUSD', 'BTCUSD', 'XAUUSD'])
  })
  it('garde les valeurs absentes en dernier, dans les deux sens', () => {
    expect(sortAssets(rows, 'avgR', 'desc').map((r) => r.symbol)).toEqual(['ES', 'EURUSD', 'XAUUSD', 'BTCUSD'])
    expect(sortAssets(rows, 'avgR', 'asc').map((r) => r.symbol)).toEqual(['XAUUSD', 'EURUSD', 'ES', 'BTCUSD'])
    expect(sortAssets(rows, 'feesShare', 'asc').map((r) => r.symbol)).toEqual(['BTCUSD', 'EURUSD', 'ES', 'XAUUSD'])
  })
  it('trie les symboles par ordre alphabétique et ne modifie pas la liste d’origine', () => {
    const before = rows.map((r) => r.symbol)
    expect(sortAssets(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['BTCUSD', 'ES', 'EURUSD', 'XAUUSD'])
    expect(rows.map((r) => r.symbol)).toEqual(before)
    expect(sortAssets([], 'netPnl', 'desc')).toEqual([])
  })
  it('trie les stratégies (profit factor absent en dernier, drawdown exact)', () => {
    const strat = (name: string, over: Partial<Summary>): StrategyRow => ({ tagId: 1, name, summary: summary(over), shareOfTrades: 0.5, lowSample: false, curve: [] })
    const list = [strat('A', { profitFactor: 2, maxDrawdown: '9.5' }), strat('B', { profitFactor: null, maxDrawdown: '10' }), strat('C', { profitFactor: 0.5, maxDrawdown: '100' })]
    expect(sortStrategies(list, 'profitFactor', 'desc').map((r) => r.name)).toEqual(['A', 'C', 'B'])
    expect(sortStrategies(list, 'maxDrawdown', 'asc').map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })
})

describe('liens et paramètres', () => {
  it('construit les liens vers la liste des trades', () => {
    expect(instrumentLink(12)).toBe('/trades?instrument=12')
    expect(setupLink(7)).toBe('/trades?setup=7')
  })
  it('ignore un paramètre mal formé', () => {
    expect(parseIdParam('12')).toBe(12)
    expect(parseIdParam(null)).toBeNull()
    for (const bad of ['', 'abc', '-1', '1.5', '1e3', '12 ', '99999999999999999999']) expect(parseIdParam(bad)).toBeNull()
  })
})

describe('libellés', () => {
  const week = (d: string) => `Semaine du ${d}`
  it('écrit les périodes en français', () => {
    expect(feePeriodLabel('2026-09', 'month', week)).toBe('sept. 2026')
    expect(feePeriodLabel('2026-09-01', 'day', week)).toBe('1 sept. 2026')
    expect(feePeriodLabel('2026-08-31', 'week', week)).toBe('Semaine du 31 août 2026')
  })
  it('écrit un coût sans signe et un crédit avec un vrai signe moins', () => {
    expect(formatFee('12', 'USD')).toMatch(/^12,00\s\$$/)
    expect(formatFee('0', 'USD')).toMatch(/^0,00\s\$$/)
    expect(formatFee('-1', 'USD')).toMatch(/^−1,00\s\$$/)
  })
  it('arrondit les frais agrégés au centime sans jamais écrire « −0,00 »', () => {
    expect(formatFeeRounded('851.9423', 'USD')).toMatch(/^851,94\s\$$/)
    expect(formatFeeRounded('-0.004', 'USD')).toMatch(/^0,00\s\$$/)
    expect(formatFeeRounded('-1.005', 'USD')).toMatch(/^−1,01\s\$$/)
  })
  it('prépare des points à dessiner sans rien recalculer', () => {
    expect(toCurve([{ time: 1, v: '2.5' }, { time: 2, v: '-1' }], (p) => p.v)).toEqual([{ time: 1, value: 2.5 }, { time: 2, value: -1 }])
  })
})

describe('facteur de profit', () => {
  it('affiche la valeur, ∞ sans aucune perte, — sans aucun trade', () => {
    expect(formatProfitFactor({ profitFactor: 1.84375, totalGains: '118', totalLosses: '64' })).toBe('1,84')
    expect(formatProfitFactor({ profitFactor: null, totalGains: '50', totalLosses: '0' })).toBe('∞')
    expect(formatProfitFactor({ profitFactor: null, totalGains: '0', totalLosses: '0' })).toBe('—')
    expect(formatProfitFactor({ profitFactor: 0, totalGains: '0', totalLosses: '1' })).toBe('0,00')
  })
})
