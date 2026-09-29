import { describe, expect, it } from 'vitest'
import { formatDecimal, formatDuration, formatMoney, formatPercent, formatPnl, formatR, formatSignedMoney, formatPoints, formatRatioPercent, formatSignedAmount, formatSignedNumber, formatSignedRatioPercent } from './format'

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

describe('formatMoney : arrondi au centime à l\'affichage (lot 26)', () => {
  it('arrondit sur la chaîne, moitié éloignée de zéro, sans flottant', () => {
    expect(norm(formatMoney('213.45300', 'USD'))).toBe('213,45 $')
    expect(norm(formatMoney('11.9345', 'USD'))).toBe('11,93 $')
    expect(norm(formatMoney('11.935', 'USD'))).toBe('11,94 $')
    expect(norm(formatMoney('-17.805', 'USD'))).toBe('−17,81 $')
    expect(norm(formatSignedMoney('62213.453', 'USD'))).toBe('+62 213,45 $')
    expect(norm(formatMoney('60000', 'USD'))).toBe('60 000,00 $')
  })
  it('un montant non nul plus petit que le centime garde sa précision (jamais « 0,00 »)', () => {
    expect(norm(formatMoney('0.0042', 'USD'))).toBe('0,0042 $')
    expect(norm(formatMoney('-0.004', 'USD'))).toBe('−0,004 $')
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

describe('formats du tableau de bord', () => {
  it('affiche une fraction en pourcentage, ou un tiret quand elle est indéfinie', () => {
    expect(norm(formatRatioPercent(0.584))).toBe('58,4 %')
    expect(norm(formatRatioPercent(2 / 3, 0))).toBe('67 %')
    expect(formatRatioPercent(null)).toBe('—')
  })
  it('signe les écarts avec un vrai signe moins', () => {
    expect(norm(formatPoints(0.032))).toBe('+3,2 pts')
    expect(norm(formatPoints(-0.005))).toBe('−0,5 pt')
    expect(norm(formatPoints(0))).toBe('0,0 pt')
    expect(formatSignedNumber(0.12)).toBe('+0,12')
    expect(formatSignedNumber(-0.1)).toBe('−0,10')
    expect(formatSignedNumber(0.001)).toBe('0,00')
    expect(norm(formatSignedRatioPercent(0.084))).toBe('+8,4 %')
  })
  it('écrit les montants des cases du calendrier sans devise ni arrondi', () => {
    expect(norm(formatSignedAmount('1038.5'))).toBe('+1 038,5')
    expect(formatSignedAmount('-602')).toBe('−602')
    expect(formatSignedAmount('0')).toBe('0')
    expect(formatSignedAmount('-0.00')).toBe('0')
  })
})
