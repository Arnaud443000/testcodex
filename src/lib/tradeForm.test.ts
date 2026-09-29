import { describe, expect, it } from 'vitest'
import { TAGS, trade } from './fixtures'
import { buildTradeData, emptyForm, formFromTrade, nextRuleState, toggleEmotion, type TradeForm } from './tradeForm'
import type { ChecklistItem } from '../types/trade'

const ITEMS: ChecklistItem[] = [
  { id: 1, label: 'Stop posé', archived: false, position: 0 },
  { id: 2, label: 'Plan relu', archived: false, position: 1 },
]
const NOW = new Date(2026, 8, 28, 9, 42).getTime()

function valid(over: Partial<TradeForm> = {}): TradeForm {
  return { ...emptyForm(1, NOW), instrumentId: 1, entryPrice: '1,0842', size: '1.20', ...over }
}
const build = (f: TradeForm, quick = false) => buildTradeData(f, { checklistItems: ITEMS, quick, tzOffsetMin: 120 })

describe('buildTradeData', () => {
  it('construit le strict minimum d’un trade (Quick add)', () => {
    const { data, errors } = build(valid(), true)
    expect(errors).toEqual({})
    expect(data).toMatchObject({
      accountId: 1,
      instrumentId: 1,
      direction: 'long',
      size: '1.20',
      entryPrice: '1.0842', // virgule française normalisée
      exitPrice: null,
      exitTime: null,
      fees: '0',
      plannedSl: null,
      tzOffsetMin: 120,
      tagIds: [],
      checklist: [],
    })
    expect(data!.entryTime).toBe(NOW)
  })

  it('garde les prix comme chaînes, sans les convertir en nombres', () => {
    const { data } = build(valid({ entryPrice: '90071992547409931.25', plannedSl: '0,00000001' }))
    expect(data!.entryPrice).toBe('90071992547409931.25')
    expect(data!.plannedSl).toBe('0.00000001')
  })

  it('signale chaque champ invalide', () => {
    const { data, errors } = build(
      valid({ accountId: null, instrumentId: null, entryPrice: 'abc', size: '0', plannedSl: '1e5', fees: 'x', entryTime: '' }),
    )
    expect(data).toBeNull()
    expect(Object.keys(errors).sort()).toEqual(['account', 'entryPrice', 'entryTime', 'fees', 'instrument', 'plannedSl', 'size'].sort())
  })

  it('exige prix et heure de sortie ensemble, et une sortie après l’entrée', () => {
    expect(build(valid({ exitPrice: '1.09' })).errors.exitPair).toBe(true)
    expect(build(valid({ exitTime: '2026-09-28T10:00' })).errors.exitPair).toBe(true)
    expect(build(valid({ exitPrice: '1.09', exitTime: '2026-09-28T08:00' })).errors.exitBeforeEntry).toBe(true)
    const ok = build(valid({ exitPrice: '1.09', exitTime: '2026-09-28T10:00' }))
    expect(ok.errors).toEqual({})
    expect(ok.data!.exitTime).toBe(new Date(2026, 8, 28, 10, 0).getTime())
  })

  it('accepte des frais négatifs (crédit de swap)', () => {
    expect(build(valid({ fees: '-1,5' })).data!.fees).toBe('-1.5')
  })

  it('rassemble tags, émotions, règles et checklist', () => {
    const f = valid({
      setupTagId: 5,
      marketTagId: 7,
      timeframeTagId: 4,
      sessionTagId: 2,
      mistakeTagIds: [9],
      emotions: [{ moment: 'before', tagId: 8 }],
      ruleChecks: { 3: true, 4: false },
      checklist: { 1: true },
    })
    const { data } = build(f)
    expect(data!.tagIds.sort()).toEqual([2, 4, 5, 7, 9])
    expect(data!.ruleChecks).toEqual([
      { ruleId: 3, respected: true },
      { ruleId: 4, respected: false },
    ])
    // Saisie complète : chaque élément du modèle reçoit une réponse.
    expect(data!.checklist).toEqual([
      { itemId: 1, label: 'Stop posé', checked: true },
      { itemId: 2, label: 'Plan relu', checked: false },
    ])
  })

  it('en saisie rapide, n’envoie que les éléments de checklist auxquels le trader a répondu', () => {
    expect(build(valid(), true).data!.checklist).toEqual([])
    expect(build(valid({ checklist: { 2: true } }), true).data!.checklist).toEqual([{ itemId: 2, label: 'Plan relu', checked: true }])
  })
})

describe('formFromTrade', () => {
  it('relit un trade enregistré dans le formulaire, puis le reconstruit à l’identique', () => {
    const t = trade({
      id: 7,
      tagIds: [5, 7, 4, 3, 9],
      plannedSl: '99',
      fees: '6.40',
      exitTime: NOW + 3_600_000,
      entryTime: NOW,
      ruleChecks: [{ ruleId: 3, respected: false }],
      checklist: [
        { itemId: 1, label: 'Stop posé', checked: true },
        { itemId: 99, label: 'Ancien élément', checked: true },
        { itemId: null, label: 'Supprimé', checked: false },
      ],
    })
    const f = formFromTrade(t, TAGS, ITEMS)
    expect(f).toMatchObject({ setupTagId: 5, marketTagId: 7, timeframeTagId: 4, sessionTagId: 3, sessionManual: true, mistakeTagIds: [9], fees: '6.40' })
    expect(f.legacyChecklist).toHaveLength(2)
    const { data } = build(f)
    expect(data!.tagIds.sort()).toEqual([3, 4, 5, 7, 9])
    expect(data!.exitTime).toBe(NOW + 3_600_000)
    // Les réponses d'éléments disparus ne sont pas perdues à l'enregistrement.
    expect(data!.checklist.map((a) => a.label)).toEqual(['Stop posé', 'Plan relu', 'Ancien élément', 'Supprimé'])
  })
})

describe('petits helpers', () => {
  it('bascule une émotion par moment', () => {
    const a = toggleEmotion([], 'before', 8)
    expect(a).toEqual([{ moment: 'before', tagId: 8 }])
    expect(toggleEmotion(a, 'during', 8)).toHaveLength(2)
    expect(toggleEmotion(a, 'before', 8)).toEqual([])
  })
  it('fait tourner l’état d’une règle', () => {
    expect(nextRuleState(undefined)).toBe(true)
    expect(nextRuleState(true)).toBe(false)
    expect(nextRuleState(false)).toBeUndefined()
  })
})
