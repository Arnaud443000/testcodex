import { describe, expect, it } from 'vitest'
import { currentMonth, formatActual, formatTarget, shiftMonth } from './goalFormat'
import type { GoalProgress } from '../types/goals'

const progress = (over: Partial<GoalProgress> & { metric: GoalProgress['goal']['metric'] }): GoalProgress => ({
  goal: { id: 1, month: '2026-09', metric: over.metric, target: '10' },
  direction: 'at_least',
  tradeCount: 4,
  currency: 'USD',
  actualMoney: null,
  actualRatio: null,
  fraction: null,
  status: 'in_progress',
  ...over,
})

describe('mois', () => {
  it('décale à travers les années', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-09', 0)).toBe('2026-09')
    expect(currentMonth(new Date(2026, 8, 29))).toBe('2026-09')
  })
})

describe('affichage des cibles et des valeurs', () => {
  it('formate chaque métrique à la française', () => {
    expect(formatTarget('win_rate', '55', 'USD')).toBe('55\u00a0%')
    expect(formatTarget('win_rate', '55.5', 'USD')).toBe('55,5\u00a0%')
    expect(formatTarget('execution_quality', '4', 'USD')).toBe('4,0 / 5')
    expect(formatTarget('profit_factor', '1.5', 'USD')).toBe('1,50')
    expect(formatTarget('net_pnl', '500', 'USD')).toContain('500')
  })
  it('signe le P&L, écrit ∞ pour un profit factor sans perte, — sans mesure', () => {
    expect(formatActual(progress({ metric: 'net_pnl', actualMoney: '25' }), 'USD')).toMatch(/^\+25/)
    expect(formatActual(progress({ metric: 'net_pnl', actualMoney: '-25' }), 'USD')).toMatch(/^−25/)
    expect(formatActual(progress({ metric: 'max_drawdown', actualMoney: '10' }), 'USD')).not.toMatch(/^[+−]/)
    expect(formatActual(progress({ metric: 'win_rate', actualRatio: 75 }), 'USD')).toBe('75,0\u00a0%')
    expect(formatActual(progress({ metric: 'profit_factor', fraction: 1, status: 'reached' }), 'USD')).toBe('∞')
    expect(formatActual(progress({ metric: 'net_pnl', status: 'no_data' }), 'USD')).toBe('—')
    expect(formatActual(progress({ metric: 'expectancy_r', actualRatio: 0.625 }), 'USD')).toBe('+0,63\u00a0R')
  })
})
