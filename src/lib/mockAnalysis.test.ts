// Mêmes cas que `crates/pulse-core/src/analysis/tests.rs` (journaux calculés à la main) : le faux backend
// du navigateur doit dire la même chose que le cœur Rust.
import { describe, expect, it } from 'vitest'

import type { AnalysisInput, IdeaInput } from '../types/analysis'
import type { Tag } from '../types/trade'
import { createAnalysisMock, noAnalysisAlerts } from './mockAnalysis'

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000
/** Lundi 2026-09-28 00:00 UTC. */
const MON = 20_724 * DAY
const at = (d: number, h: number) => MON + d * DAY + h * HOUR

const tags: Tag[] = [
  { id: 1, kind: 'setup', name: 'Breakout', archived: false },
  { id: 2, kind: 'mistake', name: 'Trop tôt', archived: false },
  { id: 3, kind: 'emotion', name: 'Calme', archived: false },
]

function make(over: { newsEnabled?: boolean; events?: Parameters<typeof eventsOfDay>[0] } = {}) {
  const events = over.events ?? []
  const mock = createAnalysisMock({
    instruments: () => [{ id: 1, symbol: 'EURUSD' }],
    tags: () => tags,
    tradeExists: (id) => id === 1,
    news: { enabled: () => over.newsEnabled ?? false, eventsOfDay: (day) => eventsOfDay(events, day) },
    comparison: () => {
      throw new Error('unused')
    },
    now: () => MON,
  })
  return mock
}
function eventsOfDay(events: { id: number; title: string; importance: 'low' | 'medium' | 'high'; day: string; parisTime: string | null }[], day: string) {
  return events.filter((e) => e.day === day).map((e) => ({ ...e, source: 'file', startsAt: null, weekday: 1, currency: 'USD', forecast: null, previous: null, actual: null, updatedAt: 0 }))
}

const idea = (note = 'Résistance en W'): IdeaInput => ({ instrumentId: 1, timeframes: ['weekly'], note, levelLow: null, levelHigh: null, invalidation: null })
const qid = async (m: ReturnType<typeof make>, key: string) => (await m.getAnalysisQuestions(true)).find((q) => q.key === key)!.id
const analysis = async (m: ReturnType<typeof make>, created: number, tz = 0, value = '4 250'): Promise<AnalysisInput> => ({
  createdAt: created, tzOffsetMin: tz, note: null, answers: [{ questionId: await qid(m, 'levels'), value }],
})
const idOfIdea = async (m: ReturnType<typeof make>, day: number) => (await m.createIdea(idea(), at(day, 10))).id
const queueIds = async (m: ReturnType<typeof make>, now: number, tz = 0) => (await m.getReviewQueue(tz, now)).items.map((v) => v.id)

describe('questions', () => {
  it('sont semées dans l’ordre, archivées jamais supprimées', async () => {
    const m = make()
    const list = await m.getAnalysisQuestions(false)
    expect(list.map((q) => q.key)).toEqual(['trend', 'levels', 'news', 'alts', 'scenarioMain', 'scenarioAlt', 'invalidation', 'assets', 'setups', 'conviction', 'riskLimits', 'state', 'mistakeToAvoid'])
    expect(list[0].options).toEqual({ timeframes: ['monthly', 'weekly', 'daily', 'h4', 'h1'] })
    const levels = await qid(m, 'levels')
    const a = await m.createAnalysis(await analysis(m, MON))
    await m.setAnalysisQuestionArchived(levels, true)
    expect((await m.getAnalysisQuestions(false)).some((q) => q.id === levels)).toBe(false)
    expect((await m.getAnalysisQuestions(true)).some((q) => q.id === levels && q.archived)).toBe(true)
    expect((await m.listAnalysesOfDay(a.day))[0].answers).toHaveLength(1)
  })

  it('s’ajoutent, se renomment, se réordonnent ; options vérifiées', async () => {
    const m = make()
    const q = await m.addAnalysisQuestion('  Mon biais   de la semaine ', 'shortText', {})
    expect([q.label, q.key, q.position]).toEqual(['Mon biais de la semaine', `custom_${q.id}`, 14])
    await expect(m.addAnalysisQuestion('  ', 'shortText', {})).rejects.toThrow()
    await expect(m.addAnalysisQuestion('Annonces bis', 'news', {})).rejects.toThrow()
    await expect(m.addAnalysisQuestion('Humeur', 'choice', { choices: ['Bonne'] })).rejects.toThrow()
    await expect(m.addAnalysisQuestion('Humeur', 'choice', { choices: ['Bonne', 'bonne'] })).rejects.toThrow()
    expect((await m.addAnalysisQuestion('Humeur', 'choice', { choices: ['Bonne', 'Moyenne'] })).options).toEqual({ choices: ['Bonne', 'Moyenne'] })
    const levels = await qid(m, 'levels')
    expect((await m.updateAnalysisQuestion(levels, 'Mes zones', null)).label).toBe('Mes zones')
    expect((await m.updateAnalysisQuestion(levels, null, null)).label).toBeNull()
    await expect(m.updateAnalysisQuestion(q.id, null, null)).rejects.toThrow()
    const trend = await qid(m, 'trend')
    expect((await m.updateAnalysisQuestion(trend, null, { timeframes: ['h4', 'weekly', 'm15'] })).options).toEqual({ timeframes: ['weekly', 'h4', 'm15'] })
    await expect(m.updateAnalysisQuestion(trend, null, { timeframes: [] })).rejects.toThrow()
    const order = async () => (await m.getAnalysisQuestions(false)).map((x) => x.key).slice(0, 3)
    await m.moveAnalysisQuestion(levels, 1)
    expect(await order()).toEqual(['trend', 'news', 'levels'])
    await m.moveAnalysisQuestion(levels, -1)
    expect(await order()).toEqual(['trend', 'levels', 'news'])
    await m.moveAnalysisQuestion(trend, -1)
    expect(await order()).toEqual(['trend', 'levels', 'news'])
    await m.setAnalysisQuestionArchived(levels, true)
    await expect(m.moveAnalysisQuestion(levels, 1)).rejects.toThrow()
  })
})

describe('analyses de séance', () => {
  it('une analyse vide est refusée, une question sans réponse reste vide', async () => {
    const m = make()
    const empty: AnalysisInput = { createdAt: MON, tzOffsetMin: 0, note: null, answers: [] }
    await expect(m.createAnalysis(empty)).rejects.toThrow()
    const blanks = [
      { questionId: await qid(m, 'levels'), value: '   ' },
      { questionId: await qid(m, 'conviction'), value: null },
      { questionId: await qid(m, 'setups'), value: [] },
      { questionId: await qid(m, 'trend'), value: { weekly: { trend: null, note: '' } } },
    ]
    await expect(m.createAnalysis({ ...empty, answers: blanks })).rejects.toThrow()
    expect(await m.listAnalysesOfDay('2026-09-28')).toHaveLength(0)
    const ok = await m.createAnalysis({ ...empty, answers: [{ questionId: await qid(m, 'levels'), value: ' 4 250 ' }, { questionId: await qid(m, 'conviction'), value: null }] })
    expect(ok.answers).toHaveLength(1)
    expect(ok.answers[0].value).toBe('4 250')
  })

  it('vérifie chaque réponse selon le type de la question', async () => {
    const m = make()
    const one = async (key: string, value: unknown) =>
      m.createAnalysis({ createdAt: MON, tzOffsetMin: 0, note: null, answers: [{ questionId: await qid(m, key), value: value as never }] })
    await expect(one('conviction', 0)).rejects.toThrow()
    await expect(one('conviction', 11)).rejects.toThrow()
    await expect(one('conviction', 7.5)).rejects.toThrow()
    await expect(one('conviction', 10)).resolves.toBeTruthy()
    await expect(one('trend', { weekly: { trend: 'sideways' } })).rejects.toThrow()
    await expect(one('trend', { yearly: { trend: 'up' } })).rejects.toThrow()
    const trend = await one('trend', { daily: { trend: 'up', note: ' au-dessus de la 200 ' }, h4: { trend: null, note: '' } })
    expect(trend.answers[0].value).toEqual({ daily: { trend: 'up', note: 'au-dessus de la 200' } })
    await expect(one('setups', [2])).rejects.toThrow()
    expect((await one('setups', [1, 1])).answers[0].value).toEqual([1])
    await expect(one('state', { tagIds: [1] })).rejects.toThrow()
    expect((await one('state', { text: 'Fatigué', tagIds: [3] })).answers[0].value).toEqual({ text: 'Fatigué', tagIds: [3] })
    await expect(one('news', { note: 'Plan inchangé' })).resolves.toBeTruthy()
    await expect(one('levels', 'x'.repeat(4001))).rejects.toThrow()
    await expect(one('levels', 12)).rejects.toThrow()
  })

  it('plusieurs analyses par jour, jour local selon le décalage, heure modifiable', async () => {
    const m = make()
    const late = await m.createAnalysis(await analysis(m, MON + 23 * HOUR + 30 * MIN, 120))
    expect(late.day).toBe('2026-09-29')
    const morning = await m.createAnalysis(await analysis(m, MON + DAY + 7 * HOUR, 120))
    const noon = await m.createAnalysis(await analysis(m, MON + DAY + 10 * HOUR, 120))
    expect((await m.listAnalysesOfDay('2026-09-29')).map((a) => a.id)).toEqual([late.id, morning.id, noon.id])
    expect(await m.listAnalysesOfDay('2026-09-28')).toEqual([])
    expect(await m.listAnalysesBefore('2026-09-29', 10)).toEqual([])
    expect(await m.listAnalysesBefore('2026-09-30', 10)).toHaveLength(3)
    const moved = await m.updateAnalysis(late.id, { createdAt: MON + 10 * HOUR, tzOffsetMin: 120, note: null, answers: [] }, MON + DAY)
    expect(moved.day).toBe('2026-09-28')
    expect(moved.answers).toHaveLength(1)
  })

  it('modifier une analyse ne détruit jamais la réponse d’une question archivée', async () => {
    const m = make()
    const a = await m.createAnalysis(await analysis(m, MON))
    const levels = await qid(m, 'levels')
    await m.setAnalysisQuestionArchived(levels, true)
    const edit = (answers: AnalysisInput['answers']) => m.updateAnalysis(a.id, { createdAt: null, tzOffsetMin: 0, note: 'Note', answers }, MON + 1)
    const alts = await qid(m, 'alts')
    expect((await edit([{ questionId: alts, value: 'SOL' }])).answers).toHaveLength(2)
    await expect(
      m.updateAnalysis(a.id, { createdAt: null, tzOffsetMin: 0, note: null, answers: [{ questionId: levels, value: '' }, { questionId: alts, value: '' }] }),
    ).rejects.toThrow()
    expect((await m.listAnalysesOfDay(a.day))[0].answers).toHaveLength(2)
    const archivedNew = await qid(m, 'scenarioAlt')
    await m.setAnalysisQuestionArchived(archivedNew, true)
    await expect(edit([{ questionId: archivedNew, value: 'z' }])).rejects.toThrow()
  })
})

describe('annonces du jour', () => {
  it('lit le calendrier déjà stocké : éteint, aucune annonce, annonces fortes seulement', async () => {
    const off = make()
    expect(await off.getNewsBlock(null, at(0, 10))).toMatchObject({ state: 'off', day: '2026-09-28', events: [] })
    const events = [
      { id: 1, title: 'CPI', importance: 'high' as const, day: '2026-09-28', parisTime: '14:30' },
      { id: 2, title: 'Ventes', importance: 'medium' as const, day: '2026-09-28', parisTime: '15:00' },
      { id: 3, title: 'NFP', importance: 'high' as const, day: '2026-09-29', parisTime: '14:30' },
    ]
    const on = make({ newsEnabled: true, events })
    const block = await on.getNewsBlock(null, at(0, 10))
    expect(block.state).toBe('events')
    expect(block.events.map((e) => [e.title, e.parisTime])).toEqual([['CPI', '14:30']])
    expect((await on.getNewsBlock('2026-09-29', 0)).events[0].title).toBe('NFP')
    expect((await on.getNewsBlock('2026-10-05', 0)).state).toBe('none')
    await expect(on.getNewsBlock('hier', 0)).rejects.toThrow()
    expect((await make({ newsEnabled: true }).getNewsBlock(null, at(0, 10))).state).toBe('none')
  })
})

describe('idées', () => {
  it('fil daté jamais réécrit, prix exacts', async () => {
    const m = make()
    const input: IdeaInput = { ...idea('  ALGO arrive sur un niveau  '), levelLow: '0.1850', levelHigh: '0.1900', timeframes: ['h4', 'weekly', 'weekly'] as never }
    const created = await m.createIdea(input, MON)
    expect([created.note, created.levelLow, created.levelHigh, created.timeframes]).toEqual(['ALGO arrive sur un niveau', '0.1850', '0.1900', ['weekly', 'h4']])
    expect(created.notes.map((n) => n.kind)).toEqual(['created'])
    for (const bad of [{ note: '  ' }, { levelLow: '1e5' }, { levelLow: '0' }, { levelLow: '2', levelHigh: '1' }, { timeframes: ['yearly'] }, { instrumentId: 99999 }]) {
      await expect(m.createIdea({ ...idea('x'), ...bad } as IdeaInput, MON)).rejects.toThrow()
    }
    const edited = await m.updateIdea(created.id, { ...input, note: 'ALGO : résistance en W' }, MON + DAY)
    expect(edited.notes.map((n) => n.kind)).toEqual(['created', 'edit'])
    expect(edited.notes[0].body).toBe('ALGO arrive sur un niveau')
    expect(edited.updatedAt).toBe(MON + DAY)
    const same = await m.updateIdea(created.id, { ...input, note: 'ALGO : résistance en W' }, MON + 2 * DAY)
    expect([same.notes.length, same.updatedAt]).toEqual([2, MON + DAY])
    const priced = await m.updateIdea(created.id, { ...input, note: 'ALGO : résistance en W', levelHigh: '0.2000' }, MON + 3 * DAY)
    expect([priced.notes.length, priced.updatedAt]).toEqual([2, MON + 3 * DAY])
  })

  it('clôturer enregistre le résultat, supprimer retire le fil', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const closed = await m.ideaClose(id, 'worked', ' cible atteinte ', 0, at(1, 0))
    expect([closed.status, closed.outcome, closed.closedAt]).toEqual(['closed', 'worked', at(1, 0)])
    const last = closed.notes[closed.notes.length - 1]
    expect([last.kind, last.body, last.data]).toEqual(['closed', 'cible atteinte', 'worked'])
    expect(await m.listIdeas('active', null, 0)).toHaveLength(0)
    expect(await m.listIdeas('closed', null, 0)).toHaveLength(1)
    await expect(m.ideaClose(id, 'invalidated', null, 0)).rejects.toThrow()
    await expect(m.ideaComplete(id, 'x', 0)).rejects.toThrow()
    await expect(m.ideaSnooze(id, 1, 0)).rejects.toThrow()
    await m.ideaDelete(id, 0)
    expect(await m.listIdeas('closed', null, 0)).toHaveLength(0)
  })
})

describe('revue du matin', () => {
  it('bannière : seulement si le jour a changé et qu’une idée attend ; lecture seule', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    expect(await m.getReviewBanner(0, at(0, 20))).toBeNull()
    expect(await m.getReviewBanner(0, at(1, 7))).toEqual({ day: '2026-09-29', count: 1 })
    expect((await m.getAnalysisSettings()).staleDays).toBe(7)
    await m.dismissReviewBanner(0, at(1, 7))
    expect(await m.getReviewBanner(0, at(1, 18))).toBeNull()
    expect((await m.getReviewBanner(0, at(2, 7)))?.count).toBe(1)
    expect(await queueIds(m, at(1, 18))).toEqual([id])
  })

  it('une idée clôturée ou mise à jour aujourd’hui ne compte pas', async () => {
    const m = make()
    expect(await m.getReviewBanner(0, at(3, 8))).toBeNull()
    const a = await idOfIdea(m, 0)
    const b = await idOfIdea(m, 0)
    await m.ideaClose(a, 'noFollowUp', null, 0, at(1, 8))
    await m.ideaComplete(b, 'Toujours là', 0, at(1, 9))
    expect(await m.getReviewBanner(0, at(1, 10))).toBeNull()
    expect(await queueIds(m, at(2, 8))).toEqual([b])
  })

  it('« Toujours valable » : revue du jour, rien n’est ajouté', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const v = await m.ideaKeep(id, 0, at(1, 8))
    expect([v.notes.length, v.updatedAt, v.lastReviewedAt]).toEqual([1, at(0, 10), at(1, 8)])
    expect([v.reviewedToday, v.inReview]).toEqual([true, false])
    expect(await queueIds(m, at(1, 20))).toEqual([])
    expect(await queueIds(m, at(2, 0))).toEqual([id])
    expect(await m.getReviewBanner(0, at(1, 20))).toBeNull()
  })

  it('ancienneté : à revoir à partir d’exactement N jours ; « Toujours valable » ne la remet pas à zéro', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const stale = async (d: number) => {
      const v = (await m.getReviewQueue(0, at(d, 8))).items[0]
      return v && [v.ageDays, v.stale]
    }
    expect(await stale(6)).toEqual([6, false])
    expect(await stale(7)).toEqual([7, true])
    expect(await stale(9)).toEqual([9, true])
    expect((await m.setAnalysisSettings({ staleDays: 1, noAnalysisAlert: false })).staleDays).toBe(1)
    expect(await stale(1)).toEqual([1, true])
    for (const bad of [0, 61]) await expect(m.setAnalysisSettings({ staleDays: bad, noAnalysisAlert: true })).rejects.toThrow()
    expect(await m.getAnalysisSettings()).toEqual({ staleDays: 1, noAnalysisAlert: false })
    await m.ideaKeep(id, 0, at(2, 8))
    expect((await m.listIdeas('active', null, 0, at(3, 8)))[0].stale).toBe(true)
    await m.ideaComplete(id, 'Mise à jour', 0, at(3, 9))
    expect((await m.listIdeas('active', null, 0, at(3, 10)))[0].stale).toBe(false)
  })

  it('ordre de la file et limite de 5 affichées', async () => {
    const m = make()
    const ids: number[] = []
    for (let i = 0; i < 7; i++) ids.push(await idOfIdea(m, 0))
    const fresh = await idOfIdea(m, 7)
    const q = await m.getReviewQueue(0, at(8, 8))
    expect([q.items.length, q.visible, q.hidden]).toEqual([8, 5, 3])
    expect(q.items.map((v) => v.id)).toEqual([...ids, fresh])
    expect(q.items.slice(0, 7).every((v) => v.stale) && !q.items[7].stale).toBe(true)
    const few = make()
    await idOfIdea(few, 0)
    const q2 = await few.getReviewQueue(0, at(1, 8))
    expect([q2.visible, q2.hidden]).toEqual([1, 0])
  })
})

describe('report « redemander dans… »', () => {
  it('1 jour : masquée aujourd’hui et demain, de retour à 00:00 local', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const v = await m.ideaSnooze(id, 1, 0, at(1, 9))
    expect([v.snoozedUntilDay, v.snoozeCount, v.snoozed, v.inReview]).toEqual(['2026-09-30', 1, true, false])
    expect([v.status, v.createdAt, v.updatedAt]).toEqual(['active', at(0, 10), at(0, 10)])
    const last = v.notes[v.notes.length - 1]
    expect([last.kind, last.data, v.notes.length]).toEqual(['snooze', '2026-09-30', 2])
    expect(await queueIds(m, at(1, 23))).toEqual([])
    expect(await queueIds(m, at(2, 0) - 1)).toEqual([])
    expect(await queueIds(m, at(2, 0))).toEqual([id])
    expect(await m.getReviewBanner(0, at(1, 23) + 59 * MIN)).toBeNull()
  })

  it('le jour dit est inclus ; l’idée revient en tête ; elle n’est pas comptée avant', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const other = await idOfIdea(m, 0)
    expect((await m.ideaSnooze(id, 3, 0, at(1, 9))).snoozedUntilDay).toBe('2026-10-02')
    expect(await queueIds(m, at(4, 0) - 1)).toEqual([other])
    expect((await m.getReviewBanner(0, at(3, 23)))?.count).toBe(1)
    const back = await m.getReviewQueue(0, at(4, 0))
    expect(back.items.map((v) => v.id)).toEqual([id, other])
    expect(back.items[0].returned).toBe(true)
    expect((await m.getReviewBanner(0, at(4, 0)))?.count).toBe(2)
  })

  it('bornes 1 à 30, report répété, sans limite', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    for (const bad of [0, 31, 365]) await expect(m.ideaSnooze(id, bad, 0, at(1, 9))).rejects.toThrow()
    expect((await m.listIdeas('active', null, 0, at(1, 9)))[0].snoozeCount).toBe(0)
    expect((await m.ideaSnooze(id, 30, 0, at(1, 9))).snoozedUntilDay).toBe('2026-10-29')
    expect((await m.ideaSnooze(id, 1, 0, at(1, 10))).snoozedUntilDay).toBe('2026-09-30')
    const r = make()
    const rid = await idOfIdea(r, 0)
    let last
    for (let d = 1; d <= 3; d++) last = await r.ideaSnooze(rid, 1, 0, at(d * 2, 9))
    expect([last!.snoozeCount, last!.notes.filter((n) => n.kind === 'snooze').length, last!.status]).toEqual([3, 3, 'active'])
  })

  it('« Toujours valable », « Compléter », « Clôturer » et une modification annulent le report', async () => {
    const m = make()
    for (const action of [0, 1, 2]) {
      const id = await idOfIdea(m, 0)
      await m.ideaSnooze(id, 5, 0, at(1, 9))
      if (action === 0) await m.ideaKeep(id, 0, at(2, 9))
      else if (action === 1) await m.ideaComplete(id, 'Mise à jour', 0, at(2, 9))
      else await m.ideaClose(id, 'invalidated', null, 0, at(2, 9))
      const v = [...(await m.listIdeas('active', null, 0, at(2, 9))), ...(await m.listIdeas('closed', null, 0, at(2, 9)))].find((i) => i.id === id)!
      expect([v.snoozedUntilDay, v.snoozeCount]).toEqual([null, 1])
    }
    const id = await idOfIdea(m, 0)
    await m.ideaSnooze(id, 5, 0, at(1, 9))
    await m.updateIdea(id, { ...idea('Nouveau texte'), timeframes: [] }, at(2, 9))
    expect((await m.listIdeas('active', null, 0, at(2, 9))).find((i) => i.id === id)!.snoozedUntilDay).toBeNull()
  })

  it('la mention « à revoir » disparaît pendant le report puis revient', async () => {
    const m = make()
    const id = await idOfIdea(m, 0)
    const flags = async (d: number) => {
      const v = (await m.listIdeas('active', null, 0, at(d, 8))).find((i) => i.id === id)!
      return [v.stale, v.snoozed, v.returned]
    }
    expect(await flags(8)).toEqual([true, false, false])
    await m.ideaSnooze(id, 3, 0, at(8, 9))
    expect(await flags(9)).toEqual([false, true, false])
    expect(await flags(10)).toEqual([false, true, false])
    expect(await flags(11)).toEqual([true, false, true])
    const fresh = await idOfIdea(m, 12)
    await m.ideaSnooze(fresh, 2, 0, at(13, 9))
    const v = (await m.listIdeas('active', null, 0, at(15, 8))).find((i) => i.id === fresh)!
    expect([v.stale, v.returned, v.ageDays]).toEqual([false, true, 3])
  })

  it('le jour est celui du PC, pas UTC', async () => {
    const m = make()
    const id = (await m.createIdea(idea(), at(0, 22) + 30 * MIN)).id
    expect(await m.getReviewBanner(120, at(1, 6))).toBeNull()
    const now = at(1, 22) + 30 * MIN
    expect((await m.getReviewBanner(120, now))?.day).toBe('2026-09-30')
    expect((await m.getReviewBanner(0, now))?.day).toBe('2026-09-29')
    expect(await queueIds(m, now, -300)).toEqual([id])
    const v = await m.ideaSnooze(id, 1, 120, at(1, 21) + 30 * MIN)
    expect(v.snoozedUntilDay).toBe('2026-09-30')
    expect(await queueIds(m, at(1, 22) + 30 * MIN, 120)).toEqual([id])
    expect(await queueIds(m, at(1, 21), 120)).toEqual([])
  })
})

describe('constat : idées clôturées', () => {
  it('compte par résultat ; taux seulement à partir de 5 idées clôturées', async () => {
    const m = make()
    const close = async (o: 'worked' | 'invalidated' | 'noFollowUp', day: number) => m.ideaClose(await idOfIdea(m, 0), o, null, 0, at(day, 12))
    expect((await m.ideaOutcomes(null, null)).successRate).toBeNull()
    for (const o of ['worked', 'worked', 'invalidated', 'noFollowUp'] as const) await close(o, 1)
    const four = m.ideaOutcomes(null, null)
    expect([four.worked, four.invalidated, four.noFollowUp, four.closedCount, four.successRate]).toEqual([2, 1, 1, 4, null])
    await close('worked', 2)
    const five = m.ideaOutcomes(null, null)
    expect([five.closedCount, five.successRate]).toEqual([5, 0.75])
    expect(m.ideaOutcomes(at(1, 0), at(2, 0)).closedCount).toBe(4)
    expect(m.ideaOutcomes(at(2, 13), null).closedCount).toBe(0)
    expect(m.ideaOutcomes(at(1, 0), at(2, 12)).closedCount).toBe(4)
    const only = make()
    for (let i = 0; i < 5; i++) await only.ideaClose(await idOfIdea(only, 0), 'noFollowUp', null, 0, at(1, 12))
    expect(only.ideaOutcomes(null, null).successRate).toBeNull()
    await idOfIdea(m, 0)
    expect(m.ideaOutcomes(null, null).activeCount).toBe(1)
  })
})

describe('liens avec les trades', () => {
  it('remplacés en bloc, conservés à la clôture, supprimés avec le trade', async () => {
    const m = make()
    const i1 = await idOfIdea(m, 0)
    const i2 = await idOfIdea(m, 0)
    const a = await m.createAnalysis(await analysis(m, MON))
    expect((await m.setTradeLinks(1, [i1, i2, i1], [a.id])).ideas).toHaveLength(2)
    expect((await m.setTradeLinks(1, [i2], [])).ideas.map((i) => i.id)).toEqual([i2])
    await expect(m.setTradeLinks(1, [9999], [])).rejects.toThrow()
    await expect(m.setTradeLinks(9999, [], [])).rejects.toThrow()
    expect((await m.getTradeLinks(1)).ideas).toHaveLength(1)
    await m.setTradeLinks(1, [i1], [a.id])
    await m.ideaClose(i1, 'worked', null, 0, MON + DAY)
    const l = await m.getTradeLinks(1)
    expect([l.ideas[0].status, l.ideas[0].outcome]).toEqual(['closed', 'worked'])
    m.dropTradeLinks(1)
    expect(await m.getTradeLinks(1)).toEqual({ ideas: [], analyses: [] })
    expect(await m.listIdeas('active', null, 0, MON + DAY)).toHaveLength(1)
    expect(await m.listAnalysesOfDay(a.day)).toHaveLength(1)
  })

  it('supprimer une analyse ou une idée retire ses liens, pas le trade', async () => {
    const m = make()
    const idea1 = await idOfIdea(m, 0)
    await m.ideaComplete(idea1, 'Complément', 0, at(1, 9))
    const a = await m.createAnalysis(await analysis(m, MON))
    await m.setTradeLinks(1, [idea1], [a.id])
    await m.deleteAnalysis(a.id)
    await m.ideaDelete(idea1, 0)
    expect(await m.getTradeLinks(1)).toEqual({ ideas: [], analyses: [] })
  })
})

describe('alerte « sans analyse »', () => {
  const trade = (id: number, entry: number) => ({ id, accountId: 1, entryTime: entry, tzOffsetMin: 0 })
  const entry = at(1, 9)
  const now = at(1, 12)
  it('éteinte par défaut ; se déclenche pour un trade avant toute analyse du jour', () => {
    expect(noAnalysisAlerts([trade(1, entry)], [], now, 0, false)).toEqual([])
    const alerts = noAnalysisAlerts([trade(1, entry)], [], now, 0, true)
    expect(alerts.map((a) => [a.id, a.tradeId, a.at])).toEqual([['noAnalysis:1:1', 1, entry]])
    expect(noAnalysisAlerts([trade(1, entry)], [entry - MIN], now, 0, true)).toEqual([])
    expect(noAnalysisAlerts([trade(1, entry)], [entry], now, 0, true)).toEqual([])
    expect(noAnalysisAlerts([trade(1, entry)], [entry + MIN], now, 0, true)).toHaveLength(1)
  })
  it('ne concerne que les trades entrés aujourd’hui (jour du PC)', () => {
    const trades = [trade(1, at(1, 9)), trade(2, at(2, 9))]
    expect(noAnalysisAlerts(trades, [], at(1, 12), 0, true).map((a) => a.tradeId)).toEqual([1])
    expect(noAnalysisAlerts(trades, [], at(2, 12), 0, true).map((a) => a.tradeId)).toEqual([2])
    expect(noAnalysisAlerts(trades, [], at(1, 23) + 30 * MIN, 120, true)).toEqual([])
  })
  it('le réglage vient du faux backend', async () => {
    const m = make()
    expect(m.noAnalysisEnabled()).toBe(false)
    await m.setAnalysisSettings({ staleDays: 7, noAnalysisAlert: true })
    expect(m.noAnalysisEnabled()).toBe(true)
  })
})
