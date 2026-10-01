import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTradePrefill, buildSizingRequest, emptySizingForm, loadSizingMemory, saveSizingMemory, seedToForm, sizingWarnings,
  tradePrefill, type SizingForm,
} from './sizingForm'
import { emptyForm } from './tradeForm'
import type { Sizing } from '../types/sizing'

const ready = (over: Partial<SizingForm> = {}): SizingForm => ({ ...emptySizingForm(), accountId: 1, instrumentId: 2, entry: '1,1000', stop: '1.0950', ...over })

describe('buildSizingRequest', () => {
  it('saisie à la française : virgule et espaces acceptés, chaînes décimales exactes', () => {
    const { request, errors, incomplete } = buildSizingRequest(ready({ entry: '1 234,5', riskValue: '0,5', takeProfit: '1,12', multiplier: '100 000', sizeStep: '0,01' }))
    expect(incomplete).toBe(false)
    expect(errors).toEqual({})
    expect(request).toEqual({
      accountId: 1, instrumentId: 2, direction: 'long', entryPrice: '1234.5', stopLoss: '1.0950', takeProfit: '1.12',
      riskMode: 'percent', riskValue: '0.5', multiplier: '100000', sizeStep: '0.01',
    })
  })

  it('champs facultatifs vides = null (l’actif et la classe décident)', () => {
    const { request } = buildSizingRequest(ready())
    expect(request?.takeProfit).toBeNull()
    expect(request?.multiplier).toBeNull()
    expect(request?.sizeStep).toBeNull()
  })

  it('un champ obligatoire vide est « incomplet », jamais une erreur', () => {
    for (const over of [{ accountId: null }, { instrumentId: null }, { entry: '' }, { stop: '  ' }, { riskValue: '' }]) {
      const r = buildSizingRequest(ready(over))
      expect(r.incomplete).toBe(true)
      expect(r.request).toBeNull()
      expect(r.errors).toEqual({})
    }
  })

  it('un texte illisible est une erreur de champ, pas d’envoi', () => {
    const r = buildSizingRequest(ready({ entry: '1e5', stop: 'abc', takeProfit: '1.2.3', riskValue: '-1', multiplier: 'x', sizeStep: '1;2' }))
    expect(r.request).toBeNull()
    expect(Object.keys(r.errors).sort()).toEqual(['entry', 'multiplier', 'risk', 'sizeStep', 'stop', 'takeProfit'])
  })

  it('les valeurs douteuses (0, stop du mauvais côté) partent quand même : pulse-core décide et refuse', () => {
    const r = buildSizingRequest(ready({ riskValue: '0', stop: '1.2', direction: 'long' }))
    expect(r.request).not.toBeNull()
  })
})

describe('sizingWarnings', () => {
  const base = { exceedsMaxRisk: false, takeProfitWrongSide: false, sizeStepIsDefault: false } as Sizing
  it('dans l’ordre d’importance, seulement ce que le résultat annonce', () => {
    expect(sizingWarnings(base)).toEqual([])
    expect(sizingWarnings({ ...base, sizeStepIsDefault: true, takeProfitWrongSide: true, exceedsMaxRisk: true })).toEqual(['exceedsMax', 'takeProfitWrongSide', 'defaultStep'])
  })
})

describe('mémoire locale', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } })
  })

  it('garde le compte, l’actif et le risque, jamais un prix', () => {
    saveSizingMemory(ready({ riskMode: 'amount', riskValue: '50', takeProfit: '1.2', multiplier: '10' }))
    const raw = store.get('pulse.sizing.v1') ?? ''
    expect(JSON.parse(raw)).toEqual({ accountId: 1, instrumentId: 2, riskMode: 'amount', riskValue: '50' })
    expect(raw).not.toContain('1.1000')
    expect(loadSizingMemory()).toEqual({ accountId: 1, instrumentId: 2, riskMode: 'amount', riskValue: '50' })
  })

  it('une mémoire absente ou abîmée ne bloque rien', () => {
    expect(loadSizingMemory()).toBeNull()
    store.set('pulse.sizing.v1', '{pas du json')
    expect(loadSizingMemory()).toBeNull()
    store.set('pulse.sizing.v1', JSON.stringify({ accountId: 'x', riskMode: 'zzz', riskValue: '1e5' }))
    expect(loadSizingMemory()).toEqual({ accountId: null, instrumentId: null, riskMode: 'percent', riskValue: '' })
  })
})

describe('passerelles avec le formulaire de trade', () => {
  it('« Utiliser dans un nouveau trade » préremplit sans rien enregistrer', () => {
    const { request } = buildSizingRequest(ready({ direction: 'short', stop: '1.1050', takeProfit: '1.09' }))
    const result = { size: '0.20', multiplier: '100000' } as Sizing
    const form = applyTradePrefill(emptyForm(9, 0), tradePrefill(request!, result))
    expect(form).toMatchObject({
      accountId: 1, instrumentId: 2, direction: 'short', entryPrice: '1.1000', plannedSl: '1.1050', plannedTp: '1.09', multiplier: '100000', size: '0.20',
    })
    expect(form.exitPrice).toBe('')
    expect(form.plannedSl).not.toBe('')
  })

  it('« Calculer la taille » depuis le formulaire remplit le calculateur, le risque reste celui du calculateur', () => {
    const f = seedToForm({ accountId: 3, instrumentId: 4, direction: 'short', entry: '5', stop: '6', takeProfit: '', multiplier: '' }, { ...emptySizingForm(), riskValue: '2' })
    expect(f).toMatchObject({ accountId: 3, instrumentId: 4, direction: 'short', entry: '5', stop: '6', riskValue: '2' })
  })
})
