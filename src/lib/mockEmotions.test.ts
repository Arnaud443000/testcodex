import { beforeAll, describe, expect, it } from 'vitest'
import { EMOTION_CATALOG } from './emotionCatalog'
import { mock } from './mockBackend'
import type { TradeData } from '../types/trade'

let accountId = 0
let instrumentId = 0

const tradeWith = (tagId: number): TradeData => ({
  accountId,
  instrumentId,
  direction: 'long',
  size: '1',
  entryPrice: '100',
  exitPrice: '90',
  entryTime: 3_600_000,
  exitTime: 7_200_000,
  tzOffsetMin: 0,
  fees: '0',
  thesis: '',
  postMortem: '',
  tagIds: [],
  emotions: [{ moment: 'before', tagId }],
  ruleChecks: [],
  checklist: [],
})

const myList = async () => (await mock.listTags('emotion')).map((t) => t.name)

beforeAll(async () => {
  accountId = (await mock.createAccount({ name: 'Emo', kind: 'personal', broker: '', currency: 'USD', initialCapital: '1000' })).id
  instrumentId = (await mock.listInstruments())[0].id
})

// Miroir de crates/pulse-core/src/emotions/tests.rs.
describe('Ma liste d’émotions (faux backend)', () => {
  it('sert le catalogue et toutes les émotions semées y figurent', async () => {
    const catalog = await mock.getEmotionCatalog()
    expect(catalog).toEqual(EMOTION_CATALOG)
    const all = new Set(catalog.flatMap((g) => g.emotions.map((e) => e.toLowerCase())))
    for (const n of await myList()) expect(all.has(n.toLowerCase())).toBe(true)
  })

  it('ajoute une émotion du catalogue une seule fois (casse et espaces ignorés)', async () => {
    const tag = await mock.addEmotionToList('Avidité')
    expect(tag.archived).toBe(false)
    expect((await mock.addEmotionToList('  AVIDITÉ ')).id).toBe(tag.id)
    expect((await mock.listTags('emotion', true)).filter((t) => t.name === 'Avidité')).toHaveLength(1)
  })

  it('réactive une émotion archivée sans doublon', async () => {
    const calme = (await mock.listTags('emotion')).find((t) => t.name === 'Calme')!
    await mock.removeEmotionFromList(calme.id)
    expect(await myList()).not.toContain('Calme')
    const back = await mock.addEmotionToList('calme')
    expect(back.id).toBe(calme.id)
    expect(back.archived).toBe(false)
    expect((await mock.listTags('emotion', true)).filter((t) => t.name === 'Calme')).toHaveLength(1)
  })

  it('valide la saisie libre : non vide, 40 caractères au plus, espaces réduits', async () => {
    await expect(mock.addEmotionToList('   ')).rejects.toThrow('required')
    await expect(mock.addEmotionToList('x'.repeat(41))).rejects.toThrow('limited')
    expect((await mock.addEmotionToList('é'.repeat(40))).name).toHaveLength(40)
    expect((await mock.addEmotionToList('  Mon   humeur ')).name).toBe('Mon humeur')
  })

  it('retirer archive : le tag, l’émotion du trade et les statistiques par émotion restent', async () => {
    const doute = (await mock.listTags('emotion')).find((t) => t.name === 'Doute')!
    const trade = await mock.createTrade(tradeWith(doute.id))
    const query = { accountIds: [accountId] }
    const before = await mock.getEmotions(query)
    expect(before.any.some((s) => s.label === 'Doute' && s.summary.tradeCount === 1)).toBe(true)
    await mock.removeEmotionFromList(doute.id)
    expect(await myList()).not.toContain('Doute')
    expect((await mock.listTags('emotion', true)).some((t) => t.id === doute.id)).toBe(true)
    expect((await mock.getTrade(trade.id)).emotions).toEqual([{ moment: 'before', tagId: doute.id }])
    expect(await mock.getEmotions(query)).toEqual(before)
  })

  it('refuse de retirer ou supprimer un tag qui n’est pas une émotion', async () => {
    const setup = await mock.createTag('setup', 'Breakout émo')
    await expect(mock.removeEmotionFromList(setup.id)).rejects.toThrow('not an emotion')
    await expect(mock.deleteUnusedEmotion(setup.id)).rejects.toThrow('not an emotion')
    expect(setup.archived).toBe(false)
  })

  it('supprime seulement une émotion jamais utilisée', async () => {
    const used = (await mock.listTags('emotion')).find((t) => t.name === 'Stress')!
    await mock.createTrade(tradeWith(used.id))
    const unused = await mock.addEmotionToList('Sérénité')
    const usage = await mock.getEmotionUsage()
    expect(usage.find((u) => u.tagId === used.id)!.tradeCount).toBe(1)
    expect(usage.find((u) => u.tagId === unused.id)!.tradeCount).toBe(0)
    await expect(mock.deleteUnusedEmotion(used.id)).rejects.toThrow('remove it from the list')
    await mock.deleteUnusedEmotion(unused.id)
    expect((await mock.listTags('emotion', true)).some((t) => t.id === unused.id)).toBe(false)
  })
})
