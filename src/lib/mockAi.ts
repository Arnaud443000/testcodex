// Lot 20 : IA optionnelle dans le navigateur. SIMULATION : aucun appel réseau, aucune clé gardée
// (seulement « une clé est enregistrée »). Mêmes règles que pulse-core / pulse-ai : désactivée par
// défaut, consentement de première utilisation + confirmation à chaque envoi, liste exacte envoyée.
import type { Direction, TradeData } from '../types/trade'
import type { AiSendPreview, AiSettingsUpdate, AiStatus, ScreenshotContext, ScreenshotNote, SentField } from '../types/ai'

export const MOCK_DEFAULT_MODEL = 'claude-opus-5-5'
export const MOCK_SUGGESTED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']
/** Limite de l'API : 10 Mo une fois encodée en base64. */
export const MAX_IMAGE_BASE64_BYTES = 10_000_000

export interface AiMockDeps {
  trade: (id: number) => TradeData | undefined
  instrument: (id: number) => { symbol: string; name: string } | undefined
  /** Le screenshot enregistré (URL `data:`), ou `undefined`. */
  screenshot: (path: string) => string | undefined
  now: () => number
}

const aiError = (code: string) => new Error(`ai:${code}`)

/** Même contrôle de forme que `pulse_core::ai::validate_model`. */
export function isValidModel(raw: string): boolean {
  const m = raw.trim()
  return m.length <= 64 && /^claude-[a-z0-9][a-z0-9.-]*$/.test(m)
}

function imageOf(dataUrl: string): { mediaType: string; bytes: number } {
  const [head, body = ''] = dataUrl.split(',', 2)
  const mediaType = /^data:(image\/[a-z]+);base64$/.exec(head)?.[1] ?? 'application/octet-stream'
  const clean = body.replace(/\s/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return { mediaType, bytes: Math.max(0, (clean.length / 4) * 3 - padding) }
}

/** Ce qui partirait : même ordre et mêmes règles que `pulse_core::ai::screenshot_context`. */
export function mockScreenshotContext(tradeId: number, deps: AiMockDeps): ScreenshotContext {
  const t = deps.trade(tradeId)
  if (!t) throw new Error(`not found: trade ${tradeId}`)
  const ins = deps.instrument(t.instrumentId)
  const name = ins?.name.trim() ?? ''
  const fields: SentField[] = [
    { key: 'instrument', value: ins ? (name ? `${ins.symbol} (${name})` : ins.symbol) : '?' },
    { key: 'direction', value: t.direction },
    { key: 'entryPrice', value: t.entryPrice },
  ]
  if (t.plannedSl) fields.push({ key: 'plannedStopLoss', value: t.plannedSl })
  if (t.plannedTp) fields.push({ key: 'plannedTakeProfit', value: t.plannedTp })
  if (t.thesis?.trim()) fields.push({ key: 'thesis', value: t.thesis.trim() })
  let image: ScreenshotContext['image'] = null
  if (t.screenshotPath) {
    const shot = deps.screenshot(t.screenshotPath)
    if (!shot) image = { mediaType: '', bytes: 0, tooLarge: false, missing: true }
    else {
      const { mediaType, bytes } = imageOf(shot)
      image = { mediaType, bytes, tooLarge: Math.ceil(bytes / 3) * 4 > MAX_IMAGE_BASE64_BYTES, missing: false }
    }
  }
  return { tradeId, image, fields }
}

const DIRECTION: Record<Direction, string> = { long: 'achat (long)', short: 'vente (short)' }

/** Réponse fictive, clairement marquée, construite à partir de ce qui aurait été envoyé. */
export function simulatedAnalysis(ctx: ScreenshotContext): string {
  const v = (k: SentField['key']) => ctx.fields.find((f) => f.key === k)?.value
  const thesis = v('thesis')
  return [
    '[Simulation] Réponse fictive produite dans le navigateur, sans appel réseau ni lecture réelle de l’image.',
    '## Contexte visible',
    '- Exemple de description : structure haussière (plus hauts et plus bas croissants), consolidation sous une résistance.',
    '## Niveaux et position du stop loss / take profit',
    `- Entrée : ${v('entryPrice') ?? 'non renseignée'} ; stop loss prévu : ${v('plannedStopLoss') ?? 'non renseigné'} ; take profit prévu : ${v('plannedTakeProfit') ?? 'non renseigné'}.`,
    '## Confrontation avec la thèse',
    thesis
      ? `- Thèse déclarée (${DIRECTION[v('direction') as Direction] ?? '?'}) : « ${thesis} ».`
      : '- Aucune thèse saisie : pas de confrontation possible.',
    '## Incohérences relevées',
    v('plannedStopLoss') ? '- Aucune incohérence nette.' : '- Aucun stop loss prévu n’est renseigné sur ce trade.',
  ].join('\n')
}

export function createAiMock(deps: AiMockDeps) {
  let enabled = false
  let model = MOCK_DEFAULT_MODEL
  let consentAt: number | null = null
  let keyStored = false
  let nextId = 1
  const notes: ScreenshotNote[] = []

  const status = (): AiStatus => ({
    settings: { enabled, model, consentAt },
    vaultAvailable: true,
    keyStored,
    provider: 'simulation',
    providerHost: 'api.anthropic.com',
    defaultModel: MOCK_DEFAULT_MODEL,
    suggestedModels: [...MOCK_SUGGESTED_MODELS],
  })
  // Les commentaires partent avec leur trade (comme ON DELETE CASCADE).
  const alive = () => notes.filter((n) => deps.trade(n.tradeId))

  return {
    getAiStatus: async (): Promise<AiStatus> => status(),
    setAiSettings: async (u: AiSettingsUpdate): Promise<AiStatus> => {
      if (!isValidModel(u.model)) throw new Error('invalid input: the model must look like claude-…')
      enabled = u.enabled
      model = u.model.trim()
      if (!enabled) consentAt = null
      return status()
    },
    recordAiConsent: async (): Promise<AiStatus> => {
      if (!enabled) throw new Error('invalid input: the AI option is turned off')
      consentAt = deps.now()
      return status()
    },
    saveAiKey: async (key: string): Promise<AiStatus> => {
      const k = key.trim()
      if (!k || k.length > 256 || /[\s\u0000-\u001f\u007f-￿]/.test(k)) throw aiError('keyFormat')
      keyStored = true // la clé elle-même n'est jamais gardée, même en simulation
      return status()
    },
    deleteAiKey: async (): Promise<AiStatus> => {
      keyStored = false
      return status()
    },
    testAiConnection: async (): Promise<void> => {
      if (!enabled) throw aiError('disabled')
      if (!keyStored) throw aiError('noKey')
    },
    previewScreenshotAnalysis: async (tradeId: number): Promise<AiSendPreview> => ({
      context: mockScreenshotContext(tradeId, deps),
      enabled,
      firstUse: consentAt == null,
      provider: 'simulation',
      providerHost: 'api.anthropic.com',
      model,
    }),
    analyzeScreenshot: async (tradeId: number, confirmed: boolean): Promise<ScreenshotNote> => {
      if (!enabled) throw aiError('disabled')
      if (consentAt == null || !confirmed) throw aiError('consentRequired')
      const ctx = mockScreenshotContext(tradeId, deps)
      if (!ctx.image || ctx.image.missing) throw aiError('noScreenshot')
      if (ctx.image.tooLarge) throw aiError('imageTooLarge')
      if (!keyStored) throw aiError('noKey')
      await new Promise((r) => setTimeout(r, 600))
      const note: ScreenshotNote = {
        id: nextId++,
        tradeId,
        createdAt: deps.now(),
        provider: 'simulation',
        model,
        sent: ctx.fields.map((f) => f.key),
        content: simulatedAnalysis(ctx),
      }
      notes.push(note)
      return note
    },
    listScreenshotNotes: async (tradeId: number): Promise<ScreenshotNote[]> =>
      alive()
        .filter((n) => n.tradeId === tradeId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
    deleteScreenshotNote: async (id: number): Promise<void> => {
      const i = notes.findIndex((n) => n.id === id)
      if (i < 0) throw new Error(`not found: AI comment ${id}`)
      notes.splice(i, 1)
    },
  }
}
