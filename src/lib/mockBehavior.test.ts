import { beforeAll, describe, expect, it } from 'vitest'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'

/**
 * Journal D du test Rust `behavior::tests` (résultats calculés à la main) : le faux
 * backend doit donner les mêmes scores, sinon les captures d'écran mentiraient.
 */
const DAY = 86_400_000
const MIN = 60_000
const SEP_1 = 20_697 * DAY
let accountId = 0
let instrumentId = 0
const ids: number[] = []

async function add(direction: 'long' | 'short', entry: string, exit: string | null, size: string, sl: string | null, day: number, inMin: number, outMin: number, extra: Partial<TradeData> = {}) {
  const trade: TradeData = {
    accountId, instrumentId, direction, size, multiplier: '1', entryPrice: entry, exitPrice: exit,
    entryTime: SEP_1 + day * DAY + inMin * MIN, exitTime: exit === null ? null : SEP_1 + day * DAY + outMin * MIN,
    tzOffsetMin: 0, plannedSl: sl, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    ...extra,
  }
  ids.push((await mock.createTrade(trade)).id)
}

const box = (checked: boolean) => ({ itemId: null, label: 'x', checked })

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Main', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  instrumentId = (await mock.listInstruments())[0].id
  const r1 = (await mock.createRule('Rule 1')).id
  const r2 = (await mock.createRule('Rule 2')).id
  await mock.setBehaviorSettings({ maxRiskPercent: '1', maxTradesPerDay: 2, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
  await add('long', '100', '110', '10', '95', 0, 540, 600, {
    planFollowed: 'yes', ruleChecks: [{ ruleId: r1, respected: true }, { ruleId: r2, respected: true }], checklist: [box(true), box(true), box(true), box(false)],
  })
  await add('long', '50', '45', '30', '45', 0, 630, 660, { planFollowed: 'partial', ruleChecks: [{ ruleId: r1, respected: false }] })
  await add('long', '100', '104', '20', '95', 0, 690, 720, { planFollowed: 'no' })
  await add('short', '200', '210', '5', '204', 1, 540, 570, {
    planFollowed: 'yes', ruleChecks: [{ ruleId: r2, respected: true }], checklist: [box(true), box(true), box(true), box(true)],
  })
  await add('long', '200', '190', '10', '196', 1, 585, 615)
  await add('long', '10', '10', '1', null, 2, 540, 600, { planFollowed: 'yes' })
  await add('long', '10', null, '1', null, 2, 660, 0)
})

describe("mock de l'analyse comportementale", () => {
  it('score de discipline : mêmes chiffres que pulse-core', async () => {
    const d = await mock.getDiscipline({ accountIds: [accountId] })
    const expected = [96.25, 3500 / 85, 50 / 3, 100, 200 / 3, 80]
    expect(d.trades.map((t) => t.tradeId)).toEqual(ids.slice(0, 6))
    d.trades.forEach((t, i) => expect(t.score).toBeCloseTo(expected[i], 9))
    expect(d.score).toBeCloseTo(expected.reduce((a, b) => a + b) / 6, 9)
    expect(d.trades.map((t) => t.coverage)).toEqual([1, 0.85, 0.6, 1, 0.3, 0.5])
    expect(d.trades[2].overtrading).toBe(true)
    expect(d.trades[4].revenge).toMatchObject({ previousTradeId: ids[3], gapMs: 15 * MIN, basis: 'risk', ratio: 2 })
    expect(d.quadrants.poorlyExecutedLosses).toEqual({ count: 2, netPnl: '-250' })
    expect(d.days.map((x) => [x.day, x.tradeCount])).toEqual([['2026-09-01', 3], ['2026-09-02', 2], ['2026-09-03', 1]])
    expect((await mock.getTradeDiscipline(ids[6])).dayRank).toBe(2)
  })

  it('séries, plan, premier trade, règles', async () => {
    const q = { accountIds: [accountId] }
    const s = await mock.getStreaks(q)
    expect(s.current).toBeNull()
    expect([s.longestLoss?.length, s.longestLoss?.netPnl, s.longestWin?.firstTradeId]).toEqual([2, '-150', ids[2]])
    expect((await mock.getPlanComparison(q)).groups.map((g) => [g.key, g.summary.netPnl])).toEqual([['yes', '50'], ['partial', '-150'], ['no', '80'], ['none', '-100']])
    const f = await mock.getFirstTrade(q)
    expect([f.first.summary.netPnl, f.subsequent.summary.netPnl, f.first.disciplineScore]).toEqual(['50', '-170', null])
    const r = await mock.getRuleAdherence(q)
    expect([r.checks, r.respected, r.rate]).toEqual([4, 3, 0.75])
    const m = await mock.getMistakes(q)
    expect(m.byCost.map((x) => [x.label, x.cost])).toEqual([['Rule 1', '150']])
  })

  it('statistiques complémentaires et risque', async () => {
    const q = { accountIds: [accountId] }
    const d = await mock.getRDistribution(q)
    expect(d.bins).toHaveLength(18)
    expect(d.bins.filter((b) => b.count).map((b) => [b.from, b.count])).toEqual([[-2.5, 2], [-1, 1], [0.5, 1], [2, 1]])
    expect([d.noRCount, d.medianR]).toEqual([1, -1])
    const ls = await mock.getLongShort(q)
    expect([ls.long.tradeCount, ls.short.netPnl]).toEqual([5, '-50'])
    const risk = await mock.getRisk(q)
    expect(risk.trades.map((t) => t.balanceAtEntry)).toEqual(['10000', '10100', '9950', '10030', '9980', '9880'])
    expect(risk.trades.map((t) => t.withinLimit)).toEqual([true, false, false, true, true, null])
    expect([risk.overLimitCount, risk.limitAmount]).toEqual([2, '98.8'])
    const h = await mock.getHeatmap(q)
    expect(h.cells.map((c) => [c.weekday, c.hour, c.tradeCount])).toEqual([[2, 9, 1], [2, 10, 1], [2, 11, 1], [3, 9, 2], [4, 9, 1]])
    const p = await mock.getPatterns(q)
    expect(p.revengeTrades.map((t) => t.tradeId)).toEqual([ids[4]])
    expect(p.overtradingDays).toEqual([{ accountId, day: '2026-09-01', tradeCount: 3, limit: 2, tradeIds: [ids[2]] }])
  })

  it('refuse des seuils invalides', async () => {
    await expect(mock.setBehaviorSettings({ maxRiskPercent: '0', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })).rejects.toThrow()
    await expect(mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: 0, revengeWindowMin: 60, revengeSizeFactor: '1.5' })).rejects.toThrow()
    expect((await mock.getBehaviorSettings()).maxTradesPerDay).toBe(2)
  })
})
