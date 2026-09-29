import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { dayNumberOf, isFileExistsError, parsePdfError, pdfErrorText, pdfFileName, pdfPeriodRange } from './pdfExport'

const DAY = 86_400_000
// 2026-09-29 12:00 UTC ; Paris l'été = UTC+2.
const NOW = Date.UTC(2026, 8, 29, 12)
const TZ = 120
const localMidnight = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - TZ * 60_000

describe('périodes du bilan PDF (minuit local, fin exclue)', () => {
  it('année précédente, année en cours, mois précédent, mois en cours', () => {
    expect(pdfPeriodRange({ kind: 'lastYear' }, NOW, TZ)).toEqual({ ok: true, from: localMidnight(2025, 1, 1), to: localMidnight(2026, 1, 1) })
    expect(pdfPeriodRange({ kind: 'thisYear' }, NOW, TZ)).toEqual({ ok: true, from: localMidnight(2026, 1, 1), to: localMidnight(2027, 1, 1) })
    expect(pdfPeriodRange({ kind: 'lastMonth' }, NOW, TZ)).toEqual({ ok: true, from: localMidnight(2026, 8, 1), to: localMidnight(2026, 9, 1) })
    expect(pdfPeriodRange({ kind: 'thisMonth' }, NOW, TZ)).toEqual({ ok: true, from: localMidnight(2026, 9, 1), to: localMidnight(2026, 10, 1) })
  })

  it('le mois précédent de janvier est décembre de l’année d’avant', () => {
    const jan = Date.UTC(2026, 0, 15, 12)
    expect(pdfPeriodRange({ kind: 'lastMonth' }, jan, TZ)).toEqual({ ok: true, from: localMidnight(2025, 12, 1), to: localMidnight(2026, 1, 1) })
  })

  it('utilise le jour local, pas le jour UTC (23:30 UTC = déjà demain à Paris)', () => {
    const late = Date.UTC(2026, 8, 30, 23, 30) // 1er octobre 01:30 à Paris
    expect(pdfPeriodRange({ kind: 'thisMonth' }, late, TZ)).toEqual({ ok: true, from: localMidnight(2026, 10, 1), to: localMidnight(2026, 11, 1) })
  })

  it('« toutes les dates » n’a pas de borne', () => {
    expect(pdfPeriodRange({ kind: 'all' }, NOW, TZ)).toEqual({ ok: true, from: null, to: null })
  })

  it('dates au choix : les deux jours sont inclus', () => {
    const r = pdfPeriodRange({ kind: 'custom', fromDay: '2026-02-01', toDay: '2026-02-28' }, NOW, TZ)
    expect(r).toEqual({ ok: true, from: localMidnight(2026, 2, 1), to: localMidnight(2026, 3, 1) })
    const one = pdfPeriodRange({ kind: 'custom', fromDay: '2026-02-10', toDay: '2026-02-10' }, NOW, TZ)
    expect(one.ok && one.to! - one.from!).toBe(DAY)
  })

  it('dates au choix : refuse l’absence, l’invalide et l’inversion', () => {
    expect(pdfPeriodRange({ kind: 'custom', fromDay: '2026-02-01' }, NOW, TZ)).toEqual({ ok: false, error: 'missingDate' })
    expect(pdfPeriodRange({ kind: 'custom', fromDay: '2026-02-30', toDay: '2026-03-01' }, NOW, TZ)).toEqual({ ok: false, error: 'badDate' })
    expect(pdfPeriodRange({ kind: 'custom', fromDay: '01/02/2026', toDay: '2026-03-01' }, NOW, TZ)).toEqual({ ok: false, error: 'badDate' })
    expect(pdfPeriodRange({ kind: 'custom', fromDay: '2026-03-02', toDay: '2026-03-01' }, NOW, TZ)).toEqual({ ok: false, error: 'reversed' })
  })

  it('jour civil : 1970-01-01 = 0, année bissextile', () => {
    expect(dayNumberOf('1970-01-01')).toBe(0)
    expect(dayNumberOf('2024-02-29')).not.toBeNull()
    expect(dayNumberOf('2025-02-29')).toBeNull()
  })
})

describe('erreurs du bilan PDF', () => {
  it('lit les codes pdf:… renvoyés par pulse-core', () => {
    expect(parsePdfError('invalid input: pdf:mixedCurrencies')).toEqual({ code: 'mixedCurrencies' })
    expect(parsePdfError(new Error('invalid input: pdf:fileExists'))).toEqual({ code: 'fileExists' })
    expect(parsePdfError('database error: x')).toBeNull()
    expect(isFileExistsError('invalid input: pdf:fileExists')).toBe(true)
    expect(isFileExistsError('invalid input: pdf:noAccount')).toBe(false)
  })

  it('traduit chaque code et garde le détail des erreurs inconnues', () => {
    const e = fr.pdf.errors
    expect(pdfErrorText(fr, 'invalid input: pdf:noAccount')).toBe(e.noAccount)
    expect(pdfErrorText(fr, 'invalid input: pdf:multipleAccounts')).toBe(e.multipleAccounts)
    expect(pdfErrorText(fr, 'invalid input: pdf:mixedCurrencies')).toBe(e.mixedCurrencies)
    expect(pdfErrorText(fr, 'invalid input: pdf:invalidPeriod')).toBe(e.invalidPeriod)
    expect(pdfErrorText(fr, 'invalid input: pdf:fileExists')).toBe(e.fileExists)
    expect(pdfErrorText(fr, 'io error: disque plein')).toBe(e.unknown('io error: disque plein'))
  })

  it('le nom de fichier proposé ne contient jamais le nom d’un compte', () => {
    expect(pdfFileName('2026-09-29')).toBe('pulse-bilan-2026-09-29.pdf')
  })
})
