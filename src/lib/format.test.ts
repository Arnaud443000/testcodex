import { describe, expect, it } from 'vitest'
import { formatPercent, formatPnl } from './format'

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
