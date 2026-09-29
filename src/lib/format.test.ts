import { describe, expect, it } from 'vitest'
import { formatDecimal, formatPercent, formatPnl } from './format'

// Intl met une espace insécable fine (U+202F) entre les milliers et une insécable (U+00A0) avant $ et %.
const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatPnl', () => {
  it('ajoute un signe plus explicite aux gains', () => {
    expect(norm(formatPnl(1234.5))).toBe('+1 234,50 $')
  })
  it('utilise un vrai signe moins pour les pertes', () => {
    expect(norm(formatPnl(-80))).toBe('−80,00 $')
  })
  it('affiche zéro sans signe', () => {
    expect(norm(formatPnl(0))).toBe('0,00 $')
  })
})

describe('formatPercent', () => {
  it('signe les valeurs positives et négatives, avec virgule décimale', () => {
    expect(norm(formatPercent(8.44))).toBe('+8,4 %')
    expect(norm(formatPercent(-6.2))).toBe('−6,2 %')
  })
})

describe('formatDecimal', () => {
  it('groupe les milliers et complète la fraction sans arrondir', () => {
    expect(norm(formatDecimal('12345.6', 2))).toBe('12 345,60')
    expect(norm(formatDecimal('10000.0', 2))).toBe('10 000,00')
    expect(formatDecimal('0.00000001', 2)).toBe('0,00000001')
    expect(norm(formatDecimal('1234567'))).toBe('1 234 567')
  })
  it('garde les chiffres qu’un flottant perdrait', () => {
    expect(norm(formatDecimal('90071992547409931.25'))).toBe('90 071 992 547 409 931,25')
  })
  it('utilise un vrai signe moins et n’affiche jamais un zéro négatif', () => {
    expect(norm(formatDecimal('-1500.5', 2))).toBe('−1 500,50')
    expect(formatDecimal('-0.00')).toBe('0,00')
  })
})
