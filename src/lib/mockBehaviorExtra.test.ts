import { beforeAll, describe, expect, it } from 'vitest'
import { mock, mockBehaviorExtra, mockJournal } from './mockBackend'
import type { JournalEntry } from '../types/journal'
import type { TradeData } from '../types/trade'

/**
 * Journaux F et H de `behavior::more_tests` (résultats calculés à la main côté Rust) :
 * le faux backend doit donner les mêmes chiffres pour les compléments du lot 8 bis.
 */
const DAY = 86_400_000
const MIN = 60_000
const SEP_1 = 20_697 * DAY
let accountF = 0
let accountH = 0
let instrumentId = 0
const idsF: number[] = []
const idsH: number[] = []

async function long(accountId: number, exit: string, size: string, day: number, inMin: number, outMin: number, extra: Partial<TradeData> = {}) {
  const trade: TradeData = {
    accountId, instrumentId, direction: 'long', size, multiplier: '1', entryPrice: '100', exitPrice: exit,
    entryTime: SEP_1 + day * DAY + inMin * MIN, exitTime: SEP_1 + day * DAY + outMin * MIN,
    tzOffsetMin: 0, plannedSl: '90', fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], ruleChecks: [], checklist: [],
    ...extra,
  }
  return (await mock.createTrade(trade)).id
}

const day = (d: number) => new Date(SEP_1 + d * DAY).toISOString().slice(0, 10)
const entry = (d: number, e: Partial<JournalEntry>): JournalEntry => ({ day: day(d), lateHours: false, wentWell: '', toImprove: '', notes: '', ...e })

beforeAll(async () => {
  accountF = (await mock.createAccount({ name: 'F', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  accountH = (await mock.createAccount({ name: 'H', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  instrumentId = (await mock.listInstruments())[0].id
  // Journal F : un long par jour 09:00 → 10:00, sauf 7 (même jour que 6, 10:30 → 11:00, taille 2 : revanche).
  const exitsF = ['90', '95', '80', '130', '90', '90', '85', '100', '90', '95', '110', '120', '110']
  for (const [i, x] of exitsF.entries()) {
    const n = i + 1
    idsF.push(n === 7 ? await long(accountF, x, '2', 5, 630, 660) : await long(accountF, x, '1', n < 7 ? n - 1 : n - 2, 540, 600))
  }
  // Journal H : un trade par jour, plan non / non / oui / non / oui puis oui ×5, rien pour les jours 10 et 11.
  const exitsH = ['90', '90', '110', '90', '95', '120', '110', '90', '110', '115', '100', '105']
  const plans = ['no', 'no', 'yes', 'no', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', null, null] as const
  for (const [d, x] of exitsH.entries()) idsH.push(await long(accountH, x, '1', d, 540, 600, { planFollowed: plans[d] }))
  const sleep = [1, 2, 2, 1, 2, 4, 3, 5, 4, 3]
  for (const [d, s] of sleep.entries()) {
    await mockJournal.saveJournalEntry(entry(d, { sleepQuality: s, fatigue: d === 0 ? 5 : d === 5 ? 1 : null, lateHours: d < 2 }))
  }
  await mockJournal.saveJournalEntry(entry(11, { mood: 3 }))
  await mockJournal.saveJournalEntry(entry(20, { sleepQuality: 1 }))
})

describe('mock des compléments du lot 8 bis : mêmes chiffres que pulse-core', () => {
  it('facteurs externes (journal H)', async () => {
    const r = await mockBehaviorExtra.getExternalFactors({ accountIds: [accountH] })
    expect(r.factors.map((f) => f.key)).toEqual(['poorSleep', 'highFatigue', 'lateHours', 'lowMood'])
    expect([r.tradeCount, r.tradingDayCount, r.journalDayCount]).toEqual([12, 12, 11])
    const s = r.factors[0]
    expect(s.present.tradeIds).toEqual(idsH.slice(0, 5))
    expect([s.present.dayCount, s.absent.dayCount, s.undeclaredDayCount, s.undeclaredTradeCount]).toEqual([5, 5, 2, 2])
    expect([s.present.summary.netPnl, s.absent.summary.netPnl, s.avgNetPnlDifference]).toEqual(['-25', '45', '-14'])
    expect(s.discipline.present).toBeCloseTo(64, 9)
    expect(s.discipline.difference).toBeCloseTo(-36, 9)
    expect(s.expectancyR.difference).toBeCloseTo(-1.4, 9)
    expect([s.discipline.verdict, s.expectancyR.verdict]).toEqual(['lower', 'lower'])
    const f = r.factors[1]
    expect([f.present.dayCount, f.absent.dayCount, f.undeclaredDayCount, f.discipline.verdict, f.avgNetPnlDifference]).toEqual([1, 1, 10, 'notEnoughData', null])
    const l = r.factors[2]
    expect([l.present.dayCount, l.absent.dayCount, l.undeclaredDayCount, l.discipline.difference]).toEqual([2, 9, 1, null])
    expect(l.discipline.absent).toBeCloseTo(840 / 9, 9)
    expect([r.factors[3].present.dayCount, r.factors[3].absent.dayCount, r.factors[3].undeclaredDayCount]).toEqual([0, 1, 11])
  })

  it('après 2 pertes (journal F)', async () => {
    const r = await mockBehaviorExtra.getAfterLosses({ accountIds: [accountF] })
    expect(r.afterTwoLosses.tradeIds).toEqual([3, 4, 7, 8, 11].map((n) => idsF[n - 1]))
    expect(r.others.tradeIds).toHaveLength(8)
    expect([r.sampleTooSmall, r.afterTwoLosses.summary.netPnl, r.others.summary.netPnl, r.avgNetPnlDifference]).toEqual([false, '-10', '-20', '0.5'])
    expect(r.afterTwoLosses.summary.expectancyR).toBeCloseTo(0.1, 9)
    expect(r.expectancyRDifference).toBeCloseTo(0.35, 9)
    expect(r.winRateDifference).toBeCloseTo(0.15, 9)
    expect(r.afterTwoLosses.disciplineScore).toBeCloseTo(90, 9)
    expect(r.disciplineDifference).toBeCloseTo(-10, 9)
    const late = await mockBehaviorExtra.getAfterLosses({ accountIds: [accountF], from: SEP_1 + 6 * DAY })
    expect([late.afterTwoLosses.tradeIds, late.sampleTooSmall, late.expectancyRDifference]).toEqual([[idsF[7], idsF[10]], true, null])
  })

  it('taille après une perte (journal F)', async () => {
    const r = await mockBehaviorExtra.getSizeChange({ accountIds: [accountF] })
    expect([r.tradeCount, r.noPreviousCount]).toEqual([13, 1])
    expect(r.afterLoss.cases.map((c) => [c.tradeId, c.change])).toEqual(
      [[2, 0], [3, 0], [4, 0], [6, 0], [7, 1], [8, -0.5], [10, 0], [11, 0]].map(([n, c]) => [idsF[n - 1], c]),
    )
    expect(r.afterLoss.meanChange).toBeCloseTo(0.0625, 9)
    expect([r.afterLoss.medianChange, r.afterLoss.increasedCount]).toEqual([0, 1])
    expect([r.afterWin.caseCount, r.afterWin.meanChange, r.afterBreakeven.caseCount, r.lossVsWin]).toEqual([3, null, 1, null])
  })

  it('simulation du plan (journal H) et sans plan renseigné (journal F)', async () => {
    const r = await mockBehaviorExtra.getPlanSimulation({ accountIds: [accountH] })
    expect([r.declaredTradeCount, r.actual.netPnl]).toEqual([10, '25'])
    expect([r.withoutOffPlan.excludedTradeIds, r.withoutOffPlan.result.netPnl, r.withoutOffPlan.difference]).toEqual([[idsH[0], idsH[1], idsH[3]], '55', '30'])
    expect(r.withoutOffPlan.result.winRate).toBeCloseTo(6 / 9, 9)
    expect(r.withoutOffPlanOrPartial).toEqual(r.withoutOffPlan)
    const f = await mockBehaviorExtra.getPlanSimulation({ accountIds: [accountF] })
    expect([f.declaredTradeCount, f.withoutOffPlan.difference]).toEqual([0, null])
  })
})
