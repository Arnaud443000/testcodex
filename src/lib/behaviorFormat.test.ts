import { describe, expect, it } from 'vitest'
import { formatDayShort, formatMonthKey, formatLoss, formatPercentValue, formatScore, heatTier, isLossBin, rBinLabel } from './behaviorFormat'

const NBSP = '\u00a0'

describe('formatScore', () => {
  it('arrondit et n’invente jamais 0', () => {
    expect(formatScore(77.6)).toBe('78')
    expect(formatScore(0)).toBe('0')
    expect(formatScore(null)).toBe('—')
    expect(formatScore(undefined)).toBe('—')
  })
})

describe('formatLoss', () => {
  it('affiche un coût positif comme une perte avec un vrai signe moins', () => {
    expect(formatLoss('1620', 'USD')).toBe(`−1${' '}620,00${NBSP}$`)
    expect(formatLoss('12.5', 'USD')).toBe(`−12,50${NBSP}$`)
  })
  it('un coût nul n’a pas de signe', () => {
    expect(formatLoss('0', 'USD')).toBe(`0,00${NBSP}$`)
  })
})

describe('formatPercentValue', () => {
  it('garde le décimal exact', () => {
    expect(formatPercentValue('1.5')).toBe('1,5\u00a0%')
    expect(formatPercentValue(null)).toBe('—')
  })
})

describe('rBinLabel / isLossBin', () => {
  it('nomme les classes ouvertes et fermées', () => {
    expect(rBinLabel({ from: null, to: -3, count: 0 })).toBe('< −3')
    expect(rBinLabel({ from: -0.5, to: 0, count: 0 })).toBe('−0,5')
    expect(rBinLabel({ from: 0, to: 0.5, count: 0 })).toBe('0')
    expect(rBinLabel({ from: 5, to: null, count: 0 })).toBe('≥ 5')
  })
  it('les classes sous zéro sont des pertes, [0 ; 0,5) non', () => {
    expect(isLossBin({ from: null, to: -3, count: 1 })).toBe(true)
    expect(isLossBin({ from: -0.5, to: 0, count: 1 })).toBe(true)
    expect(isLossBin({ from: 0, to: 0.5, count: 1 })).toBe(false)
  })
})

describe('heatTier', () => {
  it('trois paliers par signe, zéro neutre', () => {
    expect(heatTier(0)).toEqual({ tone: 'none', tier: 1 })
    expect(heatTier(0.2)).toEqual({ tone: 'gain', tier: 1 })
    expect(heatTier(-0.5)).toEqual({ tone: 'loss', tier: 2 })
    expect(heatTier(1)).toEqual({ tone: 'gain', tier: 3 })
  })
})

describe('formatDayShort', () => {
  it('met un jour en jj/mm pour les axes', () => {
    expect(formatDayShort('2026-09-29')).toBe('29/09')
    expect(formatDayShort('n’importe quoi')).toBe('n’importe quoi')
  })
})

describe('formatMonthKey', () => {
  it('écrit le mois en français', () => {
    expect(formatMonthKey('2026-09')).toBe('sept. 2026')
    expect(formatMonthKey('2026-01')).toBe('janv. 2026')
    expect(formatMonthKey('bizarre')).toBe('bizarre')
  })
})
