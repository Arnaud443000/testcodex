import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockGoalsReplay } from './mockBackend'
import type { TradeData } from '../types/trade'

const H = 3_600_000
let accountId = 0
let eurusd = 0

/** Long, entrée 100, stop 90, taille 1, multiplicateur 1 : risque 10, donc R = net / 10. */
function trade(day: number, exit: string, over: Partial<TradeData> = {}): TradeData {
  const t = Date.UTC(2026, 8, day, 12)
  return {
    accountId,
    instrumentId: eurusd,
    direction: 'long',
    size: '1',
    multiplier: '1',
    entryPrice: '100',
    exitPrice: exit,
    entryTime: t - H,
    exitTime: t,
    tzOffsetMin: 0,
    plannedSl: '90',
    fees: '0',
    thesis: '',
    postMortem: '',
    tagIds: [],
    emotions: [],
    ruleChecks: [],
    checklist: [],
    ...over,
  }
}

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Objectifs', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  eurusd = (await mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
  // Septembre 2026 : +10, +20, −10, +5 (net 25, réussite 75 %, profit factor 3,5, drawdown 10).
  for (const [d, exit] of [[3, '110'], [10, '120'], [17, '90'], [24, '105']] as const) await mock.createTrade(trade(d, exit, { planFollowed: 'yes' }))
})

const query = (month: string, today: string) => ({ accountIds: [accountId], month, tzOffsetMin: 0, today })

describe('faux backend : objectifs', () => {
  it('définit, remplace et refuse des cibles invalides', async () => {
    const g = await mockGoalsReplay.setGoal({ month: '2026-09', metric: 'net_pnl', target: '20' })
    expect((await mockGoalsReplay.setGoal({ month: '2026-09', metric: 'net_pnl', target: '30' })).id).toBe(g.id)
    await expect(mockGoalsReplay.setGoal({ month: '2026-13', metric: 'net_pnl', target: '5' })).rejects.toThrow('invalid month')
    await expect(mockGoalsReplay.setGoal({ month: '2026-09', metric: 'net_pnl', target: '0' })).rejects.toThrow('greater than zero')
    await expect(mockGoalsReplay.setGoal({ month: '2026-09', metric: 'win_rate', target: '101' })).rejects.toThrow('at most 100')
    await expect(mockGoalsReplay.setGoal({ month: '2026-09', metric: 'execution_quality', target: '6' })).rejects.toThrow('1 and 5')
    await mockGoalsReplay.setGoal({ month: '2026-09', metric: 'net_pnl', target: '20' })
  })

  it('mesure les objectifs sur le mois, comme pulse-core', async () => {
    await mockGoalsReplay.setGoal({ month: '2026-09', metric: 'win_rate', target: '80' })
    await mockGoalsReplay.setGoal({ month: '2026-09', metric: 'max_drawdown', target: '15' })
    const p = await mockGoalsReplay.getGoalProgress(query('2026-09', '2026-09-29'))
    const of = (m: string) => p.find((x) => x.goal.metric === m)!
    expect(of('net_pnl')).toMatchObject({ actualMoney: '25', fraction: 1.25, status: 'reached' })
    expect(of('win_rate')).toMatchObject({ actualRatio: 75, fraction: 0.9375, status: 'in_progress' })
    expect(of('max_drawdown')).toMatchObject({ direction: 'at_most', actualMoney: '10', status: 'in_progress' })
    const after = await mockGoalsReplay.getGoalProgress(query('2026-09', '2026-10-01'))
    expect(after.find((x) => x.goal.metric === 'win_rate')!.status).toBe('missed')
    expect(after.find((x) => x.goal.metric === 'max_drawdown')!.status).toBe('reached')
  })

  it('un mois sans trade clôturé n’a pas de données ; le report ne remplace pas', async () => {
    await mockGoalsReplay.setGoal({ month: '2026-10', metric: 'net_pnl', target: '500' })
    expect((await mockGoalsReplay.getGoalProgress(query('2026-10', '2026-11-05')))[0]).toMatchObject({ status: 'no_data', tradeCount: 0, fraction: null })
    const copied = await mockGoalsReplay.copyGoals('2026-09', '2026-10')
    expect(copied.find((g) => g.metric === 'net_pnl')!.target).toBe('500')
    expect(copied.length).toBe(3)
  })
})

describe('faux backend : replay', () => {
  it('filtre l’historique par note et donne l’échelle des niveaux en R', async () => {
    const rated = await mock.createTrade(trade(28, '104', { rating: 2, plannedTp: '120', priceAfterExit: '112', thesis: 'Rejet' }))
    const top = await mock.createTrade(trade(29, '110', { rating: 5 }))
    const ids = async (f: Parameters<typeof mockGoalsReplay.listReplay>[0]) => (await mockGoalsReplay.listReplay({ accountIds: [accountId], ...f })).map((x) => x.tradeId)
    expect(await ids({ maxRating: 2 })).toEqual([rated.id])
    expect(await ids({ minRating: 4 })).toEqual([top.id])
    expect((await ids({ unratedOnly: true })).length).toBe(4)
    expect(await ids({ withNotes: true })).toEqual([rated.id])
    expect((await ids({})).slice(0, 2)).toEqual([top.id, rated.id])

    const card = await mockGoalsReplay.getReplayCard(rated.id)
    expect(card.levels.map((l) => l.kind)).toEqual(['planned_tp', 'price_after_exit', 'exit', 'entry', 'planned_sl'])
    const r = (k: string) => card.levels.find((l) => l.kind === k)!.r
    expect([r('planned_sl'), r('entry'), r('exit'), r('planned_tp'), r('price_after_exit')]).toEqual([-1, 0, 0.4, 2, 1.2])
    await expect(mockGoalsReplay.getReplayCard(9999)).rejects.toThrow('not found')
  })
})
