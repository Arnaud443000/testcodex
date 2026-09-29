import { describe, expect, it } from 'vitest'
import { formatDecimal, formatPercent, formatPnl } from './format'

describe('formatPnl', () => {
  it('adds an explicit plus sign to gains', () => {
    expect(formatPnl(1234.5)).toBe('+$1,234.50')
  })
  it('uses a real minus sign for losses', () => {
    expect(formatPnl(-80)).toBe('−$80.00')
  })
  it('shows zero without a sign', () => {
    expect(formatPnl(0)).toBe('$0.00')
  })
})

describe('formatPercent', () => {
  it('signs positive and negative values', () => {
    expect(formatPercent(8.44)).toBe('+8.4%')
    expect(formatPercent(-6.2)).toBe('−6.2%')
  })
})

describe('formatDecimal', () => {
  it('groups thousands and pads the fraction without rounding', () => {
    expect(formatDecimal('12345.6', 2)).toBe('12,345.60')
    expect(formatDecimal('10000.0', 2)).toBe('10,000.00')
    expect(formatDecimal('0.00000001', 2)).toBe('0.00000001')
    expect(formatDecimal('1234567')).toBe('1,234,567')
  })
  it('keeps digits a float would lose', () => {
    expect(formatDecimal('90071992547409931.25')).toBe('90,071,992,547,409,931.25')
  })
  it('uses a real minus sign and never shows a negative zero', () => {
    expect(formatDecimal('-1500.5', 2)).toBe('−1,500.50')
    expect(formatDecimal('-0.00')).toBe('0.00')
  })
})
