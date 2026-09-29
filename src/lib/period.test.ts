import { describe, expect, it } from 'vitest'
import { periodRange } from './period'

const DAY = 86_400_000
// 29 septembre 2026, 23:30 à Paris (UTC+2) = 21:30 UTC.
const NOW = Date.UTC(2026, 8, 29, 21, 30)

describe('periodRange', () => {
  it('« Tout » n’a pas de borne', () => {
    expect(periodRange('ALL', NOW, 120)).toEqual({ from: null, to: null })
  })

  it('1J = aujourd’hui local, de minuit à minuit', () => {
    const { from, to } = periodRange('1D', NOW, 120)
    expect(from).toBe(Date.UTC(2026, 8, 28, 22, 0)) // 00:00 le 29 à Paris
    expect(to).toBe(Date.UTC(2026, 8, 29, 22, 0)) // 00:00 le 30 à Paris
  })

  it('tient compte du jour local, pas du jour UTC (23:30 à Paris → toujours le 29)', () => {
    expect(periodRange('1D', Date.UTC(2026, 8, 29, 22, 30), 120).from).toBe(Date.UTC(2026, 8, 29, 22, 0))
  })

  it('1S = 7 jours locaux, 3M = 90', () => {
    const w = periodRange('1W', NOW, 120)
    expect(w.to! - w.from!).toBe(7 * DAY)
    const q = periodRange('3M', NOW, 120)
    expect(q.to! - q.from!).toBe(90 * DAY)
    expect(q.to).toBe(w.to)
  })

  it('décalage négatif (New York, UTC−4)', () => {
    const { from, to } = periodRange('1D', Date.UTC(2026, 8, 30, 1, 0), -240) // 21:00 le 29 à New York
    expect(from).toBe(Date.UTC(2026, 8, 29, 4, 0))
    expect(to).toBe(Date.UTC(2026, 8, 30, 4, 0))
  })
})
