import { describe, expect, it } from 'vitest'
import { DEFAULT_FORM, formFromSettings, parseForm } from './behaviorSettingsForm'

describe('formulaire des seuils', () => {
  it('affiche les réglages avec la virgule française et un seuil désactivé vide', () => {
    expect(formFromSettings({ maxRiskPercent: '1.5', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' })).toEqual({
      maxRiskPercent: '1,5',
      maxTradesPerDay: '',
      revengeWindowMin: '60',
      revengeSizeFactor: '1,5',
    })
  })

  it('les valeurs par défaut sont valides et laissent risque et surtrading désactivés', () => {
    expect(parseForm(DEFAULT_FORM)).toEqual({ settings: { maxRiskPercent: null, maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' } })
  })

  it('lit une saisie à la française sans passer par un flottant', () => {
    const r = parseForm({ maxRiskPercent: ' 0,25 ', maxTradesPerDay: '3', revengeWindowMin: '30', revengeSizeFactor: '2,00' })
    expect(r).toEqual({ settings: { maxRiskPercent: '0.25', maxTradesPerDay: 3, revengeWindowMin: 30, revengeSizeFactor: '2.00' } })
  })

  it('refuse les valeurs hors bornes, champ par champ', () => {
    for (const risk of ['0', '100,01', '-1', 'abc', '1e2']) {
      expect(parseForm({ ...DEFAULT_FORM, maxRiskPercent: risk })).toEqual({ errors: { maxRiskPercent: true } })
    }
    expect(parseForm({ ...DEFAULT_FORM, maxRiskPercent: '100' })).toHaveProperty('settings')
    for (const n of ['0', '1,5', 'x', '-2']) expect(parseForm({ ...DEFAULT_FORM, maxTradesPerDay: n })).toEqual({ errors: { maxTradesPerDay: true } })
    for (const w of ['', '0', '1441', '1,5']) expect(parseForm({ ...DEFAULT_FORM, revengeWindowMin: w })).toEqual({ errors: { revengeWindowMin: true } })
    for (const f of ['', '0,9', 'x']) expect(parseForm({ ...DEFAULT_FORM, revengeSizeFactor: f })).toEqual({ errors: { revengeSizeFactor: true } })
    expect(parseForm({ maxRiskPercent: '0', maxTradesPerDay: '0', revengeWindowMin: '0', revengeSizeFactor: '0' })).toEqual({
      errors: { maxRiskPercent: true, maxTradesPerDay: true, revengeWindowMin: true, revengeSizeFactor: true },
    })
  })
})
