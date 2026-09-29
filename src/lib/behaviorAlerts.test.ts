import { describe, expect, it } from 'vitest'
import type { PatternReport } from '../types/behavior'
import { buildAlerts } from './behaviorAlerts'
import type { Summary } from '../types/stats'

const NOW = Date.UTC(2026, 8, 29, 10, 0) // 29/09/2026 12:00 à Paris
const TZ = 120
const empty: PatternReport = {
  revengeTrades: [],
  revengeSummary: {} as Summary,
  maxTradesPerDay: 3,
  overtradingDays: [],
  hesitation: [],
  missedTradeCount: 0,
}
const revenge = (exitTime: number) => ({ tradeId: 1, previousTradeId: 0, gapMs: 1, basis: 'risk' as const, ratio: 2, exitTime, netPnl: '-10' })

describe('buildAlerts', () => {
  it('aucune détection → aucune alerte', () => {
    expect(buildAlerts(empty, NOW, TZ)).toEqual([])
  })

  it('surtrading aujourd’hui = critique, avec le nombre de trades du jour', () => {
    const p = { ...empty, overtradingDays: [{ accountId: 1, day: '2026-09-29', tradeCount: 5, limit: 3, tradeIds: [] }] }
    expect(buildAlerts(p, NOW, TZ)).toEqual([{ level: 'critical', key: 'overtrading', count: 5, limit: 3 }])
  })

  it('surtrading un autre jour = avertissement, avec le nombre de jours', () => {
    const p = {
      ...empty,
      overtradingDays: [
        { accountId: 1, day: '2026-09-01', tradeCount: 4, limit: 3, tradeIds: [] },
        { accountId: 1, day: '2026-09-02', tradeCount: 4, limit: 3, tradeIds: [] },
      ],
    }
    expect(buildAlerts(p, NOW, TZ)).toEqual([{ level: 'warning', key: 'overtrading', count: 2, limit: 3 }])
  })

  it('le jour local décide, pas le jour UTC (00:30 à Paris le 30 = 22:30 UTC le 29)', () => {
    const p = { ...empty, revengeTrades: [revenge(Date.UTC(2026, 8, 29, 22, 30))] }
    expect(buildAlerts(p, Date.UTC(2026, 8, 29, 22, 45), TZ)[0].level).toBe('critical')
    expect(buildAlerts(p, Date.UTC(2026, 8, 29, 10, 0), TZ)[0].level).toBe('warning')
  })

  it('les alertes critiques passent avant les avertissements', () => {
    const p = {
      ...empty,
      overtradingDays: [{ accountId: 1, day: '2026-09-01', tradeCount: 4, limit: 3, tradeIds: [] }],
      revengeTrades: [revenge(NOW)],
    }
    expect(buildAlerts(p, NOW, TZ).map((a) => a.key)).toEqual(['revenge', 'overtrading'])
  })
})
