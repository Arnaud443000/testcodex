import { beforeAll, describe, expect, it } from 'vitest'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'

/**
 * Même journal que le test Rust `stats::dashboard::tests::journal` (résultats calculés à la main) :
 * le faux backend doit donner les mêmes chiffres, sinon les captures d'écran mentiraient.
 */
const DAY = 86_400_000
const H = 3_600_000
const SEP_1 = 20_697 * DAY
const NOW = SEP_1 + 28 * DAY + 12 * H
let accountId = 0

async function closed(direction: 'long' | 'short', entry: string, exit: string, sl: string | null, day: number) {
  const exitTime = SEP_1 + day * DAY + 11 * H
  const instruments = await mock.listInstruments()
  const trade: TradeData = {
    accountId, instrumentId: instruments[0].id, direction, size: '1', multiplier: '1', entryPrice: entry, exitPrice: exit,
    entryTime: exitTime - H, exitTime, tzOffsetMin: 0, plannedSl: sl, plannedTp: null, fees: '0', thesis: '', postMortem: '',
    tagIds: [], emotions: [], ruleChecks: [], checklist: [],
  } as TradeData
  await mock.createTrade(trade)
}

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Main', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  await closed('long', '100', '200', null, 0)
  await closed('long', '10', '8', null, 19)
  await closed('long', '10', '13', null, 20)
  await closed('long', '100', '110', '95', 27)
  await closed('long', '100', '96', '95', 27)
  await closed('short', '50', '45', null, 28)
})

describe('mock des statistiques', () => {
  it('semaine contre semaine précédente : mêmes chiffres que pulse-core', async () => {
    const d = await mock.getDashboard({ accountIds: [], period: 'week', nowMs: NOW, tzOffsetMin: 0 })
    expect(d.report.summary.netPnl).toBe('11')
    expect(d.report.summary.tradeCount).toBe(3)
    expect(d.report.summary.profitFactor).toBeCloseTo(3.75, 12)
    expect(d.report.summary.expectancyR).toBeCloseTo(0.6, 12)
    expect(d.report.summary.maxDrawdown).toBe('4')
    expect(d.previous?.netPnl).toBe('1')
    expect(d.comparison?.netPnl).toBe('10')
    expect(d.comparison?.netPnlPct).toBeCloseTo(10, 12)
    expect(d.sparklines.netPnl).toEqual([6, 11])
    expect(d.report.currentCapital).toBe('10112')
  })

  it('tout, aucun compte, période vide', async () => {
    const all = await mock.getDashboard({ accountIds: [], period: 'all', nowMs: NOW, tzOffsetMin: 0 })
    expect(all.comparison).toBeNull()
    expect(all.report.summary.netPnl).toBe('112')
    const empty = await mock.getDashboard({ accountIds: [], period: 'month', nowMs: SEP_1 - 400 * DAY, tzOffsetMin: 0 })
    expect(empty.report.summary.winRate).toBeNull()
    expect(empty.sparklines.netPnl).toEqual([])
  })

  it('calendrier de septembre 2026 et trades d’un jour', async () => {
    const c = await mock.getCalendar({ accountIds: [], year: 2026, month: 9, tzOffsetMin: 0 })
    expect([c.daysInMonth, c.firstWeekday]).toEqual([30, 2])
    expect(c.days.map((d) => [d.dayOfMonth, d.netPnl])).toEqual([[1, '100'], [20, '-2'], [21, '3'], [28, '6'], [29, '5']])
    expect(c.days[0].intensity).toBe(1)
    expect((await mock.getCalendar({ accountIds: [], year: 2026, month: 10, tzOffsetMin: 0 })).firstWeekday).toBe(4)
    const day = await mock.getDayTrades([], '2026-09-28')
    expect(day.map((t) => t.netPnl)).toEqual(['10', '-4'])
    await expect(mock.getDayTrades([], 'nope')).rejects.toThrow()
  })
})
