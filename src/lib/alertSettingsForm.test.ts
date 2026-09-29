import { describe, expect, it } from 'vitest'
import type { BehaviorSettings } from '../types/behavior'
import {
  ALERT_DEFAULTS,
  DEFAULT_ALERT_FORM,
  formFromSettings,
  normalizeTime,
  parseAlertForm,
  setEnabled,
  setValue,
  type AlertForm,
} from './alertSettingsForm'
import { DEFAULT_ALERT_SETTINGS } from './mockAlerts'

const BEHAVIOR: BehaviorSettings = { maxRiskPercent: '1.5', maxTradesPerDay: null, revengeWindowMin: 60, revengeSizeFactor: '1.5' }
const base = () => formFromSettings(DEFAULT_ALERT_SETTINGS, BEHAVIOR)
const ok = (f: AlertForm) => {
  const r = parseAlertForm(f)
  if ('errors' in r) throw new Error(`erreurs : ${Object.keys(r.errors)}`)
  return r.settings
}
const errs = (f: AlertForm) => {
  const r = parseAlertForm(f)
  if (!('errors' in r)) throw new Error('aucune erreur')
  return Object.keys(r.errors).sort()
}
const edit = (f: AlertForm, patch: Partial<AlertForm['values']>): AlertForm => ({ ...f, values: { ...f.values, ...patch } })

describe('formulaire des seuils d’alerte', () => {
  it('les défauts affichés sont ceux du moteur', () => {
    const d = formFromSettings(DEFAULT_ALERT_SETTINGS, { ...BEHAVIOR, maxRiskPercent: null })
    expect(d.values.consecutiveLosses).toBe(ALERT_DEFAULTS.consecutiveLosses)
    expect(d.values.burstMaxTrades).toBe(ALERT_DEFAULTS.burstMaxTrades)
    expect(d.values.burstWindowMin).toBe(ALERT_DEFAULTS.burstWindowMin)
    expect(d.values.dailyLossPercent).toBe(ALERT_DEFAULTS.dailyLossPercent)
    expect(d.values.weeklyLossPercent).toBe(ALERT_DEFAULTS.weeklyLossPercent)
    expect(d.values.revengeWindowMin).toBe(ALERT_DEFAULTS.revengeWindowMin)
    expect(d.values.revengeSizeFactor).toBe(ALERT_DEFAULTS.revengeSizeFactor)
    expect(d).toEqual(DEFAULT_ALERT_FORM)
  })

  it('aller-retour : réglages → formulaire → réglages', () => {
    const settings = {
      ...DEFAULT_ALERT_SETTINGS,
      dailyLossAmount: '250.50',
      tradingHours: '22:00-02:00',
      revenge: false,
    }
    const behavior = { ...BEHAVIOR, maxTradesPerDay: 5, revengeSizeFactor: '2.25' }
    const parsed = ok(formFromSettings(settings, behavior))
    expect(parsed.alerts).toEqual(settings)
    expect(parsed.behavior).toEqual({ maxTradesPerDay: 5, revengeWindowMin: 60, revengeSizeFactor: '2.25' })
  })

  it('accepte espaces (même insécables) et virgule pour les décimaux', () => {
    const f = edit(base(), { dailyLossAmount: '1 500,50', dailyLossPercent: ' 2,5 ', revengeSizeFactor: '1,75' })
    const s = ok(setValue(f, 'dailyLossAmount', '1 500,50'))
    expect(s.alerts.dailyLossAmount).toBe('1500.50')
    expect(s.alerts.dailyLossPercent).toBe('2.5')
    expect(s.behavior.revengeSizeFactor).toBe('1.75')
  })

  it('un champ vide désactive l’alerte (et éteint l’interrupteur)', () => {
    const f = setValue(base(), 'consecutiveLosses', '')
    expect(f.enabled.consecutiveLosses).toBe(false)
    expect(ok(f).alerts.consecutiveLosses).toBeNull()
    // Perte du jour : un seul des deux seuils vidé → l'alerte reste allumée avec l'autre.
    const g = setValue(setValue(base(), 'dailyLossAmount', '200'), 'dailyLossPercent', '')
    expect(g.enabled.dailyLoss).toBe(true)
    expect(ok(g).alerts.dailyLossPercent).toBeNull()
    // Les deux vidés → éteinte.
    expect(setValue(g, 'dailyLossAmount', '').enabled.dailyLoss).toBe(false)
  })

  it('un interrupteur éteint enregistre « désactivé » sans contrôler le champ', () => {
    const f = setEnabled(edit(base(), { consecutiveLosses: 'abc' }), 'consecutiveLosses', false)
    expect(ok(f).alerts.consecutiveLosses).toBeNull()
  })

  it('rallumer une alerte au seuil vide y remet une valeur de départ, sinon garde la saisie', () => {
    const off = setValue(base(), 'dailyLossPercent', '')
    const cleared = setValue(off, 'dailyLossAmount', '')
    expect(setEnabled(cleared, 'dailyLoss', true).values.dailyLossPercent).toBe('3')
    const kept = setEnabled(setEnabled(base(), 'weeklyLoss', false), 'weeklyLoss', true)
    expect(kept.values.weeklyLossPercent).toBe('6')
    expect(setEnabled(base(), 'outsideHours', true).values).toMatchObject({ hoursStart: '09:00', hoursEnd: '17:00' })
  })

  it('refuse les entiers hors bornes', () => {
    expect(errs(edit(base(), { consecutiveLosses: '1' }))).toEqual(['consecutiveLosses'])
    expect(errs(edit(base(), { consecutiveLosses: '21' }))).toEqual(['consecutiveLosses'])
    expect(errs(edit(base(), { consecutiveLosses: '2,5' }))).toEqual(['consecutiveLosses'])
    expect(errs(edit(base(), { burstMaxTrades: '0' }))).toEqual(['burstMaxTrades'])
    expect(errs(edit(base(), { burstMaxTrades: '101' }))).toEqual(['burstMaxTrades'])
    expect(errs(edit(base(), { burstWindowMin: '0' }))).toEqual(['burstWindowMin'])
    expect(errs(edit(base(), { burstWindowMin: '1441' }))).toEqual(['burstWindowMin'])
    expect(errs(edit(base(), { burstWindowMin: '' }))).toEqual(['burstWindowMin'])
    expect(ok(edit(base(), { consecutiveLosses: '2' })).alerts.consecutiveLosses).toBe(2)
    expect(ok(edit(base(), { consecutiveLosses: '20' })).alerts.consecutiveLosses).toBe(20)
    expect(ok(edit(base(), { burstWindowMin: '1440' })).alerts.burstWindowMin).toBe(1440)
  })

  it('refuse les pourcentages et montants invalides', () => {
    for (const bad of ['0', '-1', '100,1', '1e2', 'abc', '3%', '1,2,3']) {
      expect(errs(edit(base(), { dailyLossPercent: bad }))).toEqual(['dailyLossPercent'])
    }
    expect(ok(edit(base(), { dailyLossPercent: '100' })).alerts.dailyLossPercent).toBe('100')
    expect(ok(edit(base(), { weeklyLossPercent: '0,5' })).alerts.weeklyLossPercent).toBe('0.5')
    for (const bad of ['0', '-5', '1e5', 'cent']) {
      expect(errs(edit(base(), { weeklyLossAmount: bad }))).toEqual(['weeklyLossAmount'])
    }
  })

  it('valide la plage horaire : deux heures, début différent de la fin, passage de minuit permis', () => {
    const on = setEnabled(base(), 'outsideHours', true)
    expect(ok(edit(on, { hoursStart: '9:00', hoursEnd: '17h30' })).alerts.tradingHours).toBe('09:00-17:30')
    expect(ok(edit(on, { hoursStart: '22:00', hoursEnd: '02:00' })).alerts.tradingHours).toBe('22:00-02:00')
    expect(errs(edit(on, { hoursStart: '09:00', hoursEnd: '09:00' }))).toEqual(['hoursEnd'])
    expect(errs(edit(on, { hoursStart: '25:00', hoursEnd: '10:00' }))).toEqual(['hoursStart'])
    expect(errs(edit(on, { hoursStart: '09:60', hoursEnd: '10:00' }))).toEqual(['hoursStart'])
    expect(errs(edit(on, { hoursStart: '09:00', hoursEnd: '' }))).toEqual(['hoursEnd'])
    expect(errs(edit(on, { hoursStart: 'matin', hoursEnd: 'soir' }))).toEqual(['hoursEnd', 'hoursStart'])
  })

  it('normalizeTime', () => {
    expect(normalizeTime('7:05')).toBe('07:05')
    expect(normalizeTime('07h05')).toBe('07:05')
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('7')).toBeNull()
  })

  it('contrôle la définition de la revanche (commune avec le score) et la limite quotidienne', () => {
    expect(errs(edit(base(), { revengeSizeFactor: '0,9' }))).toEqual(['revengeSizeFactor'])
    expect(errs(edit(base(), { revengeSizeFactor: '' }))).toEqual(['revengeSizeFactor'])
    expect(errs(edit(base(), { revengeWindowMin: '1441' }))).toEqual(['revengeWindowMin'])
    const perDay = setEnabled(base(), 'tradesPerDay', true)
    expect(ok(perDay).behavior.maxTradesPerDay).toBe(3)
    expect(errs(edit(perDay, { maxTradesPerDay: '0' }))).toEqual(['maxTradesPerDay'])
    expect(ok(setEnabled(perDay, 'tradesPerDay', false)).behavior.maxTradesPerDay).toBeNull()
  })

  it('les interrupteurs simples se reportent dans les réglages', () => {
    const f = setEnabled(setEnabled(setEnabled(base(), 'revenge', false), 'unusualSession', false), 'noStopLoss', false)
    expect(ok(f).alerts).toMatchObject({ revenge: false, unusualSession: false, noStopLoss: false })
  })
})
