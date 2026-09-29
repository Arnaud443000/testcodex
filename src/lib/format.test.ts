import { describe, expect, it } from 'vitest'
import { formatAmount, formatPercent, formatPnl } from './format'

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

describe('formatAmount', () => {
  it('formate un capital sans signe', () => {
    expect(norm(formatAmount(10000))).toBe('10 000,00 $')
  })
})

describe('formatPercent', () => {
  it('signe les valeurs positives et négatives, avec virgule décimale', () => {
    expect(norm(formatPercent(8.44))).toBe('+8,4 %')
    expect(norm(formatPercent(-6.2))).toBe('−6,2 %')
  })
})
