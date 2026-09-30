import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { Analysis, IdeaNote, IdeaView, LinkedComparison, Question } from '../types/analysis'
import type { Tag } from '../types/trade'
import {
  analysisSummary,
  analysisTexts,
  comparisonLines,
  dayOfInstant,
  draftAnswers,
  draftOf,
  formatDayLong,
  formatDayShort,
  formatTimeOfDay,
  hasAnswer,
  ideaSections,
  instantOf,
  isBlank,
  levelsInOrder,
  parseTimeInput,
  questionLabel,
  showSnoozeCount,
  snoozeDays,
  threadLine,
  trendLines,
  validLevel,
  type Names,
} from './analysisView'

const t = fr.analysis
const names: Names = { questions: t.questions, timeframes: t.timeframes, trends: t.trends, conviction: t.convictionValue }
const q = (id: number, key: string, kind: Question['kind'], extra: Partial<Question> = {}): Question => ({ id, key, label: null, kind, position: id, archived: false, options: {}, ...extra })
const questions = [q(1, 'trend', 'trend', { options: { timeframes: ['weekly', 'daily'] } }), q(2, 'levels', 'longText'), q(3, 'conviction', 'conviction'), q(4, 'setups', 'setups'), q(5, 'state', 'emotions')]
const tags: Tag[] = [
  { id: 10, kind: 'setup', name: 'Breakout', archived: false },
  { id: 11, kind: 'emotion', name: 'Calme', archived: false },
]

describe('libellés de questions', () => {
  it('libellé saisi, sinon libellé d’origine traduit, sinon la clé', () => {
    expect(questionLabel(q(1, 'levels', 'longText'), t.questions)).toContain('Niveaux importants')
    expect(questionLabel(q(1, 'levels', 'longText', { label: 'Mes zones' }), t.questions)).toBe('Mes zones')
    expect(questionLabel(q(9, 'custom_9', 'shortText'), t.questions)).toBe('custom_9')
  })
  it('chaque question d’origine a un texte français', () => {
    for (const key of ['trend', 'levels', 'news', 'alts', 'scenarioMain', 'scenarioAlt', 'invalidation', 'assets', 'setups', 'conviction', 'riskLimits', 'state', 'mistakeToAvoid']) {
      expect(t.questions[key], key).toBeTruthy()
    }
  })
})

describe('brouillon', () => {
  it('une réponse vide n’est jamais envoyée comme une valeur (ni 0, ni valeur par défaut)', () => {
    for (const blank of [undefined, null, '', '   ', [], { tagIds: [], text: '' }, { note: '  ' }, { weekly: { trend: null, note: '' } }]) expect(isBlank(blank as never)).toBe(true)
    for (const full of ['x', 0, [1], { tagIds: [1], text: null }, { text: 'fatigué', tagIds: [] }, { note: 'a' }, { daily: { trend: 'up', note: null } }]) expect(isBlank(full as never)).toBe(false)
  })
  it('hasAnswer ignore les questions archivées ; draftAnswers ne les envoie jamais', () => {
    const list = [q(1, 'levels', 'longText'), q(2, 'alts', 'longText', { archived: true })]
    expect(hasAnswer(list, { 2: 'x' })).toBe(false)
    expect(hasAnswer(list, { 1: 'x' })).toBe(true)
    expect(draftAnswers(list, { 1: '  ', 2: 'x' })).toEqual([{ questionId: 1, value: null }])
    expect(draftAnswers(list, { 1: 'ok' })).toEqual([{ questionId: 1, value: 'ok' }])
  })
  it('draftOf relit une analyse', () => {
    const a = { answers: [{ questionId: 1, value: 'x' }, { questionId: 3, value: 7 }] } as Analysis
    expect(draftOf(a)).toEqual({ 1: 'x', 3: 7 })
  })
})

describe('heure et jour', () => {
  it('formate l’heure locale avec le décalage donné', () => {
    const ms = Date.UTC(2026, 8, 29, 7, 5)
    expect(formatTimeOfDay(ms, 0)).toBe('07:05')
    expect(formatTimeOfDay(ms, 120)).toBe('09:05')
    expect(formatTimeOfDay(ms, -420)).toBe('00:05')
    expect(formatTimeOfDay(Date.UTC(2026, 8, 29, 23, 30), 120)).toBe('01:30')
  })
  it('lit une heure saisie à la française', () => {
    expect(parseTimeInput('9:30')).toBe(570)
    expect(parseTimeInput('09h30')).toBe(570)
    expect(parseTimeInput('0930')).toBe(570)
    expect(parseTimeInput('9')).toBe(540)
    expect(parseTimeInput('9h')).toBe(540)
    expect(parseTimeInput('23:59')).toBe(1439)
    for (const bad of ['', '24:00', '9:60', 'abc', '9:5', '12:30:10']) expect(parseTimeInput(bad), bad).toBeNull()
  })
  it('instantOf et dayOfInstant sont l’un l’inverse de l’autre', () => {
    const ms = instantOf('2026-09-29', 9 * 60 + 30, 120)
    expect(ms).toBe(Date.UTC(2026, 8, 29, 7, 30))
    expect(dayOfInstant(ms, 120)).toBe('2026-09-29')
    expect(formatTimeOfDay(ms, 120)).toBe('09:30')
    expect(dayOfInstant(Date.UTC(2026, 8, 28, 23, 30), 120)).toBe('2026-09-29')
  })
  it('écrit les jours en français', () => {
    expect(formatDayLong('2026-09-29')).toBe('mardi 29 septembre 2026')
    expect(formatDayShort('2026-10-02')).toBe('vendredi 2 octobre')
  })
})

describe('lecture des réponses', () => {
  const a: Analysis = {
    id: 1, createdAt: 0, tzOffsetMin: 0, day: '2026-09-29', updatedAt: 0, note: null,
    answers: [
      { questionId: 5, value: { text: 'Fatigué', tagIds: [11] } },
      { questionId: 1, value: { daily: { trend: 'up', note: 'au-dessus de la 200' }, weekly: { trend: 'range', note: null }, h4: { trend: null, note: null } } },
      { questionId: 3, value: 7 },
      { questionId: 4, value: [10] },
      { questionId: 2, value: 'Zone 4 250' },
    ],
  }
  it('trendLines suit l’ordre des unités de temps', () => {
    expect(trendLines((a.answers[1].value as never), names)).toEqual(['Hebdomadaire : Range', 'Journalière : Haussière — au-dessus de la 200'])
  })
  it('analysisTexts lit tout dans l’ordre des questions, par leur nom', () => {
    const texts = analysisTexts(a, questions, names, tags)
    expect(texts.map((x) => x.lines.join('|'))).toEqual(['Hebdomadaire : Range|Journalière : Haussière — au-dessus de la 200', 'Zone 4 250', '7 sur 10', 'Breakout', 'Fatigué|Calme'])
  })
  it('une question archivée reste lisible et signalée', () => {
    const archived = questions.map((x) => (x.id === 2 ? { ...x, archived: true } : x))
    const levels = analysisTexts(a, archived, names, tags).find((x) => x.lines[0] === 'Zone 4 250')
    expect(levels?.archived).toBe(true)
  })
  it('le résumé court garde les 3 premières réponses, une ligne chacune', () => {
    const s = analysisSummary(a, questions, names, tags)
    expect(s).toHaveLength(3)
    expect(s[0].lines).toEqual(['Hebdomadaire : Range · Journalière : Haussière — au-dessus de la 200'])
  })
  it('un setup ou une émotion inconnus s’affichent par leur numéro, sans planter', () => {
    const b: Analysis = { ...a, answers: [{ questionId: 4, value: [99] }] }
    expect(analysisTexts(b, questions, names, tags)[0].lines).toEqual(['#99'])
  })
})

describe('report', () => {
  it('choix rapides et nombre libre : entiers de 1 à 30', () => {
    expect(snoozeDays('1', '')).toBe(1)
    expect(snoozeDays('7', '')).toBe(7)
    expect(snoozeDays('custom', ' 30 ')).toBe(30)
    expect(snoozeDays('custom', '1')).toBe(1)
    for (const bad of ['', '0', '31', '1.5', '-2', 'abc', '1e1', '007x']) expect(snoozeDays('custom', bad), bad).toBeNull()
  })
  it('« reportée N fois » seulement à partir de 2', () => {
    expect([0, 1, 2, 5].map(showSnoozeCount)).toEqual([false, false, true, true])
  })
  it('les textes du report sont neutres', () => {
    expect(t.ideas.snoozedTimes(3)).toBe('reportée 3 fois')
    expect(t.ideas.returnsOn('mardi 29 septembre')).toBe('Revient le mardi 29 septembre')
    expect(t.ideas.staleMention(9)).toBe('Cette idée date de 9 jours, toujours d’actualité\u00a0?')
  })
})

describe('niveaux', () => {
  it('valide des chiffres avec un point, sans espace ni exposant', () => {
    for (const ok of ['', ' ', '0.1850', '4250', '4 250'.replace(' ', '')]) expect(validLevel(ok), ok).toBe(true)
    for (const bad of ['0', '0.0', '1e5', '1,5', '4 250', '-1', 'abc', '.5']) expect(validLevel(bad), bad).toBe(false)
  })
  it('compare le bas et le haut sans flottant', () => {
    expect(levelsInOrder('0.1850', '0.19')).toBe(true)
    expect(levelsInOrder('0.19', '0.1850')).toBe(false)
    expect(levelsInOrder('2', '2.0')).toBe(true)
    expect(levelsInOrder('', '2')).toBe(true)
    expect(levelsInOrder('10', '9.99')).toBe(false)
  })
})

describe('idées', () => {
  const v = (id: number, extra: Partial<IdeaView> = {}): IdeaView => ({ id, snoozed: false, snoozedUntilDay: null, ...extra }) as IdeaView
  it('la revue du matin garde ses idées à part ; les reportées ont leur section, triées par jour de retour', () => {
    const list = [v(1), v(2), v(3, { snoozed: true, snoozedUntilDay: '2026-10-05' }), v(4, { snoozed: true, snoozedUntilDay: '2026-10-02' })]
    const s = ideaSections(list, new Set([1]))
    expect(s.active.map((x) => x.id)).toEqual([2])
    expect(s.snoozed.map((x) => x.id)).toEqual([4, 3])
  })
  it('le fil se lit dans l’ordre, reports et clôtures en une phrase', () => {
    const labels = { thread: t.ideas.thread, snooze: t.ideas.threadSnooze, closed: t.ideas.threadClosed, outcomes: t.ideas.outcomes }
    const n = (kind: IdeaNote['kind'], body: string, data: string | null = null): IdeaNote => ({ id: 1, createdAt: 0, kind, body, data })
    expect(threadLine(n('created', 'ALGO'), labels)).toEqual({ title: 'Idée créée', body: 'ALGO' })
    expect(threadLine(n('snooze', '', '2026-10-02'), labels)).toEqual({ title: 'Reportée jusqu’au vendredi 2 octobre', body: '' })
    expect(threadLine(n('closed', 'cible', 'worked'), labels)).toEqual({ title: 'Clôturée : Ça a fonctionné', body: 'cible' })
  })
})

describe('constat', () => {
  const cmp = (verdict: 'lower' | 'similar' | 'higher' | 'notEnoughData', present: number | null, absent: number | null, difference: number | null) => ({ verdict, present, absent, difference })
  const base = { linked: { tradeCount: 6, disciplineScore: 80, expectancyR: 0.5, rTradeCount: 6 }, unlinked: { tradeCount: 7, disciplineScore: 70, expectancyR: 0.2, rTradeCount: 7 }, minTradeCount: 5 }
  it('affiche les écarts donnés par pulse-core, sans les recalculer', () => {
    const c: LinkedComparison = { ...base, discipline: cmp('higher', 80, 70, 10), expectancyR: cmp('higher', 0.5, 0.2, 0.3) }
    const [d, e] = comparisonLines(c)
    expect([d.verdict, d.gap, d.values]).toEqual(['higher', '+10\u00a0points', ['80', '70']])
    expect([e.verdict, e.gap, e.values]).toEqual(['higher', '+0,30\u00a0R', ['+0,50\u00a0R', '+0,20\u00a0R']])
  })
  it('sans échantillon : pas d’écart ni de valeurs', () => {
    const c: LinkedComparison = { ...base, discipline: cmp('notEnoughData', null, null, null), expectancyR: cmp('notEnoughData', null, 0.2, null) }
    const [d, e] = comparisonLines(c)
    expect([d.gap, d.values, e.gap, e.values]).toEqual([null, null, null, null])
  })
  it('un écart négatif porte le vrai signe moins', () => {
    const c: LinkedComparison = { ...base, discipline: cmp('lower', 60, 75, -15), expectancyR: cmp('lower', -0.1, 0.2, -0.3) }
    expect(comparisonLines(c)[0].gap).toBe('−15\u00a0points')
    expect(comparisonLines(c)[1].gap).toBe('−0,30\u00a0R')
  })
  it('les verdicts ne parlent jamais de cause', () => {
    const r = t.report.verdict
    for (const text of [r.lower('Score', '−15'), r.similar('Score'), r.higher('Score', '+10'), r.notEnoughData('Score')]) {
      expect(text).toContain('Score')
      expect(text).not.toMatch(/parce que|à cause|grâce/)
    }
    expect(r.higher('Score', '+10')).toContain('en même temps')
  })
})

describe('liens avec un trade', () => {
  it('idées actives de l’actif d’abord, puis celles déjà liées (clôturées ou d’un autre actif) : jamais perdues', async () => {
    const { linkableIdeas } = await import('./analysisView')
    const list = linkableIdeas(
      [{ id: 1, symbol: 'ALGO', note: 'a' }, { id: 2, symbol: 'ALGO', note: 'b' }],
      [{ id: 2, symbol: 'ALGO', note: 'b', status: 'active' }, { id: 7, symbol: 'BTC', note: 'c', status: 'closed' }, { id: 8, symbol: 'ETH', note: 'd', status: 'active' }],
    )
    expect(list.map((i) => [i.id, i.source, i.closed])).toEqual([[1, 'active', false], [2, 'active', false], [7, 'linked', true], [8, 'linked', false]])
  })
  it('coche et décoche sans doublon', async () => {
    const { toggleId } = await import('./analysisView')
    expect(toggleId([1, 2], 3, true)).toEqual([1, 2, 3])
    expect(toggleId([1, 2], 2, true)).toEqual([1, 2])
    expect(toggleId([1, 2], 1, false)).toEqual([2])
    expect(toggleId([], 1, false)).toEqual([])
  })
  it('coupe un texte long à un mot', async () => {
    const { snippet } = await import('./analysisView')
    expect(snippet('court')).toBe('court')
    expect(snippet('un   texte\n\tavec des espaces')).toBe('un texte avec des espaces')
    const long = 'mot '.repeat(40)
    const s = snippet(long, 30)
    expect(s.endsWith('…') && [...s].length <= 31 && !s.includes('mo…')).toBe(true)
  })
})
