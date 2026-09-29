import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import { defaultSelection, formatFactor, hintText, limitFraction, riskChartPoints, toggleSelection } from './comparisonsView'
import type { TradeRisk } from '../types/stats'

const tr = (id: number, riskPct: number | null, within: boolean | null): TradeRisk => ({
  tradeId: id, entryTime: 0, exitTime: 0, initialRisk: riskPct === null ? null : '1', balanceAtEntry: '100', riskPct, withinLimit: within,
})

describe('comparisonsView', () => {
  it('sélection de comptes', () => {
    expect(defaultSelection([1, 2])).toEqual([1, 2])
    expect(toggleSelection([1, 2], 2)).toEqual([1])
    expect(toggleSelection([1], 3)).toEqual([1, 3])
  })

  it('texte des pistes : nom des comptes, écart, jamais de conclusion', () => {
    const rows = [{ accountId: 1, name: 'Principal' }, { accountId: 2, name: 'Prop' }] as never
    const fees = hintText({ kind: 'fees', accountId: 2, otherAccountId: 1, gap: 0.3, sharedInstruments: 1 }, { rows }, fr)
    expect(fees).toContain('« Prop »')
    expect(fees).toContain('« Principal »')
    expect(fees).toContain('30\u00a0pts')
    expect(fees).toContain('Piste')
    const exec = hintText({ kind: 'execution', accountId: 1, otherAccountId: 2, gap: 0.36, sharedInstruments: 2 }, { rows }, fr)
    expect(exec).toContain('0,36 R')
    expect(exec).toContain('Piste')
  })

  it('points du graphique : positions relatives, dépassements, échelle', () => {
    const r = riskChartPoints([tr(1, 0.005, true), tr(2, 0.015, false), tr(3, null, null), tr(4, 0.01, true)], 0.01)
    expect(r.top).toBeCloseTo(0.015 * 1.15, 12)
    expect(r.points.map((p) => p.tradeId)).toEqual([1, 2, 4])
    expect(r.points[1].over).toBe(true)
    expect(r.points[0].x).toBe(0)
    expect(r.points[2].x).toBe(1)
    expect(r.limitY).toBeCloseTo(0.01 / r.top, 12)
    expect(riskChartPoints([], null).points).toEqual([])
    expect(riskChartPoints([tr(1, 0.01, true)], null).points[0].x).toBe(0.5)
  })

  it('limite en fraction et facteur', () => {
    expect(limitFraction({ limitPercent: '1.5' })).toBe(0.015)
    expect(limitFraction({ limitPercent: null })).toBeNull()
    expect(formatFactor(1.5)).toBe('1,50')
  })
})
