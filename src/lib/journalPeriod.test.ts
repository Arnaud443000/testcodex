import { describe, expect, it } from 'vitest'
import { dayKey, periodWindow, shiftDay } from './journalPeriod'

describe('periodWindow', () => {
  const now = new Date(2026, 8, 29, 15, 30) // 29 septembre 2026, 15 h 30 locale
  it('1J commence à minuit aujourd’hui, 1S six jours avant, Tout n’a pas de borne', () => {
    expect(periodWindow('1D', now).from).toBe(new Date(2026, 8, 29).getTime())
    expect(periodWindow('1W', now).from).toBe(new Date(2026, 8, 23).getTime())
    expect(periodWindow('1M', now).from).toBe(new Date(2026, 7, 31).getTime())
    expect(periodWindow('ALL', now)).toEqual({ from: null, to: null })
    expect(periodWindow('1D', now).to).toBeNull()
  })
})

describe('jours', () => {
  it('décale un jour à travers un changement de mois et d’année', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
