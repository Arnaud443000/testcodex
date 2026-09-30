import { describe, expect, it } from 'vitest'
import { boundaryOffsets, currentPeriodKey, dayString, lastDay, nextPeriod, parsePeriod, periodContaining, previousPeriod, shiftPeriod } from './processPeriods'

/** Mêmes dates que `iso_weeks_and_months_follow_the_calendar` (pulse-core::process_goals). */
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000

describe('calendrier des objectifs de comportement', () => {
  it('semaines ISO, semaine 53 et passage de l’année', () => {
    const w38 = parsePeriod('week', '2026-W38')!
    expect([dayString(w38.firstDay), dayString(lastDay(w38))]).toEqual(['2026-09-14', '2026-09-20'])
    expect(periodContaining('week', day(2026, 9, 20)).key).toBe('2026-W38')
    expect(periodContaining('week', day(2026, 9, 21)).key).toBe('2026-W39')
    const w53 = parsePeriod('week', '2026-W53')!
    expect([dayString(w53.firstDay), dayString(lastDay(w53)), nextPeriod(w53).key]).toEqual(['2026-12-28', '2027-01-03', '2027-W01'])
    const w01 = parsePeriod('week', '2026-W01')!
    expect([dayString(w01.firstDay), previousPeriod(w01).key]).toEqual(['2025-12-29', '2025-W52'])
    expect(periodContaining('week', day(2025, 12, 31)).key).toBe('2026-W01')
    expect(parsePeriod('week', '2025-W53')).toBeNull()
    expect(parsePeriod('week', '2020-W53')).not.toBeNull()
    for (const key of ['2026-W00', '2026-W54', '2026-38', '2026-W3']) expect(parsePeriod('week', key)).toBeNull()
  })

  it('mois, période courante et décalage', () => {
    expect(parsePeriod('month', '2028-02')!.days).toBe(29)
    expect(previousPeriod(parsePeriod('month', '2026-01')!).key).toBe('2025-12')
    expect(parsePeriod('month', '2026-13')).toBeNull()
    // 2026-09-27 23:30 UTC = lundi 28 à 01:30 à UTC+2 : semaine 40 pour ce trader.
    const now = Date.UTC(2026, 8, 27, 23, 30)
    expect(currentPeriodKey('week', now, 0)).toBe('2026-W39')
    expect(currentPeriodKey('week', now, 120)).toBe('2026-W40')
    expect(currentPeriodKey('month', Date.UTC(2026, 8, 30, 23), 120)).toBe('2026-10')
    expect(shiftPeriod('week', '2026-W01', -1)).toBe('2025-W52')
    expect(shiftPeriod('month', '2026-11', 3)).toBe('2027-02')
  })

  it('n’envoie que les décalages aux bornes qui diffèrent du décalage actuel', () => {
    // Heure d'été de Paris simulée : +120 du 29 mars au 24 octobre 2026, +60 sinon.
    const paris = (y: number, m: number, d: number) => {
      const t = Date.UTC(y, m - 1, d)
      return t >= Date.UTC(2026, 2, 29) && t < Date.UTC(2026, 9, 26) ? 120 : 60
    }
    const offsets = boundaryOffsets('week', '2026-W44', 60, paris)
    expect(offsets['2026-10-19']).toBe(120)
    expect(offsets['2026-10-26']).toBeUndefined()
    expect(offsets['2026-11-02']).toBeUndefined()
    // 53 semaines en arrière : jusqu'en 2025, en heure d'hiver (+60) avant le 29 mars 2026.
    expect(offsets['2026-03-23']).toBeUndefined()
    expect(offsets['2026-03-30']).toBe(120)
    // Du lundi 30 mars au lundi 19 octobre : 203 jours = 29 semaines, donc 30 lundis.
    expect(Object.keys(offsets)).toHaveLength(30)
  })
})
