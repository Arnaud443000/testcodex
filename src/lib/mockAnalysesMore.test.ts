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
