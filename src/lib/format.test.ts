import { describe, expect, it } from 'vitest'
import { formatDecimal, formatDuration, formatMoney, formatPercent, formatPnl, formatR, formatSignedMoney } from './format'

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

describe('formatSignedMoney', () => {
  it('signe un montant exact et retire les zéros de fin de pulse-core', () => {
    expect(norm(formatSignedMoney('341.600000', 'USD'))).toBe('+341,60 $')
    expect(norm(formatSignedMoney('-80', 'USD'))).toBe('−80,00 $')
    expect(norm(formatSignedMoney('1234.5', 'EUR'))).toBe('+1 234,50 €')
  })
  it('n’affiche ni signe ni « −0 » pour zéro', () => {
    expect(norm(formatSignedMoney('0.000', 'USD'))).toBe('0,00 $')
    expect(norm(formatSignedMoney('-0.00', 'USD'))).toBe('0,00 $')
  })
  it('garde les décimales significatives sans arrondir', () => {
    expect(norm(formatMoney('0.00420000', 'USD'))).toBe('0,0042 $')
  })
})

describe('formatR', () => {
  it('signe le multiple de risque', () => {
    expect(norm(formatR(2.1))).toBe('+2,1 R')
    expect(norm(formatR(-1.6))).toBe('−1,6 R')
    expect(norm(formatR(0))).toBe('0,0 R')
  })
  it('n’affiche jamais « −0,0 R » et gère l’absence de stop', () => {
    expect(norm(formatR(-0.001))).toBe('0,0 R')
    expect(formatR(null)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('formate en jours, heures et minutes', () => {
    expect(formatDuration(72 * 60_000)).toBe('1 h 12 min')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(3 * 3_600_000)).toBe('3 h')
    expect(formatDuration((26 * 60 + 5) * 60_000)).toBe('1 j 2 h')
    expect(formatDuration(20_000)).toBe('< 1 min')
    expect(formatDuration(null)).toBe('—')
  })
})
