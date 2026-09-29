import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockAnalysesMore } from './mockBackend'
import type { TradeData } from '../types/trade'

/**
 * Journaux K à N du test Rust `stats::analyses_tests` (résultats calculés à la main là-bas) :
 * le faux backend doit donner les mêmes chiffres, sinon les captures d'écran mentiraient.
 *
 * Journal K (coût d'opportunité) — capital 10 000, multiplicateur 1, sans frais, un trade par jour depuis le 1er sept. 2026 :
 * | # | sens  | entrée → sortie | taille | TP  | après | mouvement après sortie | laissé sur la table (plafonné au TP) |
 * | 1 | long  | 100 → 105       | 10     | 110 | 112   | +70                    | 50                                    |
 * | 2 | long  | 200 → 204       | 5      | 210 | 206   | +10                    | 10                                    |
 * | 3 | short | 50 → 48         | 20     | 45  | 44    | +80                    | 60                                    |
 * | 4 | long  | 30 → 28         | 10     | 35  | 25    | −30                    | 0                                     |
 * | 5 | long  | 10 → 12         | 100    | 11  | 13    | +100                   | 0 (sorti au-delà du TP)               |
 * | 6 | long  | 20 → 21         | 1      | —   | 25    | exclu : pas de TP                                              |
 * | 7 | long  | 40 → 41         | 1      | 45  | —     | exclu : pas de prix après sortie                               |
 * | 8 | short | 60 → 58         | 1      | 65  | 57    | exclu : TP d'un short au-dessus de l'entrée = invalide         |
 * | 9 | long  | 30 → ouvert     | 1      | 35  | 40    | ouvert                                                         |
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const SEP_1 = 20_697 * DAY
let accountId = 0
let instrumentId = 0

async function add(direction: 'long' | 'short', entry: string, exit: string | null, size: string, day: number, tp: string | null, after: string | null, fees = '0') {
  await mock.createTrade({
    accountId, instrumentId, direction, size, multiplier: '1', entryPrice: entry, exitPrice: exit,
    entryTime: SEP_1 + day * DAY + 10 * HOUR, exitTime: exit === null ? null : SEP_1 + day * DAY + 11 * HOUR,
    tzOffsetMin: 0, plannedSl: null, plannedTp: tp, priceAfterExit: after, fees, thesis: '', postMortem: '', tagIds: [],
    emotions: [], ruleChecks: [], checklist: [], executionType: null,
  } as TradeData)
}

const q = () => ({ accountIds: [accountId] })
const close = (a: number | null | undefined, b: number) => expect(a).toBeCloseTo(b, 12)

describe('faux backend : coût d’opportunité (journal K)', () => {
  beforeAll(async () => {
    accountId = (await mock.createAccount({ name: 'K', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    instrumentId = (await mock.listInstruments())[0].id
    await add('long', '100', '105', '10', 0, '110', '112')
    await add('long', '200', '204', '5', 1, '210', '206')
    await add('short', '50', '48', '20', 2, '45', '44')
    await add('long', '30', '28', '10', 3, '35', '25')
    await add('long', '10', '12', '100', 4, '11', '13')
    await add('long', '20', '21', '1', 5, null, '25')
    await add('long', '40', '41', '1', 6, '45', null)
    await add('short', '60', '58', '1', 7, '65', '57')
    await add('long', '30', null, '1', 8, '35', '40')
  })

  it('journal K complet', async () => {
    const r = await mockAnalysesMore.getOpportunityReport(q())
    expect([r.tradeCount, r.eligibleCount, r.excludedCount, r.withoutTargetCount, r.withoutPriceAfterCount]).toEqual([8, 5, 3, 2, 1])
    expect(r.lowSample).toBe(false)
    expect([r.totalLeftOnTable, r.leftCount, r.leftPerEarlyExit]).toEqual(['120', 3, '40'])
    expect([r.avoidedCount, r.totalAvoided, r.netPnlOfEligible]).toEqual([1, '30', '290'])
    expect(r.trades.map((t) => t.tradeId)).toHaveLength(5)
    expect(r.trades.map((t) => t.moveAfterExit)).toEqual(['80', '70', '10', '-30', '100'])
    expect(r.trades.map((t) => t.leftOnTable)).toEqual(['60', '50', '10', '0', '0'])
  })

  it('période courte : échantillon faible ; aucun trade ; aucune donnée', async () => {
    const two = await mockAnalysesMore.getOpportunityReport({ ...q(), to: SEP_1 + 2 * DAY })
    expect([two.tradeCount, two.eligibleCount, two.lowSample, two.totalLeftOnTable, two.leftPerEarlyExit]).toEqual([2, 2, true, '60', '30'])
    const one = await mockAnalysesMore.getOpportunityReport({ ...q(), from: SEP_1, to: SEP_1 + DAY })
    expect([one.eligibleCount, one.totalLeftOnTable, one.leftCount, one.leftPerEarlyExit]).toEqual([1, '50', 1, '50'])
    const none = await mockAnalysesMore.getOpportunityReport({ ...q(), from: SEP_1 + 100 * DAY })
    expect([none.tradeCount, none.eligibleCount, none.totalLeftOnTable, none.leftPerEarlyExit, none.trades]).toEqual([0, 0, '0', null, []])
  })
})

/**
 * Journal L (comparaison avec l'an dernier) — capital 10 000, multiplicateur 1, taille 1, sans frais, longs entrés à 10:00 et sortis à 11:00 UTC.
 * « Aujourd'hui » = mar. 29 sept. 2026 12:00 UTC, période 1M : fenêtre [31 août 2026, 30 sept. 2026) et, un an plus tôt, [31 août 2025, 30 sept. 2025).
 * | 1 | 2 sept. 2026  | 100 → 110 | +10 | cette année |
 * | 2 | 10 sept. 2026 | 100 → 95  | −5  | cette année |
 * | 3 | 20 sept. 2026 | 50 → 60   | +10 | cette année |
 * | 4 | 30 août 2025  | 10 → 30   | +20 | avant la fenêtre de l'an dernier |
 * | 5 | 5 sept. 2025  | 100 → 104 | +4  | an dernier |
 * | 6 | 15 sept. 2025 | 100 → 90  | −10 | an dernier |
 * | 7 | 25 sept. 2025 | 20 → 22   | +2  | an dernier |
 * | 8 | 30 sept. 2025 | 10 → 11   | +1  | après la fenêtre de l'an dernier (fin exclue) |
 * Cette année : +15, 3 trades, réussite 2/3, facteur de profit 4, drawdown max 5.
 * An dernier : −4, 3 trades, réussite 2/3, facteur de profit 0,6, drawdown max 10.
 * Écarts : trades 0, net +19, net % 4,75, réussite 0, facteur de profit +3,4, drawdown −5.
 */
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

describe('faux backend : comparaison avec l’an dernier (journal L)', () => {
  let acc = 0
  let ins = 0
  const add = async (y: number, m: number, d: number, entry: string, exit: string) => {
    await mock.createTrade({
      accountId: acc, instrumentId: ins, direction: 'long', size: '1', multiplier: '1', entryPrice: entry, exitPrice: exit,
      entryTime: utc(y, m, d) + 10 * HOUR, exitTime: utc(y, m, d) + 11 * HOUR, tzOffsetMin: 0, plannedSl: null, fees: '0', thesis: '',
      postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], executionType: null,
    } as TradeData)
  }
  const now = utc(2026, 9, 29) + 12 * HOUR
  const yq = (period: 'day' | 'month' | 'all', accountIds = [acc], at = now) => ({ accountIds, period, nowMs: at, tzOffsetMin: 0 })

  beforeAll(async () => {
    acc = (await mock.createAccount({ name: 'L', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    ins = (await mock.listInstruments())[0].id
    await add(2026, 9, 2, '100', '110')
    await add(2026, 9, 10, '100', '95')
    await add(2026, 9, 20, '50', '60')
    await add(2025, 8, 30, '10', '30')
    await add(2025, 9, 5, '100', '104')
    await add(2025, 9, 15, '100', '90')
    await add(2025, 9, 25, '20', '22')
    await add(2025, 9, 30, '10', '11')
    await mock.createCashFlow({ accountId: acc, kind: 'deposit', amount: '5000', occurredAt: utc(2025, 9, 10), tzOffsetMin: 0, note: '' })
  })

  it('journal L : fenêtres, chiffres et écarts', async () => {
    const r = await mockAnalysesMore.getYearComparison(yq('month'))
    expect([r.available, r.from, r.to, r.previousFrom, r.previousTo]).toEqual([true, utc(2026, 8, 31), utc(2026, 9, 30), utc(2025, 8, 31), utc(2025, 9, 30)])
    expect([r.current.tradeCount, r.current.netPnl, r.previous!.tradeCount, r.previous!.netPnl]).toEqual([3, '15', 3, '-4'])
    close(r.current.winRate, 2 / 3)
    close(r.previous!.profitFactor, 0.6)
    expect([r.current.maxDrawdown, r.previous!.maxDrawdown]).toEqual(['5', '10'])
    expect([r.currentLowSample, r.previousLowSample, r.previousEmpty, r.previousReason]).toEqual([true, true, false, null])
    const c = r.comparison!
    expect([c.tradeCount, c.netPnl, c.maxDrawdown]).toEqual([0, '19', '-5'])
    close(c.netPnlPct, 4.75)
    close(c.winRate, 0)
    close(c.profitFactor, 3.4)
    expect(c.expectancyR).toBeNull()
  })

  it('« Tout » n’a pas d’an dernier ; une journée sans trade ; l’an dernier vide', async () => {
    const all = await mockAnalysesMore.getYearComparison(yq('all'))
    expect([all.available, all.previous, all.comparison, all.current.tradeCount]).toEqual([false, null, null, 8])
    const day = await mockAnalysesMore.getYearComparison(yq('day'))
    expect([day.currentEmpty, day.previousEmpty, day.previousReason, day.comparison]).toEqual([true, true, 'noTrades', null])
    // Compte sans aucun trade avant cette année : l'historique est trop court.
    const other = (await mock.createAccount({ name: 'L2', kind: 'personal', broker: '', currency: 'USD', initialCapital: '100' })).id
    await mock.createTrade({
      accountId: other, instrumentId: ins, direction: 'long', size: '1', multiplier: '1', entryPrice: '1', exitPrice: '2', entryTime: utc(2026, 9, 2), exitTime: utc(2026, 9, 2) + HOUR,
      tzOffsetMin: 0, plannedSl: null, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], executionType: null,
    } as TradeData)
    const short = await mockAnalysesMore.getYearComparison(yq('month', [other]))
    expect([short.previousEmpty, short.previousReason, short.comparison, short.current.tradeCount]).toEqual([true, 'historyTooShort', null, 1])
  })

  it('29 février : l’an dernier commence le 28 février ; un dépôt n’est pas de la performance', async () => {
    const at = utc(2028, 2, 29) + 12 * HOUR
    const r = await mockAnalysesMore.getYearComparison(yq('day', [acc], at))
    expect([r.previousFrom, r.previousTo, r.from, r.to]).toEqual([utc(2027, 2, 28), utc(2027, 3, 1), utc(2028, 2, 29), utc(2028, 3, 1)])
    expect([r.current.tradeCount, r.current.netPnl]).toEqual([0, '0'])
  })
})
