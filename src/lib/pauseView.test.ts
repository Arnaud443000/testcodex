import { describe, expect, it } from 'vitest'
import { alertOffersPause, buildNewPause, endClock, initialLength, isRunning, parseCustomMinutes, pauseReasonForAlert, remainingMinutes } from './pauseView'
import type { Alert } from '../types/alerts'

const MIN = 60_000

describe('durée libre', () => {
  it('accepte 1 à 480, refuse le reste', () => {
    for (const ok of ['1', '15', ' 30 ', '480']) expect(parseCustomMinutes(ok)).toBe(Number(ok))
    for (const bad of ['', '0', '481', '-5', '1,5', '1.5', '1e2', 'abc', '12345', '1 000']) expect(parseCustomMinutes(bad)).toBeNull()
  })
})

describe('choix de départ', () => {
  it('la durée par défaut devient une durée rapide si elle en est une, sinon une durée libre', () => {
    expect(initialLength(30)).toEqual({ choice: '30', customText: '' })
    expect(initialLength(120)).toEqual({ choice: '120', customText: '' })
    expect(initialLength(45)).toEqual({ choice: 'custom', customText: '45' })
  })
})

describe('demande envoyée à pulse-core', () => {
  const base = { reason: null, note: '', tzOffsetMin: 120, customText: '' }
  it('durée rapide, demain matin, durée libre', () => {
    expect(buildNewPause({ ...base, choice: '60' })).toEqual({ ok: true, pause: { length: { kind: 'minutes', minutes: 60 }, reason: null, note: null, tzOffsetMin: 120 } })
    expect(buildNewPause({ ...base, choice: 'tomorrow' })).toEqual({ ok: true, pause: { length: { kind: 'untilTomorrow' }, reason: null, note: null, tzOffsetMin: 120 } })
    expect(buildNewPause({ ...base, choice: 'custom', customText: '90', reason: 'fatigue' })).toEqual({
      ok: true,
      pause: { length: { kind: 'minutes', minutes: 90 }, reason: 'fatigue', note: null, tzOffsetMin: 120 },
    })
    expect(buildNewPause({ ...base, choice: 'custom', customText: '500' })).toEqual({ ok: false, error: 'customInvalid' })
  })
  it('la note est rognée, vide = aucune, limitée à 140 caractères', () => {
    expect(buildNewPause({ ...base, choice: '15', note: '   ' })).toMatchObject({ pause: { note: null } })
    expect(buildNewPause({ ...base, choice: '15', note: '  Je respire  ' })).toMatchObject({ pause: { note: 'Je respire' } })
    const long = buildNewPause({ ...base, choice: '15', note: 'x'.repeat(200) })
    expect(long.ok && long.pause.note?.length).toBe(140)
  })
})

describe('heure de fin et minutes restantes', () => {
  const at = (h: number, m: number, day = 1) => new Date(2026, 8, day, h, m).getTime()
  it('même jour local : « 15:40 » ; jour suivant : « demain »', () => {
    expect(endClock(at(15, 40), at(15, 10))).toEqual({ time: '15:40', tomorrow: false })
    expect(endClock(at(0, 0, 2), at(22, 30))).toEqual({ time: '00:00', tomorrow: true })
  })
  it('arrondies au-dessus, fin exclue', () => {
    const end = 1_000_000
    expect(remainingMinutes(end, end - 30 * MIN)).toBe(30)
    expect(remainingMinutes(end, end - 30 * MIN + 1)).toBe(30)
    expect(remainingMinutes(end, end - 1)).toBe(1)
    expect(remainingMinutes(end, end)).toBe(0)
    expect(remainingMinutes(end, end + MIN)).toBe(0)
    expect(isRunning(end, end - 1)).toBe(true)
    expect(isRunning(end, end)).toBe(false)
  })
})

describe('alertes qui proposent une pause', () => {
  const alert = (a: { kind: string }) => a as unknown as Alert
  it('pertes consécutives, perte du jour et revanche seulement', () => {
    expect(pauseReasonForAlert(alert({ kind: 'consecutiveLosses' }))).toBe('lossStreak')
    expect(pauseReasonForAlert(alert({ kind: 'dailyLoss' }))).toBe('loss')
    expect(pauseReasonForAlert(alert({ kind: 'revenge' }))).toBe('emotion')
    for (const kind of ['weeklyLoss', 'tradesPerDay', 'tradesPerWindow', 'outsideHours', 'unusualSession', 'noStopLoss', 'newsTrade'])
      expect(alertOffersPause(alert({ kind }))).toBe(false)
  })
})
