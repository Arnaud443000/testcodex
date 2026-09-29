import { describe, expect, it } from 'vitest'
import type { TradeData } from '../types/trade'
import { createAiMock, isValidModel, mockScreenshotContext, type AiMockDeps } from './mockAi'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

function trade(over: Partial<TradeData> = {}): TradeData {
  return {
    accountId: 1,
    instrumentId: 7,
    direction: 'long',
    size: '1.20',
    entryPrice: '1.0842',
    entryTime: 1_700_000_000_000,
    plannedSl: '1.0824',
    plannedTp: '1.0890',
    fees: '6.40',
    thesis: '  Cassure du range asiatique.  ',
    postMortem: 'SECRET-POST-MORTEM',
    screenshotPath: 'screenshots/a.png',
    tagIds: [],
    emotions: [],
    ruleChecks: [],
    checklist: [],
    ...over,
  } as TradeData
}

function setup(t: TradeData | undefined = trade()) {
  const trades = new Map<number, TradeData>(t ? [[1, t]] : [])
  const deps: AiMockDeps = {
    trade: (id) => trades.get(id),
    instrument: (id) => (id === 7 ? { symbol: 'EURUSD', name: 'Euro / Dollar US' } : undefined),
    screenshot: (p) => (p === 'screenshots/a.png' ? PNG : undefined),
    now: () => 1_700_000_000_000,
  }
  return { ai: createAiMock(deps), deps, trades }
}

async function ready() {
  const s = setup()
  await s.ai.setAiSettings({ enabled: true, model: 'claude-opus-5-5' })
  await s.ai.recordAiConsent()
  await s.ai.saveAiKey('sk-test-NOT-A-REAL-KEY')
  return s
}

describe('IA simulée (navigateur)', () => {
  it('est désactivée par défaut, avec le modèle par défaut du skill', async () => {
    const { ai } = setup()
    const st = await ai.getAiStatus()
    expect(st.settings).toEqual({ enabled: false, model: 'claude-opus-5-5', consentAt: null })
    expect(st.keyStored).toBe(false)
    expect(st.provider).toBe('simulation')
    expect(st.suggestedModels).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'])
  })

  it('liste exactement les données envoyées, dans le même ordre que pulse-core', () => {
    const { deps } = setup()
    const ctx = mockScreenshotContext(1, deps)
    expect(ctx.fields).toEqual([
      { key: 'instrument', value: 'EURUSD (Euro / Dollar US)' },
      { key: 'direction', value: 'long' },
      { key: 'entryPrice', value: '1.0842' },
      { key: 'plannedStopLoss', value: '1.0824' },
      { key: 'plannedTakeProfit', value: '1.0890' },
      { key: 'thesis', value: 'Cassure du range asiatique.' },
    ])
    expect(JSON.stringify(ctx)).not.toContain('SECRET-POST-MORTEM')
    expect(JSON.stringify(ctx)).not.toContain('6.40')
    expect(ctx.image).toMatchObject({ mediaType: 'image/png', tooLarge: false, missing: false })
  })

  it('omet les champs vides et signale un screenshot absent', () => {
    const { deps } = setup(trade({ plannedSl: null, plannedTp: null, thesis: ' ', screenshotPath: 'screenshots/gone.png' }))
    const ctx = mockScreenshotContext(1, deps)
    expect(ctx.fields.map((f) => f.key)).toEqual(['instrument', 'direction', 'entryPrice'])
    expect(ctx.image?.missing).toBe(true)
    expect(mockScreenshotContext(1, setup(trade({ screenshotPath: null })).deps).image).toBeNull()
  })

  it("refuse d'envoyer sans IA activée, sans consentement, sans confirmation, sans clé", async () => {
    const { ai } = setup()
    await expect(ai.analyzeScreenshot(1, true)).rejects.toThrow('ai:disabled')
    await expect(ai.testAiConnection()).rejects.toThrow('ai:disabled')
    await ai.setAiSettings({ enabled: true, model: 'claude-opus-5-5' })
    await expect(ai.analyzeScreenshot(1, true)).rejects.toThrow('ai:consentRequired')
    await ai.recordAiConsent()
    await expect(ai.analyzeScreenshot(1, false)).rejects.toThrow('ai:consentRequired')
    await expect(ai.analyzeScreenshot(1, true)).rejects.toThrow('ai:noKey')
    await expect(ai.testAiConnection()).rejects.toThrow('ai:noKey')
  })

  it('éteindre l’IA oublie le consentement ; un modèle mal formé est refusé', async () => {
    const { ai } = await ready()
    expect((await ai.getAiStatus()).settings.consentAt).not.toBeNull()
    await ai.setAiSettings({ enabled: false, model: 'claude-opus-5-5' })
    expect((await ai.getAiStatus()).settings.consentAt).toBeNull()
    await expect(ai.setAiSettings({ enabled: true, model: 'gpt-4' })).rejects.toThrow()
    expect(isValidModel('claude-haiku-4-5')).toBe(true)
    expect(isValidModel('claude--x')).toBe(false)
    expect(isValidModel('claude-')).toBe(false)
  })

  it('ne garde jamais la clé, même en simulation', async () => {
    const { ai } = await ready()
    const st = await ai.getAiStatus()
    expect(st.keyStored).toBe(true)
    expect(JSON.stringify(st)).not.toContain('sk-test')
    await expect(ai.saveAiKey('sk with space')).rejects.toThrow('ai:keyFormat')
    await ai.deleteAiKey()
    expect((await ai.getAiStatus()).keyStored).toBe(false)
  })

  it('produit un commentaire marqué « Simulation », listé puis supprimé, et parti avec son trade', async () => {
    const { ai, trades } = await ready()
    const note = await ai.analyzeScreenshot(1, true)
    expect(note.provider).toBe('simulation')
    expect(note.content.startsWith('[Simulation]')).toBe(true)
    expect(note.content).toContain('## Incohérences relevées')
    expect(note.sent).toEqual(['instrument', 'direction', 'entryPrice', 'plannedStopLoss', 'plannedTakeProfit', 'thesis'])
    const second = await ai.analyzeScreenshot(1, true)
    expect((await ai.listScreenshotNotes(1)).map((n) => n.id)).toEqual([second.id, note.id])
    await ai.deleteScreenshotNote(note.id)
    await expect(ai.deleteScreenshotNote(note.id)).rejects.toThrow('not found')
    trades.delete(1)
    expect(await ai.listScreenshotNotes(1)).toEqual([])
  })

  it('refuse un trade sans screenshot', async () => {
    const s = setup(trade({ screenshotPath: null }))
    await s.ai.setAiSettings({ enabled: true, model: 'claude-opus-5-5' })
    await s.ai.recordAiConsent()
    await s.ai.saveAiKey('sk-x')
    await expect(s.ai.analyzeScreenshot(1, true)).rejects.toThrow('ai:noScreenshot')
  })
})
