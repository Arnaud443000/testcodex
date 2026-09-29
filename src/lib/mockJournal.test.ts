import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockJournal } from './mockBackend'
import type { TradeData } from '../types/trade'

const H = 3_600_000
let accountId = 0
let eurusd = 0

/** Long, entrée 100, stop 99, taille 1, multiplicateur 1 : le risque vaut 1, donc R = résultat net. */
const trade = (over: Partial<TradeData>): TradeData => ({
  accountId,
  instrumentId: eurusd,
  direction: 'long',
  size: '1',
  multiplier: '1',
  entryPrice: '100',
  exitPrice: '102',
  entryTime: 10 * H,
  exitTime: 11 * H,
  tzOffsetMin: 0,
  plannedSl: '99',
  fees: '0',
  thesis: '',
  postMortem: '',
  tagIds: [],
  emotions: [],
  ruleChecks: [],
  checklist: [],
  ...over,
})

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Journal', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  eurusd = (await mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
})

describe('faux backend : journal quotidien', () => {
  const entry = { day: '2026-09-29', mood: 4, lateHours: true, wentWell: ' Patience ', toImprove: '', notes: '' }

  it('enregistre, remplace, puis retire un journal vidé', async () => {
    const saved = await mockJournal.saveJournalEntry(entry)
    expect(saved).toMatchObject({ mood: 4, wentWell: 'Patience', sleepQuality: null })
    await mockJournal.saveJournalEntry({ ...entry, mood: 1 })
    expect((await mockJournal.listJournalEntries()).map((e) => [e.day, e.mood])).toEqual([['2026-09-29', 1]])
    const cleared = await mockJournal.saveJournalEntry({ day: '2026-09-29', lateHours: false, wentWell: '  ', toImprove: '', notes: '' })
    expect(cleared).toBeNull()
    expect(await mockJournal.listJournalEntries()).toEqual([])
  })

  it('refuse un jour ou une échelle invalides', async () => {
    await expect(mockJournal.saveJournalEntry({ ...entry, day: '2026-02-30' })).rejects.toThrow('invalid day')
    await expect(mockJournal.saveJournalEntry({ ...entry, mood: 6 })).rejects.toThrow('between 1 and 5')
    await expect(mockJournal.getJournalDay([], 'nope')).rejects.toThrow('invalid day')
  })

  it('liste les trades du jour local d’entrée et signale ceux à compléter', async () => {
    // 23 h 30 UTC un 29, trader en UTC+2 : jour local = le 30.
    const late = Date.UTC(2026, 8, 29, 23, 30)
    const quick = await mock.createTrade(trade({ entryTime: late, exitTime: null, exitPrice: null, tzOffsetMin: 120 }))
    const full = await mock.createTrade(
      trade({ entryTime: late + 1000, exitTime: late + H, tzOffsetMin: 120, thesis: 'Rejet', emotions: [{ moment: 'before', tagId: (await mock.listTags('emotion'))[0].id }] }),
    )
    const overview = await mockJournal.getJournalDay([accountId], '2026-09-30')
    expect(overview.trades.map((t) => t.tradeId)).toEqual([quick.id, full.id])
    expect(overview.trades.map((t) => t.incomplete)).toEqual([true, false])
    expect(overview.incompleteCount).toBe(1)
    expect((await mockJournal.getJournalDay([accountId], '2026-09-29')).trades).toEqual([])
  })
})

describe('faux backend : trades manqués', () => {
  it('crée, modifie, refuse les tags d’émotion et supprime', async () => {
    const setup = await mock.createTag('setup', 'Breakout')
    const calm = (await mock.listTags('emotion'))[0]
    const data = { accountId, instrumentId: eurusd, direction: null, occurredAt: 5, tzOffsetMin: 0, reason: ' Peur ', notes: '', conviction: 9, tagIds: [setup.id, setup.id] }
    const m = await mockJournal.createMissedTrade(data)
    expect(m).toMatchObject({ reason: 'Peur', tagIds: [setup.id] })
    const edited = await mockJournal.updateMissedTrade(m.id, { ...data, conviction: null })
    expect(edited.conviction).toBeNull()
    await expect(mockJournal.createMissedTrade({ ...data, conviction: 11 })).rejects.toThrow('conviction')
    await expect(mockJournal.createMissedTrade({ ...data, tagIds: [calm.id] })).rejects.toThrow('cannot qualify')
    await mockJournal.deleteMissedTrade(m.id)
    expect(await mockJournal.listMissedTrades([accountId])).toEqual([])
  })
})

describe('faux backend : qualité et confiance', () => {
  it('sépare résultat et qualité d’exécution', async () => {
    await mock.createTrade(trade({ exitPrice: '110', planFollowed: 'yes' })) // gain, bien
    await mock.createTrade(trade({ exitPrice: '120', planFollowed: 'no' })) // gain, mal
    await mock.createTrade(trade({ exitPrice: '90', planFollowed: 'yes' })) // perte, bien
    const r = await mockJournal.getQualityReport({ accountIds: [accountId], from: 10 * H, to: 12 * H })
    const cell = (o: string, g: string) => r.quadrants.find((q) => q.outcome === o && q.grade === g)!
    expect([cell('win', 'good').tradeCount, cell('win', 'poor').tradeCount, cell('loss', 'good').tradeCount, cell('loss', 'poor').tradeCount]).toEqual([1, 1, 1, 0])
    expect(cell('win', 'poor').netPnl).toBe('20')
    expect(r.scoredCount).toBe(3)
  })

  it('confiance : groupes et verdict tant que les données manquent', async () => {
    await mock.createTrade(trade({ conviction: 9, exitPrice: '103' }))
    const c = await mockJournal.getConfidenceReport({ accountIds: [accountId] })
    expect(c.buckets.find((b) => b.bucket === 'high')!.tradeCount).toBe(1)
    expect(c.verdict).toBe('not_enough_data')
  })
})

describe('faux backend : rappel', () => {
  it('refuse une heure invalide et garde les réglages', async () => {
    await expect(mockJournal.setReminderSettings({ enabled: true, time: '25:00' })).rejects.toThrow('reminder time')
    expect(await mockJournal.setReminderSettings({ enabled: false, time: '18:30' })).toEqual({ enabled: false, time: '18:30' })
    expect(await mockJournal.getReminderPending(0)).toBeNull()
  })
})
