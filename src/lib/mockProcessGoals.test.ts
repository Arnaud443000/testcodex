import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewProcessGoal, ProcessMetric, ProcessPeriodKind, ProcessProgressQuery } from '../types/processGoals'

/**
 * Mêmes cas que `crates/pulse-core/src/process_goals/tests.rs` (calculés à la main là-bas) : le faux
 * backend doit donner les mêmes valeurs, statuts et séries, sinon les captures d'écran mentiraient.
 * Compte à 10 000 USD, multiplicateur 1, trades longs entrés à 100, taille 1, stop 90 (risque 10 =
 * 0,1 % du solde), clôturés une heure plus tard à 101 (+1). Un faux backend neuf par test.
 */
const H = 3_600_000
const MIN = 60_000
const at = (y: number, m: number, d: number, h: number) => Date.UTC(y, m - 1, d) + h * H
const W38 = '2026-W38'
const during = at(2026, 9, 16, 18)
const after = at(2026, 9, 30, 12)

type Backend = typeof import('./mockBackend')
let be: Backend
let account = 0
let eurusd = 0

beforeEach(async () => {
  vi.resetModules()
  be = await import('./mockBackend')
  account = (await be.mock.createAccount({ name: 'Test', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  eurusd = (await be.mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
})

interface Extra {
  exit?: string
  sl?: string | null
  size?: string
  tz?: number
  plan?: 'yes' | 'partial' | 'no' | null
  rules?: [number, boolean][]
  accountId?: number
}
async function trade(entry: number, x: Extra = {}): Promise<number> {
  const t = await be.mock.createTrade({
    accountId: x.accountId ?? account, instrumentId: eurusd, direction: 'long', size: x.size ?? '1', multiplier: '1', entryPrice: '100',
    exitPrice: x.exit ?? '101', entryTime: entry, exitTime: entry + H, tzOffsetMin: x.tz ?? 0, plannedSl: x.sl === undefined ? '90' : x.sl,
    fees: '0', thesis: '', postMortem: '', tagIds: [], emotions: [], checklist: [], executionType: null, planFollowed: x.plan ?? null,
    ruleChecks: (x.rules ?? []).map(([ruleId, respected]) => ({ ruleId, respected })),
  })
  return t.id
}
const goal = (periodKind: ProcessPeriodKind, periodKey: string, metric: ProcessMetric, target: string) =>
  be.mockProcessGoals.setProcessGoal({ periodKind, periodKey, metric, target })
const week = (key: string, metric: ProcessMetric, target: string) => goal('week', key, metric, target)
const query = (periodKind: ProcessPeriodKind, periodKey: string, nowMs: number, more: Partial<ProcessProgressQuery> = {}): ProcessProgressQuery => ({
  accountIds: [], periodKind, periodKey, nowMs, tzOffsetMin: 0, boundaryOffsets: {}, ...more,
})
const progress = (kind: ProcessPeriodKind, key: string, now: number, more: Partial<ProcessProgressQuery> = {}) =>
  be.mockProcessGoals.getProcessGoalProgress(query(kind, key, now, more))
const one = async (kind: ProcessPeriodKind, key: string, metric: ProcessMetric, now: number) =>
  (await progress(kind, key, now)).goals.find((g) => g.goal.metric === metric)!
const settings = (maxTradesPerDay: number | null, maxRiskPercent: string | null) =>
  be.mock.setBehaviorSettings({ maxTradesPerDay, maxRiskPercent, revengeWindowMin: 60, revengeSizeFactor: '1.5' })
const journal = (day: string) =>
  be.mockJournal.saveJournalEntry({ day, mood: 3, sleepQuality: null, fatigue: null, lateHours: false, wentWell: '', toImprove: '', notes: '' })

describe('objectifs : saisie, validation, copie', () => {
  it('crée, remplace, liste dans l’ordre des métriques et supprime', async () => {
    const g = await week(W38, 'no_stop_trades', '0')
    const again = await week(W38, 'no_stop_trades', '2.0')
    expect([again.id, again.target]).toEqual([g.id, '2'])
    await week(W38, 'journal_days', '5')
    await week(W38, 'rules_respect_rate', '90.5')
    await goal('month', '2026-09', 'no_stop_trades', '3')
    expect((await be.mockProcessGoals.listProcessGoals('week', W38)).map((x) => x.metric)).toEqual(['no_stop_trades', 'rules_respect_rate', 'journal_days'])
    await be.mockProcessGoals.deleteProcessGoal(g.id)
    expect(await be.mockProcessGoals.listProcessGoals('week', W38)).toHaveLength(2)
    await expect(be.mockProcessGoals.deleteProcessGoal(g.id)).rejects.toThrow(/not found/)
    await expect(be.mockProcessGoals.listProcessGoals('week', '2026-W60')).rejects.toThrow(/invalid week/)
  })

  it('refuse les mêmes cibles que pulse-core et n’écrit rien', async () => {
    const refused: NewProcessGoal[] = [
      ['week', W38, 'no_stop_trades', '-1'], ['week', W38, 'no_stop_trades', '1.5'], ['week', W38, 'no_stop_trades', '10001'],
      ['week', W38, 'risk_breaches', '0.5'], ['week', W38, 'rules_respect_rate', '0'], ['week', W38, 'rules_respect_rate', '100.01'],
      ['week', W38, 'plan_follow_rate', '-5'], ['week', W38, 'journal_days', '0'], ['week', W38, 'journal_days', '8'],
      ['week', W38, 'journal_days', '2.5'], ['month', '2026-09', 'journal_days', '32'], ['week', '2026-09', 'no_stop_trades', '0'],
      ['month', '2026-W38', 'no_stop_trades', '0'],
    ].map(([periodKind, periodKey, metric, target]) => ({ periodKind, periodKey, metric, target }) as NewProcessGoal)
    for (const n of refused) await expect(be.mockProcessGoals.setProcessGoal(n), `${n.periodKey} ${n.metric} ${n.target}`).rejects.toThrow(/invalid input/)
    expect(await be.mockProcessGoals.listProcessGoals('week', W38)).toEqual([])
    await expect(week(W38, 'journal_days', '8')).rejects.toThrow('a weekly journal target is a whole number of days from 1 to 7')
    for (const [kind, key, metric, target] of [
      ['week', W38, 'no_stop_trades', '0'], ['week', W38, 'overtrading_days', '10000'], ['week', W38, 'rules_respect_rate', '100'],
      ['week', W38, 'plan_follow_rate', '0.01'], ['week', W38, 'journal_days', '7'], ['month', '2026-09', 'journal_days', '31'],
    ] as const) await goal(kind, key, metric, target)
  })

  it('reprend la période précédente sans écraser', async () => {
    await week('2026-W37', 'no_stop_trades', '0')
    await week('2026-W37', 'rules_respect_rate', '90')
    await week(W38, 'no_stop_trades', '2')
    const copied = await be.mockProcessGoals.copyProcessGoals('week', W38)
    expect(copied.map((g) => [g.metric, g.target])).toEqual([['no_stop_trades', '2'], ['rules_respect_rate', '90']])
    expect(await be.mockProcessGoals.copyProcessGoals('week', W38)).toHaveLength(2)
    expect(await be.mockProcessGoals.copyProcessGoals('week', '2026-W36')).toEqual([])
    await week('2025-W52', 'journal_days', '5')
    expect((await be.mockProcessGoals.copyProcessGoals('week', '2026-W01'))[0].target).toBe('5')
    await goal('month', '2025-12', 'journal_days', '20')
    expect((await be.mockProcessGoals.copyProcessGoals('month', '2026-01')).map((g) => [g.periodKey, g.target])).toEqual([['2026-01', '20']])
  })
})

describe('métriques : même valeur que le rapport source', () => {
  it('trades sans stop : 1 sur 3, pile au plafond, juste au-dessus, semaine vide', async () => {
    await trade(at(2026, 9, 14, 9))
    const naked = await trade(at(2026, 9, 15, 9), { sl: null })
    await trade(at(2026, 9, 16, 9))
    await trade(at(2026, 9, 21, 9))
    await week(W38, 'no_stop_trades', '1')
    const g = await one('week', W38, 'no_stop_trades', during)
    expect([g.value, g.tradeCount, g.tradeIds, g.status, g.direction, g.unit]).toEqual([1, 3, [naked], 'respectedSoFar', 'atMost', 'count'])
    await week(W38, 'no_stop_trades', '0')
    expect((await one('week', W38, 'no_stop_trades', during)).status).toBe('exceeded')
    await week('2026-W37', 'no_stop_trades', '0')
    const empty = await one('week', '2026-W37', 'no_stop_trades', after)
    expect([empty.value, empty.tradeCount, empty.status]).toEqual([null, 0, 'noData'])
  })

  it('jours de surtrading : réglage requis, puis un jour (limite 2)', async () => {
    await trade(at(2026, 9, 15, 9))
    await trade(at(2026, 9, 15, 10))
    const third = await trade(at(2026, 9, 15, 11))
    await trade(at(2026, 9, 17, 9))
    await trade(at(2026, 9, 17, 10))
    await week(W38, 'overtrading_days', '1')
    const g = await one('week', W38, 'overtrading_days', during)
    expect([g.value, g.status, g.requiredSetting, g.streak]).toEqual([null, 'settingRequired', 'maxTradesPerDay', 0])
    await settings(2, null)
    const h = await one('week', W38, 'overtrading_days', during)
    expect([h.value, h.days, h.tradeIds, h.status]).toEqual([1, ['2026-09-15'], [third], 'respectedSoFar'])
    expect((await one('week', W38, 'overtrading_days', after)).status).toBe('respected')
    await week(W38, 'overtrading_days', '0')
    expect((await one('week', W38, 'overtrading_days', during)).status).toBe('exceeded')
  })

  it('trades de revanche : une perte puis un risque double 30 min après', async () => {
    await trade(at(2026, 9, 15, 9), { exit: '95' })
    const revenge = await trade(at(2026, 9, 15, 10) + 30 * MIN, { size: '2' })
    await trade(at(2026, 9, 16, 9))
    await week(W38, 'revenge_trades', '1')
    const g = await one('week', W38, 'revenge_trades', during)
    expect([g.value, g.tradeIds, g.tradeCount, g.status]).toEqual([1, [revenge], 3, 'respectedSoFar'])
    await week(W38, 'revenge_trades', '0')
    expect((await one('week', W38, 'revenge_trades', after)).status).toBe('exceeded')
  })

  it('dépassements du risque : limite 0,1 %, pile à la limite respecté, sans stop jamais un succès', async () => {
    await trade(at(2026, 9, 14, 9))
    const over = await trade(at(2026, 9, 15, 9), { sl: '80' })
    await trade(at(2026, 9, 16, 9), { sl: null })
    await week(W38, 'risk_breaches', '1')
    expect((await one('week', W38, 'risk_breaches', during)).status).toBe('settingRequired')
    await settings(null, '0.1')
    const g = await one('week', W38, 'risk_breaches', during)
    expect([g.value, g.tradeIds, g.status]).toEqual([1, [over], 'respectedSoFar'])
    expect((await progress('week', W38, during)).maxRiskPercent).toBe('0.1')
    await trade(at(2026, 9, 8, 9), { sl: null })
    await week('2026-W37', 'risk_breaches', '0')
    const w37 = await one('week', '2026-W37', 'risk_breaches', after)
    expect([w37.value, w37.tradeCount, w37.status]).toEqual([null, 1, 'noData'])
  })

  it('règles respectées : 9 / 10 = 90 % pile atteint, 90,01 % en cours puis manqué', async () => {
    const ra = (await be.mock.createRule('Attendre la clôture')).id
    const rb = (await be.mock.createRule('Pas de trade avant 9 h')).id
    for (let n = 0; n < 5; n++) await trade(at(2026, 9, 14 + n, 9), { rules: [[ra, true], [rb, n !== 2]] })
    await trade(at(2026, 9, 18, 15))
    await week(W38, 'rules_respect_rate', '90')
    const g = await one('week', W38, 'rules_respect_rate', during)
    expect([g.numerator, g.denominator, g.status, g.unit]).toEqual([9, 10, 'reached', 'percent'])
    expect(g.value).toBeCloseTo(90, 9)
    await week(W38, 'rules_respect_rate', '90.01')
    expect((await one('week', W38, 'rules_respect_rate', during)).status).toBe('inProgress')
    expect((await one('week', W38, 'rules_respect_rate', after)).status).toBe('missed')
    await trade(at(2026, 9, 8, 9))
    await week('2026-W37', 'rules_respect_rate', '50')
    const w37 = await one('week', '2026-W37', 'rules_respect_rate', after)
    expect([w37.value, w37.numerator, w37.tradeCount, w37.status]).toEqual([null, null, 1, 'noData'])
  })

  it('plan suivi : 4 plans déclarés = pas de données, 4 sur 5 = 80 % pile', async () => {
    const plans = ['yes', 'yes', 'yes', 'partial', null] as const
    for (const [n, plan] of plans.entries()) await trade(at(2026, 9, 14 + n, 9), { plan })
    await week(W38, 'plan_follow_rate', '80')
    const g = await one('week', W38, 'plan_follow_rate', during)
    expect([g.value, g.tradeCount, g.status]).toEqual([null, 5, 'noData'])
    await trade(at(2026, 9, 19, 9), { plan: 'yes' })
    const h = await one('week', W38, 'plan_follow_rate', during)
    expect([h.numerator, h.denominator, h.status]).toEqual([4, 5, 'reached'])
    await week(W38, 'plan_follow_rate', '80.5')
    expect((await one('week', W38, 'plan_follow_rate', after)).status).toBe('missed')
  })

  it('jours de journal : les jours locaux de la période qui ont une entrée', async () => {
    for (const d of ['2026-09-13', '2026-09-14', '2026-09-16', '2026-09-20', '2026-09-21']) await journal(d)
    await be.mockJournal.saveJournalEntry({ day: '2026-09-17', mood: null, sleepQuality: null, fatigue: null, lateHours: false, wentWell: '  ', toImprove: '', notes: '' })
    await week(W38, 'journal_days', '3')
    const g = await one('week', W38, 'journal_days', during)
    expect([g.value, g.tradeCount, g.status, g.days]).toEqual([3, 0, 'reached', ['2026-09-14', '2026-09-16', '2026-09-20']])
    await week(W38, 'journal_days', '4')
    expect((await one('week', W38, 'journal_days', after)).status).toBe('missed')
    await week('2026-W36', 'journal_days', '1')
    const w36 = await one('week', '2026-W36', 'journal_days', after)
    expect([w36.value, w36.status]).toEqual([0, 'missed'])
    await goal('month', '2026-09', 'journal_days', '5')
    expect((await one('month', '2026-09', 'journal_days', during)).status).toBe('reached')
  })
})

describe('périodes, statuts, séries', () => {
  it('le statut dépend de la fin de la période', async () => {
    await trade(at(2026, 9, 14, 9))
    await journal('2026-09-14')
    await week(W38, 'no_stop_trades', '0')
    await week(W38, 'journal_days', '2')
    const st = async (now: number) => {
      const p = await progress('week', W38, now)
      return [p.period.state, p.goals.map((g) => g.status)]
    }
    expect(await st(at(2026, 9, 20, 23))).toEqual(['current', ['respectedSoFar', 'inProgress']])
    expect(await st(at(2026, 9, 21, 0))).toEqual(['past', ['respected', 'missed']])
    expect((await st(at(2026, 9, 1, 0)))[0]).toBe('future')
    const p = (await progress('week', W38, during)).period
    expect([p.firstDay, p.lastDay, p.previousKey, p.nextKey, p.from, p.to]).toEqual(['2026-09-14', '2026-09-20', '2026-W37', '2026-W39', at(2026, 9, 14, 0), at(2026, 9, 21, 0)])
  })

  it('semaine à cheval sur le changement d’heure : décalage de chaque borne', async () => {
    const closedAt = (utc: number, tz: number) => trade(utc - H, { sl: null, tz })
    const a = await closedAt(at(2026, 10, 18, 22) + 30 * MIN, 120)
    const b = await closedAt(at(2026, 10, 25, 22) + 30 * MIN, 60)
    const c = await closedAt(at(2026, 10, 25, 23) + 30 * MIN, 60)
    await week('2026-W43', 'no_stop_trades', '5')
    await week('2026-W44', 'no_stop_trades', '5')
    const offsets = { '2026-10-19': 120, '2026-10-26': 60 }
    const now = at(2026, 11, 5, 12)
    const w43 = await progress('week', '2026-W43', now, { tzOffsetMin: 60, boundaryOffsets: offsets })
    expect([w43.period.from, w43.period.to, w43.goals[0].tradeIds]).toEqual([at(2026, 10, 18, 22), at(2026, 10, 25, 23), [a, b]])
    expect((await progress('week', '2026-W44', now, { tzOffsetMin: 60, boundaryOffsets: offsets })).goals[0].tradeIds).toEqual([c])
    expect((await progress('week', '2026-W43', now, { tzOffsetMin: 60 })).goals[0].tradeIds).toEqual([b])
    await expect(progress('week', '2026-W43', now, { boundaryOffsets: { '2026-10-19': 2000 } })).rejects.toThrow(/invalid UTC offset/)
  })

  it('semaine ISO au passage de l’année', async () => {
    const dec31 = await trade(at(2025, 12, 31, 9), { sl: null })
    const jan2 = await trade(at(2026, 1, 2, 9), { sl: null })
    const dec28 = await trade(at(2025, 12, 28, 9), { sl: null })
    await week('2026-W01', 'no_stop_trades', '1')
    await week('2025-W52', 'no_stop_trades', '1')
    const w01 = await one('week', '2026-W01', 'no_stop_trades', at(2026, 1, 10, 0))
    expect([w01.tradeIds, w01.status]).toEqual([[dec31, jan2], 'exceeded'])
    const w52 = await progress('week', '2025-W52', at(2026, 1, 10, 0))
    expect([w52.goals[0].tradeIds, w52.goals[0].status, w52.period.firstDay, w52.period.nextKey]).toEqual([[dec28], 'respected', '2025-12-22', '2026-W01'])
  })

  it('refuse des comptes de devises différentes, comme ailleurs', async () => {
    const eur = (await be.mock.createAccount({ name: 'Euro', kind: 'personal', broker: '', currency: 'EUR', initialCapital: '5000' })).id
    await week(W38, 'journal_days', '1')
    await expect(progress('week', W38, during)).rejects.toThrow(/different currencies/)
    await expect(progress('week', W38, during, { accountIds: [account, eur] })).rejects.toThrow(/different currencies/)
    expect((await progress('week', W38, during, { accountIds: [eur] })).currency).toBe('EUR')
  })

  it('série : 4 semaines de suite, interrompue par un échec, une semaine sans objectif, « pas de données »', async () => {
    await trade(at(2026, 8, 18, 9), { sl: null })
    for (const [m, d] of [[8, 25], [9, 1], [9, 8], [9, 15]]) await trade(at(2026, m, d, 9))
    for (let w = 34; w <= 39; w++) await week(`2026-W${w}`, 'no_stop_trades', '0')
    const streak = async (key: string, now = at(2026, 9, 23, 12)) => (await one('week', key, 'no_stop_trades', now)).streak
    expect(await streak('2026-W39')).toBe(4)
    expect(await streak('2026-W38')).toBe(3)
    expect(await streak('2026-W39', at(2026, 9, 17, 12))).toBe(0)
    const naked = await trade(at(2026, 9, 9, 9), { sl: null })
    expect(await streak('2026-W39')).toBe(1)
    await be.mock.deleteTrade(naked)
    expect(await streak('2026-W39')).toBe(4)
    const w37 = (await be.mockProcessGoals.listProcessGoals('week', '2026-W37'))[0]
    await be.mockProcessGoals.deleteProcessGoal(w37.id)
    expect(await streak('2026-W39')).toBe(1)
    await week('2026-W37', 'no_stop_trades', '0')
    const w37trade = (await be.mock.listTrades({})).find((t) => t.entryTime === at(2026, 9, 8, 9))!
    await be.mock.deleteTrade(w37trade.id)
    expect(await streak('2026-W39')).toBe(1)
  })

  it('une série est plafonnée à 52 périodes', async () => {
    const { parsePeriod, previousPeriod, dayString } = await import('./processPeriods')
    let p = parsePeriod('week', W38)!
    for (let i = 0; i < 60; i++) {
      p = previousPeriod(p)
      await journal(dayString(p.firstDay))
      await week(p.key, 'journal_days', '1')
    }
    await week(W38, 'journal_days', '1')
    expect((await one('week', W38, 'journal_days', during)).streak).toBe(52)
  })
})
