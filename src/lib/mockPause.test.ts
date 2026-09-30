import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mock, mockPause } from './mockBackend'
import { checkPauseSettings, nextLocalMidnight } from './mockPause'
import { pauseContains } from './mockBehavior'
import type { NewPause, Pause } from '../types/pause'
import type { TradeData } from '../types/trade'

/**
 * Miroir de `pause/tests.rs` : mêmes cas, mêmes valeurs calculées à la main (journal P, bornes
 * [début ; fin), « jusqu'à demain matin »). Le faux backend doit dire la même chose que pulse-core.
 */
const MIN = 60_000
const DAY = 86_400_000
const T0 = 1_800_000_000_000
const SEP_1 = 20_697 * DAY
const utc = (y: number, m: number, d: number, hh: number, mm: number) => Date.UTC(y, m - 1, d, hh, mm)
const minutes = (n: number, extra: Partial<NewPause> = {}): NewPause => ({ length: { kind: 'minutes', minutes: n }, reason: null, note: null, tzOffsetMin: 0, ...extra })
const tomorrow = (tz: number): NewPause => ({ length: { kind: 'untilTomorrow' }, reason: null, note: null, tzOffsetMin: tz })
const raw = (id: number, startedAt: number, plannedEndAt: number, endedAt: number | null = null): Pause => ({ id, startedAt, plannedEndAt, endedAt, tzOffsetMin: 0, reason: null, note: null })

let instrumentId = 0
beforeAll(async () => {
  instrumentId = (await mock.listInstruments())[0].id
})
beforeEach(() => mockPause.reset())

describe('faux backend de la pause : mêmes règles que pulse-core', () => {
  it('une pause dure de 1 à 480 minutes ; un refus n’écrit rien', async () => {
    for (const bad of [0, 481, 10_000, 1.5]) await expect(mockPause.startPause(minutes(bad), T0)).rejects.toThrow(/invalid input/)
    expect(mockPause.all()).toHaveLength(0)
    const one = await mockPause.startPause(minutes(1), T0)
    expect(one.plannedEndAt - one.startedAt).toBe(MIN)
    const max = await mockPause.startPause(minutes(480), T0 + DAY)
    expect(max.plannedEndAt - max.startedAt).toBe(480 * MIN)
  })

  it('motif et note : contrôlés et nettoyés', async () => {
    const p = await mockPause.startPause(minutes(15, { reason: 'emotion', note: '  Je respire.  ' }), T0)
    expect([p.reason, p.note]).toEqual(['emotion', 'Je respire.'])
    const blank = await mockPause.startPause(minutes(15, { note: '   ' }), T0 + MIN)
    expect([blank.reason, blank.note]).toEqual([null, null])
    await expect(mockPause.startPause(minutes(15, { reason: 'punishment' as never }), T0 + 2 * MIN)).rejects.toThrow()
    await expect(mockPause.startPause(minutes(15, { note: 'é'.repeat(141) }), T0 + 2 * MIN)).rejects.toThrow()
    await expect(mockPause.startPause(minutes(15, { note: 'deux\nlignes' }), T0 + 2 * MIN)).rejects.toThrow()
    await expect(mockPause.startPause(minutes(15, { tzOffsetMin: 900 }), T0 + 2 * MIN)).rejects.toThrow()
    await expect(mockPause.startPause(minutes(15, { note: 'é'.repeat(140) }), T0 + 3 * MIN)).resolves.toBeTruthy()
  })

  it('se termine d’elle-même à la minute près : la fin est exclue', async () => {
    const p = await mockPause.startPause(minutes(30), T0)
    expect(await mockPause.getCurrentPause(T0 - 1)).toBeNull()
    const c = (await mockPause.getCurrentPause(T0))!
    expect([c.remainingMs, c.remainingMin]).toEqual([30 * MIN, 30])
    expect((await mockPause.getCurrentPause(T0 + 10 * MIN + 1))!.remainingMin).toBe(20)
    const last = (await mockPause.getCurrentPause(p.plannedEndAt - 1))!
    expect([last.remainingMs, last.remainingMin]).toEqual([1, 1])
    expect(await mockPause.getCurrentPause(p.plannedEndAt)).toBeNull()
    expect(mockPause.all()[0].endedAt).toBeNull()
    const row = (await mockPause.listPauses([], 10, p.plannedEndAt + 5 * MIN))[0]
    expect([row.status, row.plannedMs, row.actualMs]).toEqual(['completed', 30 * MIN, 30 * MIN])
  })

  it('terminée plus tôt : l’heure réelle est inscrite, et terminer deux fois n’est pas une erreur', async () => {
    await mockPause.startPause(minutes(60), T0)
    expect((await mockPause.endPause(T0 + 10 * MIN))!.endedAt).toBe(T0 + 10 * MIN)
    expect(await mockPause.getCurrentPause(T0 + 11 * MIN)).toBeNull()
    expect(await mockPause.endPause(T0 + 12 * MIN)).toBeNull()
    const row = (await mockPause.listPauses([], 10, T0 + DAY))[0]
    expect([row.status, row.plannedMs, row.actualMs]).toEqual(['endedEarly', 60 * MIN, 10 * MIN])
    await mockPause.startPause(minutes(5), T0 + DAY)
    expect(await mockPause.endPause(T0 + DAY + 6 * MIN)).toBeNull()
  })

  it('une horloge incohérente est refusée', async () => {
    await mockPause.startPause(minutes(60), T0)
    await expect(mockPause.endPause(T0 - MIN)).rejects.toThrow(/invalid input/)
    await expect(mockPause.startPause(minutes(10), T0 - MIN)).rejects.toThrow(/invalid input/)
    expect(await mockPause.getCurrentPause(T0)).not.toBeNull()
  })

  it('en démarrer une autre remplace la précédente', async () => {
    const a = await mockPause.startPause(minutes(60), T0)
    const b = await mockPause.startPause(minutes(15), T0 + 10 * MIN)
    const rows = await mockPause.listPauses([], 10, T0 + 11 * MIN)
    expect(rows.map((r) => [r.pause.id, r.status])).toEqual([[b.id, 'running'], [a.id, 'endedEarly']])
    expect(rows[1].pause.endedAt).toBe(T0 + 10 * MIN)
    expect((await mockPause.getCurrentPause(T0 + 11 * MIN))!.pause.id).toBe(b.id)
    // Une pause déjà terminée d'elle-même n'est pas « terminée plus tôt » après coup.
    const c = await mockPause.startPause(minutes(5), T0 + DAY)
    await mockPause.startPause(minutes(5), T0 + DAY + 30 * MIN)
    expect(mockPause.all().find((p) => p.id === c.id)!.endedAt).toBeNull()
  })

  it('« jusqu’à demain matin » : prochain minuit local du décalage donné, changement d’heure compris', async () => {
    expect((await mockPause.startPause(tomorrow(120), utc(2026, 9, 1, 22, 30))).plannedEndAt).toBe(utc(2026, 9, 2, 22, 0))
    mockPause.reset()
    expect((await mockPause.startPause(tomorrow(-240), utc(2026, 9, 1, 3, 0))).plannedEndAt).toBe(utc(2026, 9, 1, 4, 0))
    mockPause.reset()
    expect((await mockPause.startPause(tomorrow(0), utc(2026, 9, 5, 0, 0))).plannedEndAt).toBe(utc(2026, 9, 6, 0, 0))
    mockPause.reset()
    const p = await mockPause.startPause(tomorrow(0), utc(2026, 9, 7, 23, 59))
    expect(p.plannedEndAt - p.startedAt).toBe(MIN)
    mockPause.reset()
    expect((await mockPause.startPause(tomorrow(120), utc(2026, 10, 24, 20, 0))).plannedEndAt).toBe(utc(2026, 10, 24, 22, 0))
    mockPause.reset()
    expect((await mockPause.startPause(tomorrow(60), utc(2026, 10, 25, 12, 0))).plannedEndAt).toBe(utc(2026, 10, 25, 23, 0))
    expect(nextLocalMidnight(utc(2026, 9, 1, 22, 30), 120)).toBe(utc(2026, 9, 2, 22, 0))
  })

  it('réglages : défauts, aller-retour et bornes', async () => {
    expect(await mockPause.getPauseSettings()).toEqual({ suggestAfterLosses: null, defaultMinutes: 30 })
    const custom = { suggestAfterLosses: 3, defaultMinutes: 45 }
    expect(await mockPause.setPauseSettings(custom)).toEqual(custom)
    for (const bad of [{ ...custom, suggestAfterLosses: 1 }, { ...custom, suggestAfterLosses: 11 }, { ...custom, defaultMinutes: 0 }, { ...custom, defaultMinutes: 481 }]) {
      expect(() => checkPauseSettings(bad)).toThrow(/invalid input/)
      await expect(mockPause.setPauseSettings(bad)).rejects.toThrow()
    }
    expect((await mockPause.getPauseSettings()).defaultMinutes).toBe(45)
  })
})

describe('bornes de l’intervalle (mêmes cas que pulse-core)', () => {
  it('[début ; fin réelle) : début inclus, fin exclue, fin choisie avant la fin prévue', () => {
    const p = raw(1, 1000, 2000)
    expect([pauseContains(p, 999), pauseContains(p, 1000), pauseContains(p, 1999), pauseContains(p, 2000)]).toEqual([false, true, true, false])
    const early = raw(2, 1000, 2000, 1500)
    expect([pauseContains(early, 1499), pauseContains(early, 1500)]).toEqual([true, false])
  })
})

// --- Journal P : dix trades, un par jour, long 100 → sortie, stop 90 (risque 10), entrée 09:00, sortie 10:00 ---
let account = 0
const ids: number[] = []
const entryOf = (d: number) => SEP_1 + d * DAY + 9 * 60 * MIN

async function trade(d: number, exit: string, plan: 'yes' | 'no') {
  const t: TradeData = {
    accountId: account, instrumentId, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: exit,
    entryTime: entryOf(d), exitTime: SEP_1 + d * DAY + 10 * 60 * MIN, tzOffsetMin: 0, plannedSl: '90', fees: '0',
    thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [], planFollowed: plan,
  }
  return (await mock.createTrade(t)).id
}

describe('constat : trades pris pendant une pause (journal P)', () => {
  beforeAll(async () => {
    account = (await mock.createAccount({ name: 'Pause P', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    const exits = ['90', '90', '95', '110', '90', '110', '115', '100', '120', '105']
    for (const [i, x] of exits.entries()) ids.push(await trade(i, x, i < 5 ? 'no' : 'yes'))
  })

  const pauseAround = (n: number) => mockPause.startPause(minutes(30), entryOf(n) - MIN) // une par trade, entrée 1 minute après le début
  const q = { accountIds: [0] }
  beforeEach(() => {
    q.accountIds = [account]
  })

  it('cinq trades par groupe : comparaison prudente chiffrée', async () => {
    for (let n = 0; n < 5; n++) await pauseAround(n)
    const r = await mockPause.getPauseReport(q)
    expect([r.during.summary.tradeCount, r.others.summary.tradeCount, r.tradeCount, r.sampleTooSmall, r.shareDuring]).toEqual([5, 5, 10, false, 0.5])
    expect([r.during.summary.netPnl, r.others.summary.netPnl, r.avgNetPnlDifference]).toEqual(['-25', '50', '-15'])
    expect(r.expectancyR.present).toBeCloseTo(-0.5, 9)
    expect(r.expectancyR.absent).toBeCloseTo(1.0, 9)
    expect(r.expectancyR.difference).toBeCloseTo(-1.5, 9)
    expect([r.expectancyR.verdict, r.discipline.verdict]).toEqual(['lower', 'lower'])
    expect(r.discipline.present).toBeCloseTo(40, 9)
    expect(r.discipline.absent).toBeCloseTo(100, 9)
    expect(r.discipline.difference).toBeCloseTo(-60, 9)
    expect(r.during.tradeIds).toEqual(ids.slice(0, 5))
  })

  it('quatre trades dans un groupe : aucune comparaison, mais le compte et la part restent', async () => {
    for (let n = 0; n < 4; n++) await pauseAround(n)
    const r = await mockPause.getPauseReport(q)
    expect([r.during.summary.tradeCount, r.others.summary.tradeCount, r.sampleTooSmall, r.shareDuring]).toEqual([4, 6, true, 0.4])
    expect([r.avgNetPnlDifference, r.expectancyR.verdict, r.expectancyR.difference, r.discipline.verdict, r.discipline.present]).toEqual([null, 'notEnoughData', null, 'notEnoughData', null])
  })

  it('aucune pause : rien pendant, pas de part inventée sans trade', async () => {
    const r = await mockPause.getPauseReport(q)
    expect([r.pauseCount, r.during.summary.tradeCount, r.others.summary.tradeCount, r.shareDuring, r.sampleTooSmall]).toEqual([0, 0, 10, 0, true])
    const empty = await mockPause.getPauseReport({ accountIds: [account], from: 0, to: 1 })
    expect([empty.tradeCount, empty.shareDuring]).toEqual([0, null])
  })

  it('période : trades clôturés dans [from ; to), pauses commencées dans la période', async () => {
    await pauseAround(0)
    await pauseAround(3)
    const all = await mockPause.getPauseReport(q)
    expect([all.pauseCount, all.during.tradeIds]).toEqual([2, [ids[0], ids[3]]])
    const first4 = await mockPause.getPauseReport({ accountIds: [account], from: SEP_1, to: SEP_1 + 4 * DAY })
    expect([first4.tradeCount, first4.pauseCount, first4.during.tradeIds]).toEqual([4, 2, [ids[0], ids[3]]])
    const middle = await mockPause.getPauseReport({ accountIds: [account], from: SEP_1 + DAY, to: SEP_1 + 3 * DAY })
    expect([middle.tradeCount, middle.pauseCount, middle.during.tradeIds]).toEqual([2, 0, []])
  })

  it('liste : trades entrés pendant chaque pause (ouverts compris), tous comptes ou un compte', async () => {
    await pauseAround(2)
    const now = entryOf(2) + 20 * MIN
    expect((await mockPause.listPauses([], 10, now))[0].tradeCount).toBe(1)
    expect((await mockPause.listPauses([account], 10, now))[0].tradeCount).toBe(1)
    expect((await mockPause.listPauses([account + 999], 10, now))[0].tradeCount).toBe(0)
  })
})

describe('proposition de pause (jamais démarrée toute seule)', () => {
  it('seulement à partir des pertes d’affilée du jour, et jamais sans réglage ni pendant une pause', async () => {
    const a = (await mock.createAccount({ name: 'Pertes', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
    const base = SEP_1 + 40 * DAY
    const loss = async (h: number) => {
      const t: TradeData = {
        accountId: a, instrumentId, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: '90',
        entryTime: base + (h - 1) * 60 * MIN, exitTime: base + h * 60 * MIN, tzOffsetMin: 0, plannedSl: '90', fees: '0',
        thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
      }
      await mock.createTrade(t)
    }
    for (const h of [10, 11, 12]) await loss(h)
    const at = (h: number) => base + h * 60 * MIN
    expect(await mockPause.getPauseSuggestion([a], 0, at(13))).toBeNull() // réglage absent = jamais
    await mockPause.setPauseSettings({ suggestAfterLosses: 3, defaultMinutes: 30 })
    expect(await mockPause.getPauseSuggestion([a], 0, at(13))).toEqual({ accountId: a, losses: 3, threshold: 3 })
    await mockPause.setPauseSettings({ suggestAfterLosses: 4, defaultMinutes: 30 })
    expect(await mockPause.getPauseSuggestion([a], 0, at(13))).toBeNull()
    await mockPause.setPauseSettings({ suggestAfterLosses: 3, defaultMinutes: 30 })
    expect(await mockPause.getPauseSuggestion([a], 0, at(11) + 30 * MIN)).toBeNull() // à 11 h 30, deux pertes seulement
    expect(await mockPause.getPauseSuggestion([a], 0, at(13) + DAY)).toBeNull() // le lendemain : les pertes d'hier ne comptent pas
    await mockPause.startPause(minutes(30), at(13))
    expect(await mockPause.getPauseSuggestion([a], 0, at(13) + MIN)).toBeNull() // déjà en pause
  })
})

describe('un rappel, jamais un blocage', () => {
  it('on peut toujours saisir un trade pendant une pause', async () => {
    const a = (await mock.createAccount({ name: 'Libre', kind: 'personal', broker: '', currency: 'USD', initialCapital: '100' })).id
    await mockPause.startPause(minutes(60))
    const t: TradeData = {
      accountId: a, instrumentId, direction: 'long', size: '1', multiplier: '1', entryPrice: '100', exitPrice: null,
      entryTime: Date.now(), exitTime: null, tzOffsetMin: 0, plannedSl: null, fees: '0',
      thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    }
    await expect(mock.createTrade(t)).resolves.toBeTruthy()
  })
})
