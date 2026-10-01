import { beforeAll, describe, expect, it } from 'vitest'
import { mockPdf } from './mockBackend'
import { mock } from './mockBackend'
import type { PdfExportRequest } from '../types/pdf'
import type { TradeData } from '../types/trade'

const H = 3_600_000
let accountId = 0
const req = (over: Partial<PdfExportRequest> = {}): PdfExportRequest => ({
  accountId,
  from: null,
  to: null,
  includeAccountName: false,
  tzOffsetMin: 0,
  ...over,
})

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'PDF', kind: 'personal', broker: '', currency: 'USD', initialCapital: '1000' })).id
  const eurusd = (await mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
  const trade = (day: number, closed: boolean): TradeData => ({
    accountId,
    instrumentId: eurusd,
    direction: 'long',
    size: '1',
    entryPrice: '1.1',
    exitPrice: closed ? '1.11' : null,
    entryTime: day * 24 * H,
    exitTime: closed ? day * 24 * H + H : null,
    tzOffsetMin: 0,
    fees: '0',
    thesis: '',
    postMortem: '',
    tagIds: [],
    emotions: [],
    ruleChecks: [],
    checklist: [],
  })
  await mock.createTrade(trade(10, true))
  await mock.createTrade(trade(20, true))
  await mock.createTrade(trade(30, false))
})

describe('faux export PDF du navigateur (simulation)', () => {
  it('compte les trades clôturés de la période, pas les trades ouverts', async () => {
    expect((await mockPdf.exportPeriodPdf(req(), 'a.pdf', false)).tradeCount).toBe(2)
    const r = await mockPdf.exportPeriodPdf(req({ from: 15 * 24 * H, to: 40 * 24 * H }), 'b.pdf', false)
    expect(r).toEqual({ tradeCount: 1, pageCount: 1 })
    const none = await mockPdf.exportPeriodPdf(req({ from: 100 * 24 * H, to: 110 * 24 * H }), 'c.pdf', false)
    expect(none.tradeCount).toBe(0)
  })

  it('refuse une période inversée, comme pulse-core', async () => {
    await expect(mockPdf.exportPeriodPdf(req({ from: 5, to: 5 }), 'd.pdf', false)).rejects.toThrow('pdf:invalidPeriod')
  })

  it('ne remplace jamais un fichier existant sans confirmation', async () => {
    await mockPdf.exportPeriodPdf(req(), 'e.pdf', false)
    await expect(mockPdf.exportPeriodPdf(req(), 'e.pdf', false)).rejects.toThrow('pdf:fileExists')
    await expect(mockPdf.exportPeriodPdf(req(), 'e.pdf', true)).resolves.toBeTruthy()
  })
})
