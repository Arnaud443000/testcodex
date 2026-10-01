import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockComparisons } from './mockBackend'

/**
 * Journaux C, R et E du test Rust `stats::comparisons_tests` (résultats calculés à la main là-bas) :
 * le faux backend doit donner les mêmes chiffres, sinon les captures d'écran mentiraient.
 * Voir l'en-tête de ce fichier Rust pour les tableaux et les calculs.
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const SEP_1 = 20_697 * DAY
const symbolId: Record<string, number> = {}

async function add(accountId: number, symbol: string, size: string, sl: string | null, exit: string | null, fees: string, day: number, entry = '100') {
  await mock.createTrade({
    accountId, instrumentId: symbolId[symbol], direction: 'long', size, multiplier: '1', entryPrice: entry, exitPrice: exit,
    entryTime: SEP_1 + day * DAY + 10 * HOUR, exitTime: exit === null ? null : SEP_1 + day * DAY + 11 * HOUR,
    tzOffsetMin: 0, plannedSl: sl, fees, thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    executionType: null,
  })
}
const acct = async (name: string, currency: string, capital: string) =>
  (await mock.createAccount({ name, kind: 'personal', broker: `B ${name}`, currency, initialCapital: capital })).id
const close = (a: number | null | undefined, b: number, digits = 10) => expect(a).toBeCloseTo(b, digits)

let principal = 0
let prop = 0
let vide = 0
let risky = 0
let expo = 0
let expo2 = 0

beforeAll(async () => {
  for (const i of await mock.listInstruments()) symbolId[i.symbol] = i.id
  // Journal C.
  principal = await acct('Principal', 'USD', '10000')
  prop = await acct('Prop', 'EUR', '5000')
  vide = await acct('Vide', 'USD', '2000')
  for (const [i, exit] of ['110', '105', '95', '110', '90', '100'].entries()) await add(principal, 'EURUSD', '10', '95', exit, '2', i)
  for (const [i, exit] of ['110', '105', '96', '108', '95', '100'].entries()) await add(prop, 'EURUSD', '10', '95', exit, '10', i)
  // Journal R : limite 1 %.
  risky = await acct('Risque', 'USD', '10000')
  await add(risky, 'EURUSD', '10', '95', '110', '0', 0)
  await add(risky, 'EURUSD', '20', '95', '95', '0', 1)
  await add(risky, 'EURUSD', '30', '95', '100', '0', 2)
  await add(risky, 'EURUSD', '20', '95', '105', '0', 3)
  await add(risky, 'EURUSD', '10', null, '90', '0', 4)
  await add(risky, 'EURUSD', '25', '95', '96', '0', 30)
  await add(risky, 'EURUSD', '10', '95', '102', '0', 31)
  await add(risky, 'EURUSD', '22', '95', '100', '0', 32)
  await add(risky, 'EURUSD', '10', '95', null, '0', 33)
  // Journal E : deux comptes de même devise, chaque trade sort à son prix d'entrée.
  expo = await acct('Expo 1', 'GBP', '10000')
  expo2 = await acct('Expo 2', 'GBP', '5000')
  await add(expo, 'EURUSD', '10', '95', '100', '0', 1)
  await add(expo, 'EURUSD', '20', '95', '100', '0', 2)
  await add(expo, 'BTCUSD', '40', '95', '100', '0', 3)
  await add(expo, 'BTCUSD', '10', null, '100', '0', 4)
  await add(expo, 'US500', '10', '95', '100', '0', 5)
  await add(expo, 'XAUUSD', '10', null, '100', '0', 6)
  await add(expo2, 'EURUSD', '20', '95', '100', '0', 7)
})

describe('faux backend : comparaison de comptes (journal C)', () => {
  it('deux devises et un compte vide, côte à côte sans somme', async () => {
    const r = await mockComparisons.getAccountComparison({ accountIds: [prop, vide, principal] })
    expect(r.rows.map((x) => x.name)).toEqual(['Principal', 'Prop', 'Vide'])
    expect([r.mixedCurrencies, r.currencies]).toEqual([true, ['EUR', 'USD']])
    const [p, q, v] = r.rows
    expect([p.summary.tradeCount, p.summary.grossPnl, p.summary.fees, p.summary.netPnl, p.summary.maxDrawdown, p.feesPerTrade]).toEqual([6, '100', '12', '88', '104', '2'])
    close(p.summary.winRate, 0.5)
    close(p.summary.expectancyR, 1.76 / 6)
    close(p.summary.profitFactor, 244 / 156, 7)
    close(p.feesShareOfGross, 0.12)
    expect([q.currency, q.summary.netPnl, q.summary.fees, q.feesPerTrade]).toEqual(['EUR', '80', '60', '10'])
    close(q.summary.expectancyR, 1.6 / 6)
    close(q.feesShareOfGross, 60 / 140)
    expect([v.summary.tradeCount, v.feesPerTrade, v.summary.winRate, v.feesShareOfGross, v.lowSample]).toEqual([0, null, null, null, true])
    expect(r.hints).toHaveLength(1)
    const h = r.hints[0]
    expect([h.kind, h.accountId, h.otherAccountId, h.sharedInstruments]).toEqual(['fees', prop, principal, 1])
    close(h.gap, 60 / 140 - 0.12)
  })

  it('un seul compte : aucune piste ; aucun compte choisi = comptes actifs', async () => {
    const one = await mockComparisons.getAccountComparison({ accountIds: [principal] })
    expect([one.rows.length, one.mixedCurrencies, one.hints.length]).toEqual([1, false, 0])
    const every = await mockComparisons.getAccountComparison({ accountIds: [] })
    expect(every.rows.length).toBeGreaterThanOrEqual(3)
  })

  it('sous l’échantillon minimal : aucune piste', async () => {
    const r = await mockComparisons.getAccountComparison({ accountIds: [principal, prop], from: SEP_1 + 2 * DAY })
    expect(r.rows.map((x) => [x.summary.tradeCount, x.lowSample])).toEqual([[4, true], [4, true]])
    expect(r.hints).toEqual([])
  })
})

describe('faux backend : benchmark du risque max (journal R)', () => {
  it('sans limite : rien n’est évalué', async () => {
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const r = await mockComparisons.getRiskBenchmark({ accountIds: [risky] })
    expect([r.limitPercent, r.evaluatedCount, r.overCount, r.complianceRate, r.trend, r.tradeCount, r.withoutStopCount]).toEqual([null, 0, 0, null, 'notEnoughData', 8, 1])
    expect([r.violations, r.points, r.months]).toEqual([[], [], []])
    close(r.maxRiskPct, 0.015, 7)
  })

  it('limite 1 % : dépassements, taux, tendance', async () => {
    await mock.setBehaviorSettings({ maxRiskPercent: '1', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const r = await mockComparisons.getRiskBenchmark({ accountIds: [risky] })
    expect([r.tradeCount, r.evaluatedCount, r.withoutStopCount, r.respectedCount, r.overCount]).toEqual([8, 7, 1, 4, 3])
    close(r.complianceRate, 4 / 7)
    expect(r.violations).toHaveLength(3)
    const [v8, v6, v3] = r.violations
    expect([v3.initialRisk, v3.balanceAtEntry, v3.limitAmount]).toEqual(['150', '10000', '100'])
    close(v3.riskPct, 0.015)
    close(v3.excessPct, 0.005)
    close(v3.overFactor, 1.5)
    close(v6.overFactor, 1.25)
    expect([v8.initialRisk, v8.balanceAtEntry, v8.limitAmount]).toEqual(['110', '9920', '99.2'])
    close(v8.riskPct, 110 / 9920)
    close(v8.excessPct, 110 / 9920 - 0.01)
    expect(v8.exitTime).toBeGreaterThan(v6.exitTime)
    expect(v6.exitTime).toBeGreaterThan(v3.exitTime)
    expect(r.trend).toBe('worsening')
    close(r.olderRate, 2 / 3)
    close(r.recentRate, 1 / 3)
    expect(r.months.map((m) => [m.key, m.evaluatedCount, m.overCount])).toEqual([['2026-09', 4, 1], ['2026-10', 3, 2]])
    close(r.months[0].complianceRate, 0.75)
  })

  it('exactement à la limite = respecté ; limite plus stricte = dépassement', async () => {
    await mock.setBehaviorSettings({ maxRiskPercent: '0.99', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const r = await mockComparisons.getRiskBenchmark({ accountIds: [risky] })
    expect(r.violations.length).toBeGreaterThan(3)
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
  })

  it('aucun trade dans la fenêtre', async () => {
    await mock.setBehaviorSettings({ maxRiskPercent: '1', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const r = await mockComparisons.getRiskBenchmark({ accountIds: [risky], from: SEP_1 + 500 * DAY })
    expect([r.tradeCount, r.evaluatedCount, r.complianceRate, r.trend]).toEqual([0, 0, null, 'notEnoughData'])
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
  })
})

describe('faux backend : exposition par catégorie (journal E)', () => {
  it('parts du risque, % du capital, trades sans stop', async () => {
    const r = await mockComparisons.getExposureReport({ accountIds: [expo] })
    // Compte 1 seul : forex 50 + 100, crypto 200 (+1 sans stop), indice 50, matière première sans stop.
    expect([r.tradeCount, r.withoutStopCount, r.totalRisk, r.currency]).toEqual([6, 2, '400', 'GBP'])
    expect(r.rows.map((x) => x.assetClass)).toEqual(['crypto', 'forex', 'index', 'commodity'])
    close(r.rows[0].shareOfRisk, 0.5)
    close(r.rows[1].shareOfRisk, 0.375)
    close(r.rows[2].shareOfRisk, 0.125)
    const cm = r.rows[3]
    expect([cm.tradeCount, cm.riskTradeCount, cm.riskAmount, cm.shareOfRisk, cm.riskPctOfCapital, cm.avgRiskPct]).toEqual([1, 0, '0', null, null, null])
    close(r.totalRiskPct, 0.04)
  })

  it('deux comptes de même devise : journal E complet', async () => {
    const r = await mockComparisons.getExposureReport({ accountIds: [expo, expo2] })
    expect([r.tradeCount, r.withoutStopCount, r.totalRisk]).toEqual([7, 2, '500'])
    expect(r.rows.map((x) => x.assetClass)).toEqual(['forex', 'crypto', 'index', 'commodity'])
    const [fx, cr, ix] = r.rows
    expect([fx.tradeCount, fx.riskTradeCount, fx.riskAmount]).toEqual([3, 3, '250'])
    close(fx.shareOfRisk, 0.5)
    close(fx.riskPctOfCapital, 0.035)
    close(fx.avgRiskPct, 0.035 / 3)
    expect([cr.tradeCount, cr.riskTradeCount, cr.withoutStopCount, cr.riskAmount]).toEqual([2, 1, 1, '200'])
    close(cr.shareOfRisk, 0.4)
    close(cr.riskPctOfCapital, 0.02)
    close(ix.shareOfRisk, 0.1)
    close(r.totalRiskPct, 0.06)
    close(r.rows.reduce((a, x) => a + (x.shareOfRisk ?? 0), 0), 1)
  })

  it('période, aucun trade, et jamais deux devises', async () => {
    const r = await mockComparisons.getExposureReport({ accountIds: [expo, expo2], from: SEP_1 + 5 * DAY })
    expect([r.tradeCount, r.totalRisk]).toEqual([3, '150'])
    expect(r.rows.map((x) => x.assetClass)).toEqual(['forex', 'index', 'commodity'])
    close(r.rows[0].shareOfRisk, 100 / 150)
    close(r.rows[0].riskPctOfCapital, 0.02)
    const none = await mockComparisons.getExposureReport({ accountIds: [expo], from: SEP_1 + 500 * DAY })
    expect([none.rows, none.tradeCount, none.totalRisk, none.totalRiskPct]).toEqual([[], 0, '0', null])
    await expect(mockComparisons.getExposureReport({ accountIds: [expo, principal] })).rejects.toThrow()
    await expect(mockComparisons.getRiskBenchmark({ accountIds: [risky, prop] })).rejects.toThrow()
  })
})
