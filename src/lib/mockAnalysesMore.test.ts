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

/**
 * Journal M (temps en position) — capital 10 000, multiplicateur 1, taille 1, sans frais, longs entrés à 10:00 le jour (# − 1).
 * L'issue vient du prix de sortie (100 → 110 gagnant, 100 → 90 perdant, 100 → 100 à plat).
 * | 1–5  | gagnants | 60, 120, 30, 240, 90 min → moyenne 108, médiane 90 |
 * | 6–10 | perdants | 20, 40, 10, 50, 30 min   → moyenne 30, médiane 30  |
 * | 11   | à plat   | 100 min                                             |
 * | 12   | ouvert (sans sortie)                                            |
 * Ratio des moyennes 108 / 30 = 3,6 ; des médianes 90 / 30 = 3. (La sortie avant l'entrée du test Rust est refusée dès la saisie par le faux backend.)
 */
describe('faux backend : temps en position (journal M)', () => {
  let acc = 0
  let ins = 0
  const add = async (n: number, exit: string | null, minutes: number, account = acc) => {
    const entry = SEP_1 + (n - 1) * DAY + 10 * HOUR
    await mock.createTrade({
      accountId: account, instrumentId: ins, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: exit,
      entryTime: entry, exitTime: exit === null ? null : entry + minutes * 60_000, tzOffsetMin: 0, plannedSl: null, fees: '0', thesis: '',
      postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], executionType: null,
    } as TradeData)
  }
  const mins = (v: number | null) => (v === null ? null : v / 60_000)

  beforeAll(async () => {
    acc = (await mock.createAccount({ name: 'M', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    ins = (await mock.listInstruments())[0].id
    for (const [i, m] of [60, 120, 30, 240, 90].entries()) await add(i + 1, '110', m)
    for (const [i, m] of [20, 40, 10, 50, 30].entries()) await add(i + 6, '90', m)
    await add(11, '100', 100)
    await add(12, null, 0)
  })

  it('journal M complet', async () => {
    const r = await mockAnalysesMore.getDurationReport({ accountIds: [acc] })
    expect([r.tradeCount, r.measuredCount, r.openTradeCount, r.invalidCount]).toEqual([11, 11, 1, 0])
    expect([r.winners.tradeCount, r.losers.tradeCount, r.breakevens.tradeCount]).toEqual([5, 5, 1])
    expect([mins(r.winners.avgMs), mins(r.winners.medianMs), mins(r.losers.avgMs), mins(r.losers.medianMs)]).toEqual([108, 90, 30, 30])
    expect([r.comparable, r.avgRatio, r.medianRatio]).toEqual([true, 3.6, 3])
    expect([mins(r.breakevens.avgMs), r.breakevens.lowSample]).toEqual([100, true])
  })

  it('petits échantillons : pas de ratio ; un seul trade ; aucun trade', async () => {
    const r = await mockAnalysesMore.getDurationReport({ accountIds: [acc], to: SEP_1 + 3 * DAY })
    expect([r.winners.tradeCount, r.losers.tradeCount, r.comparable, mins(r.winners.avgMs), mins(r.winners.medianMs)]).toEqual([3, 0, false, 70, 60])
    expect([r.losers.avgMs, r.losers.medianMs, r.avgRatio, r.medianRatio]).toEqual([null, null, null, null])
    const solo = (await mock.createAccount({ name: 'M2', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10' })).id
    await add(1, '110', 45, solo)
    const one = await mockAnalysesMore.getDurationReport({ accountIds: [solo] })
    expect([one.tradeCount, one.winners.tradeCount, mins(one.winners.medianMs), one.avgRatio]).toEqual([1, 1, 45, null])
    const none = await mockAnalysesMore.getDurationReport({ accountIds: [acc], from: SEP_1 + 100 * DAY })
    expect([none.tradeCount, none.winners.avgMs, none.avgRatio]).toEqual([0, null, null])
  })
})

/**
 * Journal N (scaling du capital) — capital 10 000, multiplicateur 1, long à 100 avec stop 90 (risque = 10 × taille), un trade par jour
 * depuis le 1er sept. 2026, sortie au prix d'entrée (à plat : aucun P&L, le solde ne bouge qu'avec les dépôts).
 * N1 : trades 1–5 taille 10 (risque 100 = 1 %), 6–10 taille 12 (1,2 %) → +20 % pile → surdimensionné ; solde constant.
 * N2 : taille 10 partout, dépôt de 10 000 avant le trade 6 → 1 % puis 0,5 % (−50 %) → sous-dimensionné ; capital +100 %.
 * N3 : comme N2 avec taille 20 pour 6–10 (200 sur 20 000 = 1 %) → stable ; risque en argent +100 %.
 * N4 : 11 trades, le 6e (milieu) en taille 100 → ignoré → stable.
 */
describe('faux backend : scaling du capital (journal N)', () => {
  let ins = 0
  const account = async (name: string, sizes: number[], deposit = false, sl: string | null = '90') => {
    const id = (await mock.createAccount({ name, kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    for (const [i, s] of sizes.entries()) {
      const entry = SEP_1 + i * DAY + 10 * HOUR
      await mock.createTrade({
        accountId: id, instrumentId: ins, direction: 'long', size: String(s), multiplier: '1', entryPrice: '100', exitPrice: '100', entryTime: entry, exitTime: entry + HOUR,
        tzOffsetMin: 0, plannedSl: sl, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], executionType: null,
      } as TradeData)
    }
    if (deposit) await mock.createCashFlow({ accountId: id, kind: 'deposit', amount: '10000', occurredAt: SEP_1 + 5 * DAY, tzOffsetMin: 0, note: '' })
    return id
  }
  beforeAll(async () => {
    ins = (await mock.listInstruments())[0].id
  })

  it('N1 : le risque grandit plus vite que le capital (la borne de 20 % est incluse)', async () => {
    const r = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N1', [10, 10, 10, 10, 10, 12, 12, 12, 12, 12])] })
    expect([r.tradeCount, r.usableCount, r.excludedCount, r.withoutStopCount]).toEqual([10, 10, 0, 0])
    expect([r.older!.avgBalance, r.older!.avgRisk, r.recent!.avgBalance, r.recent!.avgRisk]).toEqual(['10000', '100', '10000', '120'])
    close(r.older!.avgRiskPct, 0.01)
    close(r.recent!.avgRiskPct, 0.012)
    close(r.riskPctChange, 0.2)
    close(r.capitalChange, 0)
    close(r.riskChange, 0.2)
    expect([r.capitalMoved, r.verdict, r.minPerHalf, r.capitalMoveThreshold, r.verdictBand, r.currentCapital]).toEqual([false, 'oversized', 5, 0.1, 0.2, '10000'])
    expect([r.points[0].tradeId > 0, r.points[0].balanceAtEntry, r.points[0].initialRisk]).toEqual([true, '10000', '100'])
  })

  it('N2 et N3 : un dépôt relève le solde ; la taille a suivi ou non', async () => {
    const two = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N2', Array(10).fill(10), true)] })
    expect([two.older!.avgBalance, two.recent!.avgBalance, two.verdict, two.capitalMoved, two.currentCapital]).toEqual(['10000', '20000', 'undersized', true, '20000'])
    close(two.capitalChange, 1)
    close(two.riskChange, 0)
    close(two.riskPctChange, -0.5)
    const three = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N3', [10, 10, 10, 10, 10, 20, 20, 20, 20, 20], true)] })
    expect(three.verdict).toBe('stable')
    close(three.riskPctChange, 0)
    close(three.riskChange, 1)
  })

  it('N4 : le trade du milieu est ignoré ; pas assez de trades : pas de verdict ; trades sans stop exclus', async () => {
    const four = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N4', [10, 10, 10, 10, 10, 100, 10, 10, 10, 10, 10])] })
    expect([four.usableCount, four.older!.tradeCount, four.recent!.tradeCount, four.verdict]).toEqual([11, 5, 5, 'stable'])
    expect(four.older!.to).toBe(four.points[4].exitTime)
    expect(four.recent!.from).toBe(four.points[6].exitTime)
    const few = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N5', [10, 10, 10, 10, 10, 12, 12, 12, 12])] })
    expect([few.verdict, few.older, few.riskPctChange, few.capitalChange, few.capitalMoved, few.points.length]).toEqual(['notEnoughData', null, null, null, false, 9])
    const one = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N6', [10])] })
    expect([one.usableCount, one.verdict]).toEqual([1, 'notEnoughData'])
    const noStop = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N7', [10, 10, 10], false, null)] })
    expect([noStop.tradeCount, noStop.usableCount, noStop.excludedCount, noStop.withoutStopCount]).toEqual([3, 0, 3, 3])
    const none = await mockAnalysesMore.getScalingReport({ accountIds: [await account('N8', [])] })
    expect([none.tradeCount, none.verdict, none.currentCapital]).toEqual([0, 'notEnoughData', '10000'])
  })
})
