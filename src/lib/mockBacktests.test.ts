import { describe, expect, it } from 'vitest'
import { createBacktestsMock, scenarios, validateCase } from './mockBacktests'
import type { CaseData } from '../types/backtest'

const DAY = 86_400_000
const base: CaseData = {
  occurredAt: DAY, tzOffsetMin: 0, direction: 'long', observation: 'past', setupValid: 'yes', outcome: 'tp',
  plannedRr: '2', resultR: '2', maxR: null, notes: '',
}
const session = (name: string) => ({
  name, asset: 'EURUSD', timeframe: 'M15', entryConditions: '', exitRules: '', notes: '', status: 'running' as const, setupTagId: null,
})

/** Journal B du test Rust `backtests::tests::journal_b` (calculé à la main) : +2, −1, −1, +2, +1 ; max R 3, 0,5, 2,5, 2, 1,2. */
async function journalB() {
  const m = createBacktestsMock()
  const b = await m.createBacktest(session('Cassure'))
  const rows: [CaseData['outcome'], string, string][] = [['tp', '2', '3'], ['sl', '-1', '0.5'], ['sl', '-1', '2.5'], ['tp', '2', '2'], ['manual', '1', '1.2']]
  for (const [i, [outcome, r, max]] of rows.entries()) await m.addBacktestCase(b.id, { ...base, occurredAt: (i + 1) * DAY, outcome, resultR: r, maxR: max })
  return { m, b }
}

describe('faux backend des backtests', () => {
  it('donne les chiffres du journal B calculés à la main', async () => {
    const { m, b } = await journalB()
    const r = await m.getBacktestReport(b.id)
    const o = r.overall
    expect([o.tradeCount, o.winCount, o.lossCount, o.breakevenCount]).toEqual([5, 3, 2, 0])
    expect(o.winRate).toBe(0.6)
    expect(o.totalR).toBe(3)
    expect(o.expectancyR).toBe(0.6)
    expect(o.avgWinR).toBeCloseTo(5 / 3, 12)
    expect(o.avgLossR).toBe(1)
    expect(o.profitFactor).toBe(2.5)
    expect(o.maxDrawdownR).toBe(2)
    expect(o.lowSample).toBe(true)
    expect(r.curve.map((p) => p.cumulativeR)).toEqual([2, 1, 0, 2, 3])
  })

  it('simule le TP comme pulse-core', async () => {
    const { m, b } = await journalB()
    const s = (await m.getBacktestReport(b.id)).scenarios
    const total = (tp: number) => s.levels.find((l) => l.tpR === tp)!
    expect([0.5, 1, 1.5, 2, 2.5, 3, 4, 5].map((tp) => total(tp).totalR)).toEqual([2.5, 3, 4.5, 6, 7, 4, 3, 3])
    expect(total(1).reachedCount).toBe(4)
    expect(total(1).winRate).toBe(0.8)
    expect(total(2).differenceR).toBe(3)
    expect(s.bestTpR).toBeNull() // 5 cas : pas de « meilleur »
  })

  it('nomme le meilleur TP dès 30 cas, le plus bas en cas d’égalité', () => {
    const one: [number, number | null][] = [[2, 3], [-1, 0.5], [-1, 2.5], [2, 2], [1, 1.2]]
    const thirty = Array.from({ length: 30 }, (_, i) => one[i % 5])
    const s = scenarios(thirty)
    expect(s.bestTpR).toBe(2.5)
    expect(s.levels.find((l) => l.tpR === 2.5)!.totalR).toBe(42)
    expect(scenarios(Array.from({ length: 30 }, () => [0, 0] as [number, number])).bestTpR).toBe(0.5)
  })

  it('laisse de côté les cas sans max R et n’invente pas de zéro', () => {
    const s = scenarios([[2, 2], [-1, null], [1, null]])
    expect([s.sampleCount, s.missingMaxRCount, s.actualTotalR]).toEqual([1, 2, 2])
    const empty = scenarios([])
    expect([empty.actualExpectancyR, empty.bestTpR, empty.levels[0].winRate]).toEqual([null, null, null])
  })

  it('compte la validité, les entrées manquées et les cas douteux', async () => {
    const m = createBacktestsMock()
    const b = await m.createBacktest(session('Mix'))
    await m.addBacktestCase(b.id, { ...base, maxR: '2' })
    await m.addBacktestCase(b.id, { ...base, occurredAt: 2 * DAY, setupValid: 'no', outcome: 'sl', resultR: '-1' })
    await m.addBacktestCase(b.id, { ...base, occurredAt: 3 * DAY, setupValid: 'doubtful', outcome: 'sl', resultR: '-1' })
    await m.addBacktestCase(b.id, { ...base, occurredAt: 4 * DAY, outcome: 'no_entry', resultR: '5', maxR: '5' })
    const r = await m.getBacktestReport(b.id)
    expect(r.validity).toEqual({ yes: 2, no: 1, doubtful: 1, rate: 2 / 3 })
    expect([r.noEntryCount, r.overall.tradeCount, r.overall.totalR]).toEqual([1, 1, 2])
    const withDoubtful = await m.getBacktestReport(b.id, { includeDoubtful: true })
    expect([withDoubtful.overall.tradeCount, withDoubtful.overall.totalR]).toEqual([2, 1])
    const stored = await m.listBacktestCases(b.id)
    expect([stored[3].resultR, stored[3].maxR]).toEqual([null, null])
  })

  it('valide les cas comme pulse-core', () => {
    expect(() => validateCase({ ...base, resultR: '-1' })).toThrow()
    expect(() => validateCase({ ...base, outcome: 'sl', resultR: '1' })).toThrow()
    expect(() => validateCase({ ...base, outcome: 'sl', resultR: '0' })).not.toThrow()
    expect(() => validateCase({ ...base, resultR: null })).toThrow()
    expect(() => validateCase({ ...base, maxR: '1.5' })).toThrow()
    expect(() => validateCase({ ...base, plannedRr: '0' })).toThrow()
    expect(() => validateCase({ ...base, resultR: '5000' })).toThrow()
    expect(() => validateCase({ ...base, tzOffsetMin: 5000 })).toThrow()
  })

  it('gère les sessions : nom unique, mise à jour, suppression en cascade, rapport vide sans zéro inventé', async () => {
    const m = createBacktestsMock()
    const b = await m.createBacktest(session('  Cassure   NY '))
    expect(b.name).toBe('Cassure NY')
    await expect(m.createBacktest(session('cassure ny'))).rejects.toThrow()
    await expect(m.createBacktest(session('   '))).rejects.toThrow()
    expect((await m.updateBacktest(b.id, { ...session('Cassure NY'), status: 'validated' })).status).toBe('validated')
    const empty = await m.getBacktestReport(b.id)
    expect([empty.overall.winRate, empty.overall.expectancyR, empty.overall.profitFactor, empty.validity.rate]).toEqual([null, null, null, null])
    await m.addBacktestCase(b.id, base)
    expect((await m.listBacktests())[0]).toMatchObject({ caseCount: 1, overall: { tradeCount: 1, winRate: 1, profitFactor: null } })
    await m.deleteBacktest(b.id)
    await expect(m.listBacktestCases(b.id)).rejects.toThrow()
  })
})
