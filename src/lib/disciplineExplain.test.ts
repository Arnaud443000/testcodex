import { describe, expect, it } from 'vitest'
import type { TradeDiscipline } from '../types/behavior'
import { componentRows, excludedRows, weakRows } from './disciplineExplain'

const base: TradeDiscipline = {
  tradeId: 7, accountId: 1, entryTime: 0, exitTime: 1, day: '2026-09-29', netPnl: '-50', outcome: 'loss',
  score: 40, coverage: 0.7,
  components: [
    { key: 'plan', weight: 30, value: 0 },
    { key: 'rules', weight: 25, value: null },
    { key: 'checklist', weight: 15, value: 0.5 },
    { key: 'stopLoss', weight: 10, value: 1 },
    { key: 'risk', weight: 10, value: null },
    { key: 'behavior', weight: 10, value: 0 },
  ],
  planFollowed: 'no', rulesChecked: 0, rulesRespected: 0, checklistTotal: 2, checklistChecked: 1, hasStopLoss: true,
  riskPct: null, maxRiskPercent: null, revenge: { previousTradeId: 6, gapMs: 600000, basis: 'risk', ratio: 2 }, overtrading: false, dayRank: 2,
}

describe('lecture du score d’un trade', () => {
  it('classe chaque composante : pleine, en baisse, exclue', () => {
    const rows = componentRows(base)
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ['plan', 'weak'], ['rules', 'excluded'], ['checklist', 'weak'], ['stopLoss', 'full'], ['risk', 'excluded'], ['behavior', 'weak'],
    ])
    expect(rows[1].value).toBeNull() // exclue : jamais 0
  })

  it('les composantes en baisse gardent l’ordre des poids, les exclues sont listées à part', () => {
    const rows = componentRows(base)
    expect(weakRows(rows).map((r) => r.key)).toEqual(['plan', 'checklist', 'behavior'])
    expect(excludedRows(rows).map((r) => r.key)).toEqual(['rules', 'risk'])
  })

  it('reprend les faits de pulse-core pour expliquer chaque composante', () => {
    const rows = componentRows(base)
    expect(rows[0].detail).toEqual({ kind: 'plan', plan: 'no' })
    expect(rows[2].detail).toEqual({ kind: 'checklist', total: 2, checked: 1 })
    expect(rows[4].detail).toEqual({ kind: 'risk', riskPct: null, limit: null, hasStopLoss: true })
    expect(rows[5].detail).toMatchObject({ kind: 'behavior', revenge: { previousTradeId: 6 }, dayRank: 2 })
  })

  it('un trade parfait n’a aucune composante en baisse', () => {
    const perfect = { ...base, components: base.components.map((c) => ({ ...c, value: 1 })) }
    expect(weakRows(componentRows(perfect))).toEqual([])
  })
})
