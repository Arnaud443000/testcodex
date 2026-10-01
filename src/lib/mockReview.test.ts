import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntentionOutcome, ReviewInput, ReviewQuery } from '../types/review'
import { boundaryOffsets, shiftPeriod } from './processPeriods'

/**
 * Mêmes cas que `crates/pulse-core/src/weekly_review/tests.rs` (calculés à la main là-bas) : le faux
 * backend doit dire la même chose que pulse-core, sinon les captures d'écran mentiraient. Compte à
 * 10 000 USD, multiplicateur 1, trades longs entrés à 100, taille 1, stop 90 (risque 10, soit +0,1 R),
 * clôturés une heure plus tard à 101 (+1). Un faux backend neuf par test ; l'horloge (`Date`) est figée.
 */
const H = 3_600_000
const DAY = 86_400_000
const at = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min)
const W38 = '2026-W38'
const past = at(2026, 9, 30, 12)
const during = at(2026, 9, 16, 12)
const sunday = at(2026, 9, 20, 19)

type Backend = typeof import('./mockBackend')
let be: Backend
let account = 0
let eurusd = 0

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(sunday)
  vi.resetModules()
  be = await import('./mockBackend')
  account = (await be.mock.createAccount({ name: 'Test', kind: 'personal', broker: '', currency: 'USD', initialCapital: '10000' })).id
  eurusd = (await be.mock.listInstruments()).find((i) => i.symbol === 'EURUSD')!.id
})
afterEach(() => vi.useRealTimers())

async function trade(entry: number, x: { exit?: string; sl?: string | null; tagIds?: number[] } = {}): Promise<number> {
  const t = await be.mock.createTrade({
    accountId: account, instrumentId: eurusd, direction: 'long', size: '1', multiplier: '1', entryPrice: '100',
    exitPrice: x.exit ?? '101', entryTime: entry, exitTime: entry + H, tzOffsetMin: 0, plannedSl: x.sl === undefined ? '90' : x.sl,
    fees: '0', thesis: '', postMortem: '', tagIds: x.tagIds ?? [], emotions: [], checklist: [], executionType: null, planFollowed: null, ruleChecks: [],
  })
  return t.id
}
const closingAt = (exit: number) => trade(exit - H)
const losing = (entry: number, loss: number, tag: number | null) => trade(entry, { exit: String(100 - loss), tagIds: tag === null ? [] : [tag] })
const query = (key: string, now: number, more: Partial<ReviewQuery> = {}): ReviewQuery => ({ accountIds: [], periodKey: key, nowMs: now, tzOffsetMin: 0, boundaryOffsets: {}, ...more })
const view = (key: string, now: number, more: Partial<ReviewQuery> = {}) => be.mockReview.getWeeklyReview(query(key, now, more))
const facts = async (key: string, now: number) => (await view(key, now)).facts
const input = (key: string, intentions: string[] = [], answers: Partial<ReviewInput['answers']> = {}): ReviewInput => ({
  periodKey: key, answers: { wentWell: '', doDifferently: '', nextPriority: '', ...answers }, intentions,
})
const journal = (day: string) =>
  be.mockJournal.saveJournalEntry({ day, mood: 3, sleepQuality: null, fatigue: null, lateHours: false, wentWell: '', toImprove: '', notes: '' })
/** Un bilan de `key` dont les intentions ont ces suivis (enregistré bien après : jamais « futur »). */
async function seed(key: string, outcomes: (IntentionOutcome | null)[]) {
  vi.setSystemTime(at(2027, 6, 1, 12))
  const saved = await be.mockReview.saveWeeklyReview(input(key, outcomes.map((_, n) => `Intention ${n + 1} de ${key}`)), 0)
  for (const [i, o] of saved.intentions.map((x, n) => [x, outcomes[n]] as const)) await be.mockReview.setIntentionOutcome(i.id, o)
  vi.setSystemTime(sunday)
}
const approx = (a: number | null, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(1e-9)

describe('faits : aucune valeur inventée, une raison quand elle manque', () => {
  it('une semaine sans trade : « — » avec la raison, mais 0 est un vrai nombre', async () => {
    const f = await facts(W38, past)
    expect(f.closedTradeCount).toBe(0)
    expect([f.netPnl, f.winRate, f.expectancyR, f.discipline].map((x) => [x.value, x.reason])).toEqual(Array(4).fill([null, 'noClosedTrade']))
    expect([f.goals.value, f.goals.reason]).toEqual([null, 'noGoals'])
    expect([f.costlyMistake.value, f.costlyMistake.reason]).toEqual([null, 'noMistake'])
    expect([f.pauseCount, f.tradesDuringPause, f.ideasClosed, f.journalDays]).toEqual([0, 0, 0, 0])
    expect(f.ideasToReview).toEqual({ value: null, reason: 'onlyCurrentWeek' })
    expect((await facts(W38, during)).ideasToReview).toEqual({ value: 0, reason: null })
    expect((await view('2026-W45', past)).period.state).toBe('future')
  })

  it('4 trades : un résultat mais pas de score de discipline ; 5 trades : la moyenne (90)', async () => {
    for (const h of [9, 11, 13, 15]) await trade(at(2026, 9, 15, h))
    const four = await facts(W38, past)
    expect(four.closedTradeCount).toBe(4)
    expect(four.netPnl.value).toBe('4')
    approx(four.winRate.value, 1)
    approx(four.expectancyR.value, 0.1)
    expect([four.discipline.value, four.discipline.reason, four.scoredTradeCount, four.minScoredTradeCount]).toEqual([null, 'notEnoughTrades', 4, 5])
    await trade(at(2026, 9, 16, 9), { sl: null })
    const five = await facts(W38, past)
    expect(five.netPnl.value).toBe('5')
    approx(five.discipline.value, 90)
    expect([five.scoredTradeCount, five.rTradeCount]).toEqual([5, 4])
    approx(five.expectancyR.value, 0.1)
  })

  it('aucun trade avec un stop : un résultat, pas de R', async () => {
    await trade(at(2026, 9, 15, 9), { sl: null })
    const f = await facts(W38, past)
    expect([f.netPnl.value, f.expectancyR.value, f.expectancyR.reason, f.rTradeCount]).toEqual(['1', null, 'noRTrade', 0])
  })

  it('des comptes en devises différentes sont refusés ; un seul compte passe', async () => {
    await trade(at(2026, 9, 15, 9))
    await be.mock.createAccount({ name: 'Euro', kind: 'personal', broker: '', currency: 'EUR', initialCapital: '1000' })
    await expect(view(W38, past)).rejects.toThrow(/different currencies/)
    expect((await view(W38, past, { accountIds: [account] })).facts.closedTradeCount).toBe(1)
  })

  it('les objectifs de la semaine sont ceux de la page Objectifs, statuts tels quels', async () => {
    for (const h of [9, 11, 13, 15]) await trade(at(2026, 9, 15, h))
    await trade(at(2026, 9, 16, 9), { sl: null })
    await journal('2026-09-15')
    const set = (metric: 'no_stop_trades' | 'revenge_trades' | 'journal_days' | 'overtrading_days' | 'rules_respect_rate', target: string) =>
      be.mockProcessGoals.setProcessGoal({ periodKind: 'week', periodKey: W38, metric, target })
    await set('no_stop_trades', '0'); await set('revenge_trades', '0'); await set('journal_days', '2'); await set('overtrading_days', '1'); await set('rules_respect_rate', '90')
    const statuses = async (now: number) =>
      Object.fromEntries((await facts(W38, now)).goals.value!.map((g) => [g.goal.metric, g.status]))
    expect(await statuses(past)).toEqual({
      no_stop_trades: 'exceeded', overtrading_days: 'settingRequired', revenge_trades: 'respected', rules_respect_rate: 'noData', journal_days: 'missed',
    })
    const running = await statuses(during)
    expect([running.no_stop_trades, running.revenge_trades, running.journal_days]).toEqual(['exceeded', 'respectedSoFar', 'inProgress'])
    await journal('2026-09-16')
    expect((await statuses(past)).journal_days).toBe('reached')
  })

  it('pauses commencées dans la semaine et trades entrés pendant l’une d’elles (pile à la fin = hors)', async () => {
    const n = { length: { kind: 'minutes' as const, minutes: 60 }, reason: null, note: null, tzOffsetMin: 0 }
    await be.mockPause.startPause(n, at(2026, 9, 10, 10))
    await be.mockPause.startPause(n, at(2026, 9, 16, 10))
    await trade(at(2026, 9, 16, 9, 59))
    await trade(at(2026, 9, 16, 10, 30))
    await trade(at(2026, 9, 16, 11))
    const f = await facts(W38, past)
    expect([f.pauseCount, f.tradesDuringPause, f.closedTradeCount]).toEqual([1, 1, 3])
    expect((await facts('2026-W37', past)).pauseCount).toBe(1)
  })

  it('idées clôturées dans la semaine ; « à revoir » seulement pour la semaine en cours', async () => {
    const idea = (note: string, created: number) =>
      be.mockAnalysis.createIdea({ instrumentId: eurusd, timeframes: [], note, levelLow: null, levelHigh: null, invalidation: null }, created)
    await idea('ancienne', at(2026, 9, 1, 9))
    await idea('récente', at(2026, 9, 15, 9))
    const closedIn = await idea('clôturée dans la semaine', at(2026, 9, 2, 9))
    const closedOut = await idea('clôturée après', at(2026, 9, 3, 9))
    await be.mockAnalysis.ideaClose(closedIn.id, 'worked', null, 0, at(2026, 9, 17, 9))
    await be.mockAnalysis.ideaClose(closedOut.id, 'invalidated', null, 0, at(2026, 9, 22, 9))
    const f = await facts(W38, at(2026, 9, 18, 12))
    expect([f.ideasClosed, f.ideasToReview.value]).toEqual([1, 1])
    expect((await facts(W38, past)).ideasToReview.reason).toBe('onlyCurrentWeek')
  })

  it('l’erreur la plus coûteuse : trois trades et un vrai coût, sans repli sur la deuxième', async () => {
    const tag = async (name: string) => (await be.mock.createTag('mistake', name)).id
    const fomo = await tag('FOMO')
    for (const [h, loss] of [[9, 10], [11, 20], [13, 30]]) await losing(at(2026, 9, 15, h), loss, fomo)
    await trade(at(2026, 9, 16, 9))
    const m = (await facts(W38, past)).costlyMistake.value!
    expect([m.label, m.tradeCount, m.source, m.cost, m.tradeIds.length]).toEqual(['FOMO', 3, 'tag', '60', 3])
    // Une autre erreur coûte plus (2 × 50 = 100) mais sur 2 trades : celle-là serait la première, et elle n'est pas citée.
    const slip = await tag('Glissement')
    await losing(at(2026, 9, 17, 9), 50, slip)
    await losing(at(2026, 9, 17, 11), 50, slip)
    expect((await facts(W38, past)).costlyMistake).toEqual({ value: null, reason: 'notEnoughMistakeTrades' })
  })

  it('l’erreur la plus coûteuse : trois trades gagnants ne coûtent rien', async () => {
    const calm = (await be.mock.createTag('mistake', 'Trop tôt')).id
    for (const h of [9, 11, 13]) await trade(at(2026, 9, 15, h), { tagIds: [calm] })
    expect((await facts(W38, past)).costlyMistake.reason).toBe('noMistakeCost')
  })

  it('les jours de journal remplis dans la semaine seulement', async () => {
    for (const day of ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-20', '2026-09-21']) await journal(day)
    expect((await facts(W38, past)).journalDays).toBe(3)
  })
})

describe('la semaine : bornes ISO et changement d’heure', () => {
  it('semaine 53 de 2026 et semaine 1 de 2027 : coupure à minuit du lundi 4 janvier', async () => {
    await closingAt(at(2026, 12, 27, 23, 59))
    await closingAt(at(2026, 12, 28, 0))
    await closingAt(at(2027, 1, 3, 23, 59))
    await closingAt(at(2027, 1, 4, 0))
    const now = at(2027, 2, 1, 12)
    const counts = await Promise.all(['2026-W52', '2026-W53', '2027-W01'].map(async (k) => (await facts(k, now)).closedTradeCount))
    expect(counts).toEqual([1, 2, 1])
    const p = (await view('2026-W53', now)).period
    expect([p.firstDay, p.lastDay, p.previousKey, p.nextKey, p.state, (p.to - p.from) / DAY]).toEqual(['2026-12-28', '2027-01-03', '2026-W52', '2027-W01', 'past', 7])
  })

  it('semaine 1 de 2026 : du lundi 29 décembre 2025 au dimanche 4 janvier ; 2025 n’a pas de semaine 53', async () => {
    await closingAt(at(2025, 12, 28, 23, 59))
    await closingAt(at(2025, 12, 29, 0))
    await closingAt(at(2026, 1, 4, 23, 59))
    await closingAt(at(2026, 1, 5, 0))
    const now = at(2026, 2, 1, 12)
    const counts = await Promise.all(['2025-W52', '2026-W01', '2026-W02'].map(async (k) => (await facts(k, now)).closedTradeCount))
    expect(counts).toEqual([1, 2, 1])
    const p = (await view('2026-W01', now)).period
    expect([p.firstDay, p.lastDay, p.previousKey]).toEqual(['2025-12-29', '2026-01-04', '2025-W52'])
    for (const bad of ['2025-W53', '2026-W00', '2026-38']) await expect(view(bad, now)).rejects.toThrow(/invalid/)
  })

  it('la semaine du changement d’heure (19 au 25 octobre 2026) dure 169 heures, avec le décalage de chaque borne', async () => {
    await closingAt(at(2026, 10, 18, 22, 30)) // lundi 19 octobre 00:30 locale (+2)
    await closingAt(at(2026, 10, 21, 9))
    await closingAt(at(2026, 10, 25, 22, 59)) // dimanche 25 octobre 23:59 locale (+1)
    await closingAt(at(2026, 10, 25, 23)) //     lundi 26 octobre 00:00 locale : semaine suivante
    const now = at(2026, 10, 27, 9)
    const withOffset = await view('2026-W43', now, { tzOffsetMin: 60, boundaryOffsets: { '2026-10-19': 120 } })
    expect(withOffset.facts.closedTradeCount).toBe(3)
    expect((withOffset.period.to - withOffset.period.from) / H).toBe(169)
    expect([withOffset.period.from, withOffset.period.to]).toEqual([at(2026, 10, 18, 22), at(2026, 10, 25, 23)])
    expect((await view('2026-W43', now, { tzOffsetMin: 60 })).facts.closedTradeCount).toBe(2)
    expect((await view('2026-W44', now, { tzOffsetMin: 60 })).facts.closedTradeCount).toBe(1)
    await expect(view('2026-W43', now, { tzOffsetMin: 24 * 60 })).rejects.toThrow(/invalid UTC offset/)
    await expect(view('2026-W43', now, { tzOffsetMin: 60, boundaryOffsets: { '2026-10-19': 99_999 } })).rejects.toThrow(/invalid UTC offset/)
  })

  it('l’interface sait calculer ces décalages (même fonction que les objectifs de comportement)', () => {
    const offsetAt = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) < Date.UTC(2026, 9, 25) ? 120 : 60)
    expect(boundaryOffsets('week', '2026-W43', 60, offsetAt)['2026-10-19']).toBe(120)
  })
})

describe('le bilan : brouillon, terminé, supprimé', () => {
  it('un bilan entièrement vide est refusé et ne laisse rien, même pour vider un bilan enregistré', async () => {
    for (const bad of [input(W38), input(W38, ['  ', ''], { wentWell: '  \n ' })]) await expect(be.mockReview.saveWeeklyReview(bad, 0)).rejects.toThrow('review:empty')
    expect(await be.mockReview.listWeeklyReviews()).toEqual([])
    await be.mockReview.saveWeeklyReview(input(W38, ['Un stop à chaque trade']), 0)
    await expect(be.mockReview.saveWeeklyReview(input(W38), 0)).rejects.toThrow('review:empty')
    expect((await be.mockReview.listWeeklyReviews())[0].intentions).toHaveLength(1)
  })

  it('brouillon, puis terminé ; terminé le reste quand on le modifie ; le premier instant est gardé', async () => {
    const draft = await be.mockReview.saveWeeklyReview(input(W38, [], { wentWell: '  Mes stops  ' }), 0)
    expect([draft.state, draft.completedAt, draft.answers.wentWell, draft.createdAt, draft.updatedAt]).toEqual(['draft', null, 'Mes stops', sunday, sunday])
    expect([draft.firstDay, draft.lastDay]).toEqual(['2026-09-14', '2026-09-20'])
    vi.setSystemTime(sunday + H)
    const done = await be.mockReview.completeWeeklyReview(W38)
    expect([done.state, done.completedAt]).toEqual(['done', sunday + H])
    vi.setSystemTime(sunday + 2 * H)
    expect((await be.mockReview.completeWeeklyReview(W38)).completedAt).toBe(sunday + H)
    vi.setSystemTime(sunday + 3 * H)
    const edited = await be.mockReview.saveWeeklyReview(input(W38, [], { wentWell: 'Mes stops', doDifferently: 'Moins de trades' }), 0)
    expect([edited.state, edited.completedAt, edited.createdAt, edited.updatedAt]).toEqual(['done', sunday + H, sunday, sunday + 3 * H])
    expect(await be.mockReview.listWeeklyReviews()).toHaveLength(1)
    await expect(be.mockReview.completeWeeklyReview('2026-W10')).rejects.toThrow(/not found/)
  })

  it('réponses et intentions : nettoyées et bornées, une semaine pas commencée est refusée', async () => {
    const saved = await be.mockReview.saveWeeklyReview(input(W38, ['', ' Pas de   revanche ', '', 'Journal chaque soir']), 0)
    expect(saved.intentions.map((i) => [i.position, i.text])).toEqual([[1, 'Pas de revanche'], [2, 'Journal chaque soir']])
    await expect(be.mockReview.saveWeeklyReview(input('2026-W37', ['a', 'b', 'c', 'd']), 0)).rejects.toThrow('review:tooManyIntentions')
    await expect(be.mockReview.saveWeeklyReview(input('2026-W37', ['x'.repeat(201)]), 0)).rejects.toThrow('review:intentionTooLong')
    expect((await be.mockReview.saveWeeklyReview(input('2026-W37', ['é'.repeat(200)]), 0)).intentions[0].text).toHaveLength(200)
    await expect(be.mockReview.saveWeeklyReview(input('2026-W36', [], { nextPriority: 'y'.repeat(1001) }), 0)).rejects.toThrow('review:answerTooLong')
    expect((await be.mockReview.listWeeklyReviews()).map((r) => r.periodKey)).toEqual([W38, '2026-W37'])
    await expect(be.mockReview.saveWeeklyReview(input('2026-W99', ['a']), 0)).rejects.toThrow(/invalid week/)
    await expect(be.mockReview.saveWeeklyReview(input('2026-W39', ['a']), 0)).rejects.toThrow('review:future')
    vi.setSystemTime(at(2026, 9, 21, 0))
    await be.mockReview.saveWeeklyReview(input('2026-W39', ['a']), 0)
    vi.setSystemTime(at(2026, 9, 27, 23, 30))
    await be.mockReview.saveWeeklyReview(input('2026-W40', ['a']), 120)
    vi.setSystemTime(at(2026, 10, 4, 23, 30))
    await expect(be.mockReview.saveWeeklyReview(input('2026-W41', ['a']), -120)).rejects.toThrow('review:future')
  })

  it('une intention inchangée garde son suivi, une intention modifiée repart non évaluée, une intention retirée disparaît', async () => {
    const first = await be.mockReview.saveWeeklyReview(input(W38, ['Stops', 'Journal', 'Pauses']), 0)
    for (const [i, o] of first.intentions.map((x, n) => [x, (['kept', 'partly', 'notKept'] as const)[n]] as const)) await be.mockReview.setIntentionOutcome(i.id, o)
    const second = await be.mockReview.saveWeeklyReview(input(W38, ['Stops', 'Journal le soir']), 0)
    expect(second.intentions.map((i) => [i.text, i.outcome])).toEqual([['Stops', 'kept'], ['Journal le soir', null]])
    expect(second.intentions[0].id).toBe(first.intentions[0].id)
  })

  it('supprimer un bilan supprime ses intentions et celles-là seulement', async () => {
    await be.mockReview.saveWeeklyReview(input(W38, ['a', 'b']), 0)
    await be.mockReview.saveWeeklyReview(input('2026-W37', ['c']), 0)
    expect(await be.mockReview.deleteWeeklyReview(W38)).toBe(true)
    expect(await be.mockReview.deleteWeeklyReview(W38)).toBe(false)
    const left = await be.mockReview.listWeeklyReviews()
    expect(left.map((r) => [r.periodKey, r.intentions.length])).toEqual([['2026-W37', 1]])
  })
})

describe('la boucle d’intention', () => {
  it('le bilan d’une semaine montre les intentions de la semaine d’avant et leur suivi', async () => {
    vi.setSystemTime(at(2026, 9, 13, 19))
    const w37 = await be.mockReview.saveWeeklyReview(input('2026-W37', ['Un stop à chaque trade', 'Pas de revanche']), 0)
    vi.setSystemTime(sunday)
    const last = (await view(W38, sunday)).lastWeek!
    expect([last.periodKey, last.firstDay, last.lastDay]).toEqual(['2026-W37', '2026-09-07', '2026-09-13'])
    expect(last.intentions.map((i) => i.outcome)).toEqual([null, null])
    expect((await view(W38, sunday)).review).toBeNull()
    await be.mockReview.setIntentionOutcome(w37.intentions[0].id, 'kept')
    await be.mockReview.setIntentionOutcome(w37.intentions[1].id, 'notKept')
    expect((await view(W38, sunday)).lastWeek!.intentions.map((i) => i.outcome)).toEqual(['kept', 'notKept'])
    expect((await be.mockReview.setIntentionOutcome(w37.intentions[1].id, null)).outcome).toBeNull()
    await expect(be.mockReview.setIntentionOutcome(9999, 'kept')).rejects.toThrow(/not found/)
    expect((await view('2026-W37', sunday)).lastWeek).toBeNull()
    // Des réponses seules ne sont pas des intentions.
    vi.setSystemTime(at(2026, 9, 27, 19))
    await be.mockReview.saveWeeklyReview(input('2026-W39', [], { wentWell: 'x' }), 0)
    expect((await view('2026-W40', at(2026, 10, 4, 19))).lastWeek).toBeNull()
  })

  it('la série compte les semaines de suite avec au moins une intention tenue ; tout le reste l’interrompt', async () => {
    await seed('2026-W35', ['notKept', 'kept'])
    await seed('2026-W36', ['kept'])
    await seed('2026-W37', ['partly', 'kept', null])
    expect((await view(W38, sunday)).streak).toBe(3)
    expect([(await view('2026-W37', sunday)).streak, (await view('2026-W35', sunday)).streak]).toEqual([2, 0])
    await seed('2026-W38', [null, null])
    expect([(await view('2026-W39', sunday)).streak, (await view('2026-W40', sunday)).streak]).toEqual([0, 0])
    const w38 = (await be.mockReview.listWeeklyReviews()).find((r) => r.periodKey === W38)!
    await be.mockReview.setIntentionOutcome(w38.intentions[0].id, 'partly')
    expect((await view('2026-W39', sunday)).streak).toBe(0)
    await be.mockReview.setIntentionOutcome(w38.intentions[1].id, 'kept')
    expect((await view('2026-W39', sunday)).streak).toBe(4)
    await be.mockReview.deleteWeeklyReview('2026-W36')
    expect((await view('2026-W39', sunday)).streak).toBe(2)
  })

  it('la série ne dépasse jamais 52', async () => {
    for (let n = 0; n < 60; n++) {
      const week = shiftPeriod('week', W38, -(n + 1))
      be.mockReview.seed({ periodKey: week, createdAt: 0, updatedAt: 0, completedAt: null, answers: { wentWell: '', doDifferently: '', nextPriority: '' }, intentions: [{ text: 'x', outcome: 'kept' }] })
    }
    expect((await view(W38, sunday)).streak).toBe(52)
  })

  it('le statut de la semaine en cours : à faire, brouillon, fait, et les intentions en cours', async () => {
    vi.setSystemTime(during)
    let s = await be.mockReview.getWeeklyReviewStatus(0)
    expect([s.periodKey, s.state, s.intentions.length, s.intentionsFrom, s.firstDay, s.lastDay]).toEqual([W38, 'todo', 0, null, '2026-09-14', '2026-09-20'])
    vi.setSystemTime(at(2026, 9, 13, 19))
    await be.mockReview.saveWeeklyReview(input('2026-W37', ['Stops']), 0)
    vi.setSystemTime(during)
    s = await be.mockReview.getWeeklyReviewStatus(0)
    expect([s.state, s.intentionsFrom, s.intentions.length]).toEqual(['todo', '2026-W37', 1])
    await be.mockReview.saveWeeklyReview(input(W38, ['Journal']), 0)
    s = await be.mockReview.getWeeklyReviewStatus(0)
    expect([s.state, s.intentionsFrom, s.intentions[0].text]).toEqual(['draft', W38, 'Journal'])
    await be.mockReview.completeWeeklyReview(W38)
    expect((await be.mockReview.getWeeklyReviewStatus(0)).state).toBe('done')
    vi.setSystemTime(at(2026, 9, 20, 23, 30))
    expect((await be.mockReview.getWeeklyReviewStatus(120)).periodKey).toBe('2026-W39')
  })
})

describe('le rappel du dimanche', () => {
  const sundayAt = (h: number, m: number) => at(2026, 9, 20, h, m)

  it('à 18:00 pile, pas à 17:59 ; heure locale ; dimanche seulement ; une fois par semaine', async () => {
    await trade(at(2026, 9, 15, 9))
    const { mockReview: r } = be
    expect(r.tick(sundayAt(17, 59), 0)).toBeNull()
    expect(r.tick(sundayAt(18, 0) - 1, 0)).toBeNull()
    expect(r.tick(sundayAt(15, 59), 120)).toBeNull()
    for (const d of [14, 15, 16, 17, 18, 19]) expect(r.tick(at(2026, 9, d, 19), 0), `jour ${d}`).toBeNull()
    expect(r.tick(sundayAt(18, 0), 0)).toEqual({ periodKey: W38, closedTradeCount: 1, journalDays: 0 })
    expect(r.tick(sundayAt(18, 1), 0)).toBeNull()
    expect(r.tick(at(2026, 9, 27, 18), 0)).toBeNull()
    await trade(at(2026, 9, 22, 9))
    expect(r.tick(at(2026, 9, 27, 18), 0)?.periodKey).toBe('2026-W39')
  })

  it('sans trade clôturé ni journal : rien, et rien n’est retenu ; le journal seul suffit', async () => {
    const { mockReview: r } = be
    expect(r.tick(sundayAt(18, 0), 0)).toBeNull()
    await trade(at(2026, 9, 8, 9)) // une autre semaine
    expect(r.tick(sundayAt(18, 0), 0)).toBeNull()
    await journal('2026-09-17')
    expect(r.tick(sundayAt(21, 0), 0)).toEqual({ periodKey: W38, closedTradeCount: 0, journalDays: 1 })
  })

  it('réglages : activé par défaut à 18:00 le dimanche, désactivable, heure déplaçable, jour fixe', async () => {
    await trade(at(2026, 9, 15, 9))
    const { mockReview: r } = be
    expect(await r.getReviewReminder()).toEqual({ enabled: true, time: '18:00', day: 'sunday' })
    await r.setReviewReminder({ enabled: false, time: '18:00', day: 'sunday' })
    expect(r.tick(sundayAt(19, 0), 0)).toBeNull()
    const later = { enabled: true, time: '20:30', day: 'sunday' as const }
    await r.setReviewReminder(later)
    expect([r.tick(sundayAt(18, 0), 0), r.tick(sundayAt(20, 29), 0)]).toEqual([null, null])
    expect(r.tick(sundayAt(20, 30), 0)).not.toBeNull()
    for (const bad of [{ ...later, time: '25:00' }, { ...later, time: '18h' }, { ...later, time: '9:5' }]) await expect(r.setReviewReminder(bad)).rejects.toThrow('review:badTime')
    await expect(r.setReviewReminder({ ...later, day: 'monday' as never })).rejects.toThrow('review:badDay')
    expect(await r.getReviewReminder()).toEqual(later)
  })

  it('la bannière : armée par le rappel, repoussée par « Plus tard », absente quand le bilan est fait ou le lundi', async () => {
    await trade(at(2026, 9, 15, 9))
    const { mockReview: r } = be
    vi.setSystemTime(sundayAt(17, 30))
    expect(await r.getReviewReminderPending(0)).toBeNull()
    vi.setSystemTime(sundayAt(18, 30))
    expect((await r.getReviewReminderPending(0))?.periodKey).toBe(W38)
    vi.setSystemTime(at(2026, 9, 21, 9))
    expect(await r.getReviewReminderPending(0)).toBeNull()
    vi.setSystemTime(sundayAt(18, 31))
    await r.dismissReviewReminder(0)
    expect(await r.getReviewReminderPending(0)).toBeNull()
    // Terminé : plus de bannière, même sans « Plus tard ». Un brouillon ne l'arrête pas.
    r.reset()
    await r.saveWeeklyReview(input(W38, ['x']), 0)
    expect(await r.getReviewReminderPending(0)).not.toBeNull()
    await r.completeWeeklyReview(W38)
    expect(await r.getReviewReminderPending(0)).toBeNull()
  })
})

/** Sources lues telles quelles (Vite : pas besoin des types de Node). */
const SOURCES = import.meta.glob<string>(['./*.ts', '../components/tradeCard/*.tsx', '../components/coach/*.tsx', '../pages/CoachPage.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('confidentialité', () => {
  it('ni le coach, ni l’accès MCP, ni l’export, ni la carte de trade ne lisent le bilan (aucun outil ajouté)', () => {
    const files = Object.entries(SOURCES).filter(
      ([path]) => /\/(mockCoach|mockMcp|mockExport|mockPdf|tradeCard|coach|Coach)/.test(path) && !path.endsWith('.test.ts'),
    )
    expect(files.length).toBeGreaterThan(3)
    for (const [path, text] of files) expect(text, path).not.toMatch(/mockReview|weekly_?review|WeeklyReview|types\/review/i)
  })
})
