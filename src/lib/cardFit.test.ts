import { describe, expect, it } from 'vitest'
import { MAX_DENSITY, nextDensity, rowsThatFit, visibleRows } from './cardFit'

describe('cardFit', () => {
  it('resserre d’un cran tant que ça déborde, jusqu’au maximum', () => {
    expect(nextDensity(0, true)).toBe(1)
    expect(nextDensity(1, true)).toBe(2)
    expect(nextDensity(MAX_DENSITY, true)).toBe(MAX_DENSITY)
    expect(nextDensity(1, false)).toBe(1)
  })
  it('compte les lignes qui tiennent entièrement', () => {
    expect(rowsThatFit([40, 80, 120, 160], 130)).toBe(3)
    expect(rowsThatFit([40, 80], 500)).toBe(2)
    expect(rowsThatFit([], 100)).toBe(0)
    expect(rowsThatFit([60, 120], 10)).toBe(1) // une ligne au moins
    expect(rowsThatFit([40, 80, 120], 80)).toBe(2) // bas exactement à la limite : tient
  })
  it('garde toute la liste si elle tient, sinon laisse la place du lien « Voir les N autres »', () => {
    expect(visibleRows([50, 100, 150], 150)).toBe(3)
    expect(visibleRows([50, 100, 150], 149)).toBe(2) // 149 − 28 = 121 → 2 lignes
    expect(visibleRows([50, 100, 150, 200], 160)).toBe(2) // 160 − 28 = 132 → 2 lignes
    expect(visibleRows([], 100)).toBe(0)
    expect(visibleRows([90], 50)).toBe(1)
  })
})
