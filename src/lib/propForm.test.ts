import { describe, expect, it } from 'vitest'
import { buildPropInput, emptyPropForm, formFromRules, normalizeTime, pickPropAccount, type PropForm } from './propForm'
import { validatePropRules } from './mockProp'

const filled = (over: Partial<PropForm> = {}): PropForm => ({
  ...emptyPropForm('2026-09-01'),
  resetTime: '17:00',
  resetZone: 'newYork',
  dailyLoss: { enabled: true, mode: 'percent', value: '5' },
  maxLoss: { enabled: true, mode: 'percent', value: '10' },
  ...over,
})

describe('éditeur des règles prop firm (lot 33)', () => {
  it('formulaire vierge : rien de deviné (heure et fuseau à saisir, aucune règle)', () => {
    const f = emptyPropForm('2026-09-30')
    expect([f.startedOn, f.resetTime, f.resetZone, f.dailyLoss.enabled, f.maxLoss.enabled, f.profitTarget.enabled]).toEqual(['2026-09-30', '', '', false, false, false])
    expect(buildPropInput(f).errors).toEqual({ resetTime: 'required', resetZone: 'required' })
  })
  it('saisie à la française normalisée ; règles décochées = null', () => {
    const { input, errors } = buildPropInput(
      filled({ resetTime: '9h30', dailyLoss: { enabled: true, mode: 'amount', value: '2 500,50' }, consistency: '30,5', minTradingDays: ' 4 ', phaseLabel: '  Financé ' }),
    )
    expect(errors).toEqual({})
    expect(input).toEqual({
      phaseLabel: 'Financé',
      startedOn: '2026-09-01',
      dailyLoss: { mode: 'amount', value: '2500.50' },
      dailyReference: 'initialBalance',
      maxLoss: { mode: 'percent', value: '10' },
      maxLossKind: 'static',
      trailingLocksAtInitial: false,
      resetTime: '09:30',
      resetZone: 'newYork',
      profitTarget: null,
      minTradingDays: 4,
      consistencyMaxBestDayPercent: '30.5',
    })
    // Le cœur (miroir) accepte ce que l'interface a construit.
    expect(() => validatePropRules(1, input!)).not.toThrow()
  })
  it('contrôles de forme : pourcentage 0 / 100 / 100,01, montant négatif, heure, date, jours', () => {
    const e = (over: Partial<PropForm>) => buildPropInput(filled(over)).errors
    expect(e({ dailyLoss: { enabled: true, mode: 'percent', value: '0' } })).toEqual({ dailyLoss: 'percent' })
    expect(e({ dailyLoss: { enabled: true, mode: 'percent', value: '100' } })).toEqual({})
    expect(e({ maxLoss: { enabled: true, mode: 'percent', value: '100,01' } })).toEqual({ maxLoss: 'percent' })
    expect(e({ maxLoss: { enabled: true, mode: 'amount', value: '-5' } })).toEqual({ maxLoss: 'amount' })
    expect(e({ maxLoss: { enabled: true, mode: 'amount', value: '0' } })).toEqual({ maxLoss: 'amount' })
    expect(e({ profitTarget: { enabled: true, mode: 'percent', value: '' } })).toEqual({ profitTarget: 'required' })
    expect(e({ profitTarget: { enabled: true, mode: 'percent', value: '1e3' } })).toEqual({ profitTarget: 'number' })
    expect(e({ resetTime: '24:00' })).toEqual({ resetTime: 'time' })
    expect(e({ startedOn: '2026-02-30' })).toEqual({ startedOn: 'day' })
    expect(e({ minTradingDays: '0' })).toEqual({ minTradingDays: 'wholeDays' })
    expect(e({ minTradingDays: '2,5' })).toEqual({ minTradingDays: 'wholeDays' })
    expect(e({ consistency: '0' })).toEqual({ consistency: 'percent' })
    expect(e({ consistency: '-10' })).toEqual({ consistency: 'percent' })
    // Une règle décochée n'est pas contrôlée.
    expect(e({ dailyLoss: { enabled: false, mode: 'percent', value: 'n’importe quoi' } })).toEqual({})
  })
  it('le verrou au capital initial ne vaut que pour une perte maximale glissante', () => {
    expect(buildPropInput(filled({ trailingLocksAtInitial: true })).input!.trailingLocksAtInitial).toBe(false)
    expect(buildPropInput(filled({ trailingLocksAtInitial: true, maxLossKind: 'trailing' })).input!.trailingLocksAtInitial).toBe(true)
  })
  it('aller-retour règles → formulaire → saisie', () => {
    const rules = validatePropRules(3, buildPropInput(filled({ consistency: '30', profitTarget: { enabled: true, mode: 'percent', value: '8,5' } })).input!)
    const back = buildPropInput(formFromRules(rules)).input!
    expect(validatePropRules(3, back)).toEqual(rules)
    expect(formFromRules(rules).profitTarget.value).toBe('8,5')
  })
  it('heures lisibles', () => {
    expect([normalizeTime('9:00'), normalizeTime('17h00'), normalizeTime('00:00'), normalizeTime('23:59'), normalizeTime('24:00'), normalizeTime('9')]).toEqual([
      '09:00', '17:00', '00:00', '23:59', null, null,
    ])
  })
  it('compte choisi : mémorisé, sinon celui de la barre du haut s’il est prop, sinon le premier', () => {
    expect(pickPropAccount([4, 7], null, 7)).toBe(7)
    expect(pickPropAccount([4, 7], 7, null)).toBe(7)
    expect(pickPropAccount([4, 7], 2, null)).toBe(4)
    expect(pickPropAccount([4, 7], 2, 9)).toBe(4)
    expect(pickPropAccount([], 2, null)).toBeNull()
  })
})
