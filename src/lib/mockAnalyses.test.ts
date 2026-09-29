import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockAnalyses } from './mockBackend'
import type { TradeData } from '../types/trade'

/**
 * Journal F du test Rust `stats::analyses_tests` (résultats calculés à la main là-bas) :
 * le faux backend doit donner les mêmes chiffres, sinon les captures d'écran mentiraient.
 *
 * | # | jour (1er sept. = 0) | actif  | sens  | entrée → sortie | taille | SL  | frais | brut | net  | setup | type |
 * | 1 | 0  (mar. 1 sept.)    | EURUSD | long  | 100 → 110       | 10     | 95  | 2     | +100 | +98  | Alpha | système |
 * | 2 | 1  (mer. 2 sept.)    | EURUSD | short | 50 → 53         | 20     | 52  | 4     | −60  | −64  | Alpha | système |
 * | 3 | 6  (lun. 7 sept.)    | EURUSD | long  | 200 → 205       | 4      | 195 | 0     | +20  | +20  | Beta  | discrétionnaire |
 * | 4 | 7  (mar. 8 sept.)    | BTCUSD | long  | 20 → 26         | 50     | —   | 6     | +300 | +294 | Beta  | discrétionnaire |
 * | 5 | 13 (lun. 14 sept.)   | BTCUSD | long  | 10 → 9          | 36     | —   | 0     | −36  | −36  | Beta  | — |
 * | 6 | 14 (mar. 15 sept.)   | BTCUSD | long  | 30 → 27         | 10     | —   | −1    | −30  | −29  | —     | — |
 * | 7 | 30 (jeu. 1er oct.)   | XAUUSD | long  | 100 → 100       | 1      | —   | 1     | 0    | −1   | Alpha | système |
 * | 8 | 31 (ouvert)          | EURUSD | long  | 30 → ouvert     | 1      | —   | 0     |      |      | —     | — |
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const SEP_1 = 20_697 * DAY
let accountId = 0
let alpha = 0
let beta = 0
const symbolId: Record<string, number> = {}

async function add(symbol: string, direction: 'long' | 'short', entry: string, exit: string | null, size: string, sl: string | null, fees: string, day: number, setup: number | null, kind: TradeData['executionType'] = null, tz = 0) {
  await mock.createTrade({
    accountId, instrumentId: symbolId[symbol], direction, size, multiplier: '1', entryPrice: entry, exitPrice: exit,
    entryTime: SEP_1 + day * DAY + 10 * HOUR, exitTime: exit === null ? null : SEP_1 + day * DAY + 11 * HOUR,
    tzOffsetMin: tz, plannedSl: sl, fees, thesis: '', postMortem: '', tagIds: setup === null ? [] : [setup],
    emotions: [], ruleChecks: [], checklist: [], executionType: kind,
  })
}

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'F', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  for (const i of await mock.listInstruments()) symbolId[i.symbol] = i.id
  alpha = (await mock.createTag('setup', 'Alpha')).id
  beta = (await mock.createTag('setup', 'Beta')).id
  await add('EURUSD', 'long', '100', '110', '10', '95', '2', 0, alpha, 'system')
  await add('EURUSD', 'short', '50', '53', '20', '52', '4', 1, alpha, 'system')
  await add('EURUSD', 'long', '200', '205', '4', '195', '0', 6, beta, 'discretionary')
  await add('BTCUSD', 'long', '20', '26', '50', null, '6', 7, beta, 'discretionary')
  await add('BTCUSD', 'long', '10', '9', '36', null, '0', 13, beta)
  await add('BTCUSD', 'long', '30', '27', '10', null, '-1', 14, null)
  await add('XAUUSD', 'long', '100', '100', '1', null, '1', 30, alpha, 'system')
  await add('EURUSD', 'long', '30', null, '1', null, '0', 31, null)
  // Un dépôt et un retrait : jamais de la performance.
  await mock.createCashFlow({ accountId, kind: 'deposit', amount: '5000', occurredAt: SEP_1 + DAY, tzOffsetMin: 0, note: '' })
})

const q = () => ({ accountIds: [accountId] })
const close = (a: number | null | undefined, b: number) => expect(a).toBeCloseTo(b, 12)

describe('faux backend : analyses du lot 14 (journal F)', () => {
  it('par actif', async () => {
    const rows = await mockAnalyses.getAssetReport(q())
    expect(rows.map((r) => r.symbol)).toEqual(['BTCUSD', 'EURUSD', 'XAUUSD'])
    const [btc, eur, xau] = rows
    expect([eur.summary.tradeCount, eur.summary.grossPnl, eur.summary.fees, eur.summary.netPnl]).toEqual([3, '60', '6', '54'])
    close(eur.summary.winRate, 2 / 3)
    close(eur.summary.expectancyR, 1.36 / 3)
    close(eur.feesShareOfGross, 0.1)
    expect(eur.lowSample).toBe(true)
    expect([btc.summary.tradeCount, btc.summary.grossPnl, btc.summary.fees, btc.summary.netPnl]).toEqual([3, '234', '5', '229'])
    expect(btc.summary.expectancyR).toBeNull()
    close(btc.feesShareOfGross, 5 / 234)
    expect([xau.summary.tradeCount, xau.summary.lossCount, xau.summary.netPnl, xau.feesShareOfGross]).toEqual([1, 1, '-1', null])
    expect(eur.assetClass).toBe('forex')
  })

  it('par actif : fenêtre de période et aucun trade', async () => {
    const rows = await mockAnalyses.getAssetReport({ ...q(), from: SEP_1 + 7 * DAY })
    expect(rows.map((r) => [r.symbol, r.summary.tradeCount])).toEqual([['BTCUSD', 3], ['XAUUSD', 1]])
    expect(await mockAnalyses.getAssetReport({ ...q(), from: SEP_1 + 100 * DAY })).toEqual([])
  })

  it('frais par mois, courbe cumulée', async () => {
    const r = await mockAnalyses.getFeeReport(q(), 'month')
    expect([r.tradeCount, r.tradesWithFees, r.grossPnl, r.fees, r.netPnl]).toEqual([7, 5, '294', '12', '282'])
    close(r.feesShareOfGross, 12 / 294)
    expect(r.curve.map((p) => [p.cumulativeFees, p.cumulativeGrossPnl, p.cumulativeNetPnl])).toEqual([
      ['2', '100', '98'], ['6', '40', '34'], ['6', '60', '54'], ['12', '360', '348'], ['12', '324', '312'], ['11', '294', '283'], ['12', '294', '282'],
    ])
    expect(r.periods.map((p) => [p.key, p.tradeCount, p.grossPnl, p.fees, p.netPnl, p.cumulativeFees])).toEqual([
      ['2026-09', 6, '294', '11', '283', '11'],
      ['2026-10', 1, '0', '1', '-1', '12'],
    ])
    close(r.periods[0].feesShareOfGross, 11 / 294)
    expect(r.periods[1].feesShareOfGross).toBeNull()
  })

  it('frais par semaine (lundi) et par jour', async () => {
    const w = await mockAnalyses.getFeeReport(q(), 'week')
    expect(w.periods.map((p) => [p.key, p.tradeCount, p.grossPnl, p.fees, p.netPnl, p.cumulativeFees])).toEqual([
      ['2026-08-31', 2, '40', '6', '34', '6'],
      ['2026-09-07', 2, '320', '6', '314', '12'],
      ['2026-09-14', 2, '-66', '-1', '-65', '11'],
      ['2026-09-28', 1, '0', '1', '-1', '12'],
    ])
    close(w.periods[0].feesShareOfGross, 6 / 40)
    expect(w.periods[2].feesShareOfGross).toBeNull()
    const d = await mockAnalyses.getFeeReport(q(), 'day')
    expect(d.periods.map((p) => p.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-07', '2026-09-08', '2026-09-14', '2026-09-15', '2026-10-01'])
  })

  it('frais : aucun trade', async () => {
    const r = await mockAnalyses.getFeeReport({ ...q(), from: SEP_1 + 100 * DAY })
    expect([r.tradeCount, r.fees, r.feesShareOfGross, r.feesPerTrade, r.curve.length, r.periods.length]).toEqual([0, '0', null, null, 0, 0])
  })

  it('stratégies = tags setup, partition des trades', async () => {
    const rows = await mockAnalyses.getStrategyReport(q())
    expect(rows.map((r) => [r.tagId, r.name])).toEqual([[alpha, 'Alpha'], [beta, 'Beta'], [null, 'None']])
    const [a, b, none] = rows
    expect([a.summary.tradeCount, a.summary.netPnl, a.summary.grossPnl, a.summary.fees]).toEqual([3, '33', '40', '7'])
    close(a.summary.winRate, 1 / 3)
    close(a.shareOfTrades, 3 / 7)
    expect(a.curve.map((p) => [p.tradeId > 0, p.cumulativeNetPnl])).toEqual([[true, '98'], [true, '34'], [true, '33']])
    expect([b.summary.tradeCount, b.summary.netPnl]).toEqual([3, '278'])
    expect(b.curve.map((p) => p.cumulativeNetPnl)).toEqual(['20', '314', '278'])
    expect([none.summary.tradeCount, none.summary.netPnl, none.lowSample]).toEqual([1, '-29', true])
    expect(rows.reduce((n, r) => n + r.summary.tradeCount, 0)).toBe(7)
    expect(rows.every((r) => r.lowSample)).toBe(true)
  })

  it('système contre discrétionnaire : trop peu de trades pour comparer', async () => {
    const r = await mockAnalyses.getExecutionReport(q())
    expect([r.system.summary.tradeCount, r.system.summary.netPnl]).toEqual([3, '33'])
    expect([r.discretionary.summary.tradeCount, r.discretionary.summary.netPnl]).toEqual([2, '314'])
    expect([r.unclassified.summary.tradeCount, r.unclassified.summary.netPnl]).toEqual([2, '-65'])
    expect([r.comparable, r.winRateDelta, r.expectancyRDelta, r.avgNetPnlDelta]).toEqual([false, null, null, null])
  })

  it('système contre discrétionnaire : écarts chiffrés quand les deux côtés ont 5 trades (journal G)', async () => {
    const g = (await mock.createAccount({ name: 'G', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    const put = async (exit: string, kind: TradeData['executionType'], day: number) => {
      await mock.createTrade({
        accountId: g, instrumentId: symbolId.EURUSD, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: exit,
        entryTime: SEP_1 + day * DAY + 10 * HOUR, exitTime: SEP_1 + day * DAY + 11 * HOUR, tzOffsetMin: 0, plannedSl: '90', fees: '0',
        thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], executionType: kind,
      })
    }
    let day = 0
    for (const x of ['110', '110', '110', '95', '95']) await put(x, 'system', day++)
    for (const x of ['110', '95', '95', '95', '100']) await put(x, 'discretionary', day++)
    for (let i = 0; i < 3; i++) await put('120', null, day++)
    const r = await mockAnalyses.getExecutionReport({ accountIds: [g] })
    expect(r.comparable).toBe(true)
    close(r.system.summary.winRate, 0.6)
    close(r.system.summary.expectancyR, 0.4)
    close(r.discretionary.summary.winRate, 0.2)
    close(r.discretionary.summary.expectancyR, -0.1)
    close(r.winRateDelta, 0.4)
    close(r.expectancyRDelta, 0.5)
    expect(r.avgNetPnlDelta).toBe('5')
    expect([r.unclassified.summary.tradeCount, r.unclassified.summary.netPnl]).toEqual([3, '60'])
  })
})
