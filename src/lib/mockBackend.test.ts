import { beforeAll, describe, expect, it } from 'vitest'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'
import { trimDecimal } from './decimal'

const H = 3_600_000
let accountId = 0
let eurusd = 0

/** Le trade EURUSD de la maquette : 1,20 lot, 1.0842 → 1.0871, SL 1.0824, TP 1.0888, frais 6.40. */
const base = (): TradeData => ({
  accountId,
  instrumentId: eurusd,
  direction: 'long',
  size: '1.20',
  entryPrice: '1.0842',
  exitPrice: '1.0871',
  entryTime: 9 * H,
  exitTime: 9 * H + 72 * 60_000,
  tzOffsetMin: 0,
  plannedSl: '1.0824',
  plannedTp: '1.0888',
  fees: '6.40',
  thesis: '',
  postMortem: '',
  tagIds: [],
  emotions: [],
  ruleChecks: [],
  checklist: [],
})

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Main', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  eurusd = (await mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
})

describe('mock du navigateur', () => {
  it('calcule le trade de la maquette à la main : brut 348, net 341,60, risque 216', async () => {
    const p = await mock.previewTrade(base())
    expect(trimDecimal(p.figures!.grossPnl)).toBe('348.00')
    expect(trimDecimal(p.figures!.netPnl)).toBe('341.60')
    expect(p.figures!.outcome).toBe('win')
    expect(trimDecimal(p.initialRisk!)).toBe('216.00')
    expect(p.figures!.rMultiple).toBeCloseTo(341.6 / 216, 5)
    expect(p.plannedRewardRisk).toBeCloseTo(46 / 18, 5)
    expect(p.riskPctOfCapital).toBeCloseTo(2.16, 5)
    expect(p.session).toBe('Londres')
    expect(p.stopLoss).toBe('valid')
  })

  it('signale l’absence de stop et un stop du mauvais côté', async () => {
    expect((await mock.previewTrade({ ...base(), plannedSl: null })).stopLoss).toBe('missing')
    const bad = await mock.previewTrade({ ...base(), plannedSl: '1.09' })
    expect(bad.stopLoss).toBe('invalid')
    expect(bad.figures!.rMultiple).toBeNull()
  })

  it('gère un short perdant', async () => {
    const p = await mock.previewTrade({ ...base(), direction: 'short', plannedSl: '1.0860', plannedTp: null })
    // (1.0871 − 1.0842) × −1 × 1,20 × 100 000 = −348 ; net −354,40
    expect(trimDecimal(p.figures!.netPnl)).toBe('-354.40')
    expect(p.figures!.outcome).toBe('loss')
  })

  it('enregistre, relit, modifie et supprime un trade', async () => {
    const saved = await mock.createTrade({ ...base(), priceAfterExit: '1.0889', thesis: 'Retest' })
    expect(saved.symbol).toBe('EURUSD')
    expect(trimDecimal(saved.opportunityCost!)).toBe('216.00')
    expect((await mock.getTrade(saved.id)).thesis).toBe('Retest')
    const edited = await mock.updateTrade(saved.id, { ...base(), fees: '0' })
    expect(trimDecimal(edited.figures!.netPnl)).toBe('348.00')
    expect((await mock.listTrades()).map((t) => t.id)).toContain(saved.id)
    await mock.deleteTrade(saved.id)
    await expect(mock.getTrade(saved.id)).rejects.toThrow(/not found/)
  })

  it('refuse les mêmes cas que pulse-core', async () => {
    await expect(mock.createTrade({ ...base(), size: '0' })).rejects.toThrow(/size must be greater than zero/)
    await expect(mock.createTrade({ ...base(), exitTime: null })).rejects.toThrow(/go together/)
    await expect(mock.createTrade({ ...base(), exitTime: 1 })).rejects.toThrow(/before entry/)
    await expect(mock.createTrade({ ...base(), plannedSl: '1.09' })).rejects.toThrow(/below the entry price/)
    await expect(mock.createTrade({ ...base(), accountId: 999 })).rejects.toThrow(/unknown account/)
    const setups = [await mock.createTag('setup', 'A'), await mock.createTag('setup', 'B')]
    await expect(mock.createTrade({ ...base(), tagIds: setups.map((t) => t.id) })).rejects.toThrow(/only one setup tag/)
  })

  it('refuse les doublons d’actifs et de tags (casse et espaces ignorés)', async () => {
    await expect(mock.createInstrument({ symbol: 'eur/usd', assetClass: 'forex', defaultMultiplier: '1' })).rejects.toThrow(/already exists/)
    await mock.createTag('setup', 'Breakout  NY')
    await expect(mock.createTag('setup', 'breakout ny')).rejects.toThrow(/already exists/)
  })

  it('range et relit une capture d’écran, refuse un fichier qui n’est pas une image', async () => {
    const path = await mock.saveScreenshot('data:image/png;base64,AAAA')
    expect(await mock.readScreenshot(path)).toBe('data:image/png;base64,AAAA')
    await expect(mock.saveScreenshot('data:text/plain;base64,AAAA')).rejects.toThrow(/unsupported/)
  })
})

describe('faux backend : export et sauvegarde', () => {
  it('sauvegarde puis restaure : les données ajoutées après la sauvegarde disparaissent', async () => {
    const before = (await mock.listTrades({})).length
    const backup = await mock.createBackup('(dossier)')
    expect(backup.trades).toBe(before)
    await mock.createTrade({ ...base(), entryTime: 20 * H, exitTime: 21 * H })
    expect((await mock.listTrades({})).length).toBe(before + 1)
    await expect(mock.restoreBackup(backup.path, false)).rejects.toThrow('not confirmed')
    expect((await mock.listTrades({})).length).toBe(before + 1)
    const res = await mock.restoreBackup(backup.path, true)
    expect(res.info.trades).toBe(before)
    expect((await mock.listTrades({})).length).toBe(before)
    expect((await mock.inspectBackup(res.safetyCopy)).trades).toBe(before + 1)
  })

  it('refuse un dossier qui n’est pas une sauvegarde', async () => {
    await expect(mock.inspectBackup('(inconnu)')).rejects.toThrow()
    expect(await mock.exportTradesCsv('x.csv')).toBe((await mock.listTrades({})).length)
  })
})
