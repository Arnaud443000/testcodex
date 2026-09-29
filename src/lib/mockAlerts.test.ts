import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mock, mockAlerts } from './mockBackend'
import { DEFAULT_ALERT_SETTINGS, parseHours } from './mockAlerts'
import type { AlertSettings } from '../types/alerts'
import type { TradeData } from '../types/trade'

/**
 * Mêmes journaux que `alerts::tests` (résultats calculés à la main côté Rust) : le faux backend
 * doit donner les mêmes alertes. Trades longs, entrée 100, multiplicateur 1 : PnL = (sortie − 100) × taille.
 */
const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000
/** Lundi 28 septembre 2026 00:00 UTC ; « aujourd'hui » = mardi 29 (jour 1). */
const MON = 20_724 * DAY
const at = (day: number, h: number, m = 0) => MON + day * DAY + h * HOUR + m * MIN
const NOW = at(1, 15)
let instrumentId = 0

const OFF: AlertSettings = {
  consecutiveLosses: null, burstMaxTrades: null, burstWindowMin: 60, dailyLossPercent: null, dailyLossAmount: null,
  weeklyLossPercent: null, weeklyLossAmount: null, revenge: false, tradingHours: null, unusualSession: false, noStopLoss: false,
}

const newAccount = async (capital = '10000') =>
  (await mock.createAccount({ name: `A${Math.random()}`, kind: 'personal', broker: '', currency: 'USD', initialCapital: capital })).id

async function trade(accountId: number, entryTime: number, exit: [number, string] | null, size = '1', sl: string | null = '90', extra: Partial<TradeData> = {}) {
  const t: TradeData = {
    accountId, instrumentId, direction: 'long', size, multiplier: '1', entryPrice: '100',
    exitPrice: exit ? exit[1] : null, entryTime, exitTime: exit ? exit[0] : null,
    tzOffsetMin: 0, plannedSl: sl, fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    ...extra,
  }
  return (await mock.createTrade(t)).id
}

const ids = (accountIds: number[], now = NOW, tz = 0) => mockAlerts.evaluateAt(accountIds, now, tz).map((a) => a.id)

beforeAll(async () => {
  instrumentId = (await mock.listInstruments())[0].id
})
beforeEach(async () => {
  await mockAlerts.setAlertSettings(OFF)
  await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
})

describe('faux backend des alertes : mêmes résultats que pulse-core', () => {
  it('aucune donnée, aucune alerte (réglages par défaut)', async () => {
    const a = await newAccount()
    await mockAlerts.setAlertSettings(DEFAULT_ALERT_SETTINGS)
    expect(ids([a])).toEqual([])
    await trade(a, at(1, 9), [at(1, 10), '101'])
    expect(ids([a])).toEqual([])
  })

  it('pertes consécutives du jour, remises à zéro par un breakeven', async () => {
    const a = await newAccount()
    await trade(a, at(0, 10), [at(0, 16), '90'])
    const exits: [number, string][] = [[9, '95'], [10, '97'], [11, '100'], [12, '99'], [13, '98'], [14, '96']]
    const tradeIds = []
    for (const [h, x] of exits) tradeIds.push(await trade(a, at(1, h), [at(1, h, 10), x]))
    await mockAlerts.setAlertSettings({ ...OFF, consecutiveLosses: 3 })
    const [alert] = mockAlerts.evaluateAt([a], NOW, 0)
    expect(alert).toMatchObject({
      id: `consecutiveLosses:${a}:${tradeIds[5]}`, severity: 'warning', messageKey: 'consecutiveLosses', at: at(1, 14, 10),
      count: 3, threshold: 3, tradeIds: tradeIds.slice(3),
    })
    expect(ids([a], at(1, 14, 5))).toEqual([]) // #7 encore ouvert
    await mockAlerts.setAlertSettings({ ...OFF, consecutiveLosses: 4 })
    expect(ids([a])).toEqual([])
  })

  it('trades par jour (réglage du lot 8) au jour local, deux comptes indépendants', async () => {
    const [a, b] = [await newAccount(), await newAccount()]
    const tz = { tzOffsetMin: 120 }
    await trade(a, at(0, 21, 30), [at(0, 21, 45), '101'], '1', '90', tz)
    await trade(a, at(0, 22, 30), [at(0, 23), '101'], '1', '90', tz)
    await trade(a, at(1, 8), [at(1, 8, 30), '101'], '1', '90', tz)
    const last = await trade(a, at(1, 9), null, '1', '90', tz)
    let lastB = 0
    for (let i = 0; i < 4; i++) lastB = await trade(b, at(1, 7 + i), null, '1', '90', tz)
    await mock.setBehaviorSettings({ maxRiskPercent: null, maxTradesPerDay: 3, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
    const alerts = mockAlerts.evaluateAt([a, b], at(1, 12), 120)
    expect(alerts.map((x) => [x.id, x.severity, x.messageKey])).toEqual([
      [`tradesPerDay:${b}:${lastB}`, 'critical', 'tradesPerDay.exceeded'],
      [`tradesPerDay:${a}:${last}`, 'warning', 'tradesPerDay.reached'],
    ])
    expect(alerts[1]).toMatchObject({ kind: 'tradesPerDay', level: 'reached', count: 3, threshold: 3, day: '2026-09-29' })
  })

  it('fenêtre glissante : le début de la fenêtre est exclu', async () => {
    const a = await newAccount()
    await trade(a, at(1, 14, 30), [at(1, 14, 40), '101'])
    await trade(a, at(1, 14, 31), [at(1, 14, 50), '101'])
    const t3 = await trade(a, at(1, 14, 45), null)
    await mockAlerts.setAlertSettings({ ...OFF, burstMaxTrades: 2, burstWindowMin: 30 })
    expect(mockAlerts.evaluateAt([a], NOW, 0)[0]).toMatchObject({ id: `tradesPerWindow:${a}:${t3}`, level: 'reached', count: 2, windowMin: 30 })
  })

  it('stop pour aujourd’hui : 345 = 3 % du solde de 11 500 au début du jour', async () => {
    const a = await newAccount()
    await mock.createCashFlow({ accountId: a, kind: 'deposit', amount: '1000', occurredAt: at(0, 9), tzOffsetMin: 0, note: '' })
    await trade(a, at(0, 10), [at(0, 11), '200'], '5')
    await mock.createCashFlow({ accountId: a, kind: 'deposit', amount: '5000', occurredAt: at(1, 8), tzOffsetMin: 0, note: '' })
    await trade(a, at(1, 9), [at(1, 9, 30), '80'], '10')
    const last = await trade(a, at(1, 10), [at(1, 10, 30), '71'], '5')
    await mockAlerts.setAlertSettings({ ...OFF, dailyLossPercent: '3' })
    const [alert] = mockAlerts.evaluateAt([a], NOW, 0)
    expect(alert).toMatchObject({
      id: `dailyLoss:${a}:2026-09-29:percent`, severity: 'critical', tradeId: last, loss: '345', referenceBalance: '11500',
      lossPct: 0.03, thresholdPercent: '3', amountReached: false, percentReached: true,
    })
    await mockAlerts.setAlertSettings({ ...OFF, dailyLossPercent: '3.01' })
    expect(ids([a])).toEqual([])
    await mockAlerts.setAlertSettings({ ...OFF, dailyLossPercent: '3', dailyLossAmount: '345' })
    expect(ids([a])).toEqual([`dailyLoss:${a}:2026-09-29:amount+percent`])
  })

  it('stop pour la semaine : 180 = 2 % du solde de 9 000 au début du lundi', async () => {
    const a = await newAccount()
    await trade(a, at(-1, 10), [at(-1, 11), '0'], '10')
    await trade(a, at(0, 10), [at(0, 11), '30'], '4')
    await trade(a, at(1, 10), [at(1, 11), '200'], '1')
    await mockAlerts.setAlertSettings({ ...OFF, weeklyLossPercent: '2', dailyLossPercent: '0.01' })
    const alerts = mockAlerts.evaluateAt([a], NOW, 0)
    expect(alerts.map((x) => x.id)).toEqual([`weeklyLoss:${a}:2026-09-28:percent`])
    expect(alerts[0]).toMatchObject({ periodStart: '2026-09-28', loss: '180', referenceBalance: '9000', lossPct: 0.02 })
  })

  it('revanche : détection du lot 8, par compte', async () => {
    const [a, b] = [await newAccount(), await newAccount()]
    const loser = await trade(a, at(1, 9), [at(1, 10), '95'])
    const revenge = await trade(a, at(1, 10, 30), null, '1.5')
    await trade(b, at(1, 10), [at(1, 10, 20), '0'], '100')
    await mockAlerts.setAlertSettings({ ...OFF, revenge: true })
    const alerts = mockAlerts.evaluateAt([a, b], NOW, 0)
    expect(alerts.map((x) => x.id)).toEqual([`revenge:${a}:${revenge}`])
    expect(alerts[0]).toMatchObject({ previousTradeId: loser, gapMs: 30 * MIN, basis: 'risk', ratio: 1.5, sizeFactor: '1.5', windowMin: 60 })
  })

  it('hors horaires (heure locale, fin exclue) et session inhabituelle (20 trades, moins de 10 %)', async () => {
    const a = await newAccount()
    const tz = { tzOffsetMin: 120 }
    await trade(a, at(1, 7), null, '1', '90', tz)
    const t2 = await trade(a, at(1, 15, 30), null, '1', '90', tz)
    await mockAlerts.setAlertSettings({ ...OFF, tradingHours: '09:00-17:30' })
    expect(mockAlerts.evaluateAt([a], at(1, 16), 120).map((x) => [x.id, 'localTime' in x ? x.localTime : ''])).toEqual([[`outsideHours:${a}:${t2}`, '17:30']])

    const b = await newAccount()
    for (let i = 0; i < 20; i++) {
      const h = i < 2 ? 15 : 8
      await trade(b, at(-20 + i, h), [at(-20 + i, h, 30), '101'])
    }
    await trade(b, at(1, 15), null) // New York : 2 sur 20 = 10 % tout juste → habituelle
    const asie = (await mock.listTags('session')).find((g) => g.name === 'Asie')!.id
    const t = await trade(b, at(1, 16), null, '1', '90', { tagIds: [asie] })
    await mockAlerts.setAlertSettings({ ...OFF, unusualSession: true })
    const alerts = mockAlerts.evaluateAt([b], at(1, 20), 0)
    expect(alerts.map((x) => x.id)).toEqual([`unusualSession:${b}:${t}`])
    expect(alerts[0]).toMatchObject({ session: 'Asie', sessionCount: 0, historyCount: 21, share: 0 })
  })

  it('sans stop loss : positions ouvertes en critique, trades du jour en avertissement', async () => {
    const a = await newAccount()
    const t1 = await trade(a, at(-3, 10), null, '1', null)
    const t2 = await trade(a, at(1, 9), [at(1, 10), '101'], '1', null)
    await trade(a, at(0, 9), [at(0, 10), '99'], '1', null)
    await trade(a, at(1, 11), null, '1', '90')
    const t5 = await trade(a, at(1, 14), [at(1, 16), '101'], '1', null)
    await mockAlerts.setAlertSettings({ ...OFF, noStopLoss: true })
    expect(mockAlerts.evaluateAt([a], NOW, 0).map((x) => [x.id, x.messageKey])).toEqual([
      [`noStopLoss:${a}:${t1}`, 'noStopLoss.open'],
      [`noStopLoss:${a}:${t5}`, 'noStopLoss.open'],
      [`noStopLoss:${a}:${t2}`, 'noStopLoss.closed'],
    ])
  })

  it('une alerte masquée ne revient pas ; une aggravation, si', async () => {
    const a = await newAccount()
    await trade(a, at(1, 9), [at(1, 9, 10), '95'])
    const second = await trade(a, at(1, 10), [at(1, 10, 10), '97'])
    await mockAlerts.setAlertSettings({ ...OFF, consecutiveLosses: 2 })
    const active = await mockAlerts.getActiveAlerts([a], 0, NOW)
    expect(active.map((x) => x.id)).toEqual([`consecutiveLosses:${a}:${second}`])
    await mockAlerts.dismissAlert(active[0].id, NOW + MIN)
    expect(await mockAlerts.getActiveAlerts([a], 0, NOW + 2 * MIN)).toEqual([])
    const third = await trade(a, at(1, 11), [at(1, 11, 10), '99'])
    expect((await mockAlerts.getActiveAlerts([a], 0, NOW + 3 * MIN)).map((x) => x.id)).toEqual([`consecutiveLosses:${a}:${third}`])
    const history = await mockAlerts.getAlertHistory([a])
    expect(history.map((r) => [r.tradeId, r.dismissedAt])).toEqual([[third, null], [second, NOW + MIN]])
    await expect(mockAlerts.dismissAlert('nope:1:1')).rejects.toThrow('not found')
  })

  it('réglages : mêmes refus que pulse-core', async () => {
    for (const bad of [
      { consecutiveLosses: 1 }, { burstMaxTrades: 0 }, { burstWindowMin: 1441 }, { dailyLossPercent: '0' },
      { weeklyLossPercent: '100.01' }, { dailyLossAmount: '0' }, { tradingHours: '09:00-09:00' }, { tradingHours: '9h-17h' },
    ]) {
      await expect(mockAlerts.setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ...bad })).rejects.toThrow('invalid input')
    }
    expect(parseHours('22:00 - 02:00')).toEqual([1320, 120])
    expect(await mockAlerts.setAlertSettings({ ...DEFAULT_ALERT_SETTINGS, tradingHours: '09:00-17:30' })).toMatchObject({ tradingHours: '09:00-17:30' })
  })
})
