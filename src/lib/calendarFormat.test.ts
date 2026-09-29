import { describe, expect, it } from 'vitest'
import { formatDayLong, formatMonthTitle, heatTier, shiftMonth } from './calendarFormat'

describe('calendrier : formats', () => {
  it('écrit les dates en français', () => {
    expect(formatMonthTitle(2026, 9)).toBe('septembre 2026')
    expect(formatDayLong('2026-09-28')).toBe('lundi 28 septembre 2026')
  })
  it('change de mois en passant les années', () => {
    expect(shiftMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 })
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })
  it('range l’intensité en trois paliers', () => {
    expect([0.02, 0.33, 0.34, 0.66, 0.67, 1, -0.5, -1].map(heatTier)).toEqual([1, 1, 2, 2, 3, 3, 2, 3])
  })
})
