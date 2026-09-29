import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { Comparison } from '../types/behavior'
import type { Insight, InsightHalf } from '../types/insights'
import type { Summary } from '../types/stats'
import { groupInsights, insightEvidence, insightHint, insightMessage, insightNotCausal, insightPeriod, isNewInsight, reportLink, unseenCount } from './insightsView'

const t = fr
const half = (n: number): InsightHalf => ({ tradeCount: n, valueCount: n, from: 0, to: 0, tradeIds: [] })
const base = {
  id: 'x', situation: 'x', level: 1, episode: 1, accountId: 1, currency: 'USD', tradeIds: [], filter: null, firstSeenAt: 100, dismissedAt: null,
  period: { basis: 'lastTrades' as const, from: null, to: null, tradeCount: 20, days: null },
}
const make = (over: Record<string, unknown>): Insight => ({ ...base, ...over }) as unknown as Insight
const summary = (over: Partial<Summary>) => ({ tradeCount: 12, rTradeCount: 12, expectancyR: 0.5, ...over }) as Summary
/** Les formats français utilisent des espaces insécables : on les ramène à des espaces simples pour comparer. */
const text = (i: Insight) => insightMessage(t, i).replace(/[\u00a0\u202f]/g, ' ')
const cmp = (verdict: Comparison['verdict'], difference: number | null): Comparison => ({ present: null, absent: null, difference, verdict })

describe('phrases des insights : valeurs formatées par l’interface', () => {
  it('risque : pourcentages depuis les fractions, variation signée', () => {
    const up = make({ kind: 'riskDrift', messageKey: 'riskDrift.up', direction: 'up', olderAvgRiskPct: 0.01, recentAvgRiskPct: 0.0123, change: 0.23, recent: half(10), older: half(10) })
    expect(text(up)).toBe('Votre risque moyen par trade est passé de 1,00 % à 1,23 % du capital (+23 %) : vos 10 trades les plus récents contre les 10 précédents.')
    const down = make({ ...up, messageKey: 'riskDrift.down', direction: 'down', recentAvgRiskPct: 0.0075, change: -0.25 })
    expect(text(down)).toContain('de 1,00 % à 0,75 % du capital (−25 %)')
  })

  it('discipline, plan, règle, frais (montants sans flottant)', () => {
    const d = make({ kind: 'disciplineTrend', messageKey: 'disciplineTrend.down', direction: 'down', olderScore: 82.4, recentScore: 67.5, recent: half(10) })
    expect(text(d)).toBe('Votre score de discipline moyen est passé de 82/100 à 68/100 sur vos 10 trades les plus récents, par rapport aux 10 précédents.')
    const p = make({ kind: 'planDrop', messageKey: 'planDrop', olderRate: 1, recentRate: 0.75, recent: half(10) })
    expect(text(p)).toContain('passé de 100 % à 75 %')
    const r = make({ kind: 'ruleAdherenceDrop', messageKey: 'ruleAdherenceDrop', text: 'Pas de trade après 16h', trend: -0.6667, checks: 12 })
    expect(text(r)).toContain('« Pas de trade après 16h » est moins souvent respectée : −67 pts')
    const f = make({ kind: 'feesUp', messageKey: 'feesUp', olderAvgFees: '2', recentAvgFees: '2.5', change: 0.25, recent: half(10) })
    expect(text(f)).toBe('Vos frais moyens par trade sont passés de 2,00 $ à 2,50 $ (+25 %) sur vos 10 trades les plus récents.')
    // Devise de l'insight ; depuis le lot 26 l'affichage est arrondi au centime, sur la chaîne (12345.678 → 12 345,68), jamais par un flottant.
    expect(text(make({ ...f, currency: 'EUR', olderAvgFees: '0.1', recentAvgFees: '12345.678' }))).toContain('de 0,10 € à 12 345,68 €')
  })

  it('taille après une perte, revanche (signe du résultat), surtrading', () => {
    const s = make({ kind: 'sizeUpAfterLoss', messageKey: 'sizeUpAfterLoss', afterLossMean: 0.3, afterWinMean: -0.05, afterLossCases: 7 })
    expect(text(s)).toBe('Après une perte, votre exposition au trade suivant varie en moyenne de +30 % (7 cas), contre −5 % après un gain.')
    const rev = make({ kind: 'revengePattern', messageKey: 'revengePattern', count: 3, netPnl: '-412.5' })
    expect(text(rev)).toContain('3 trades de revanche')
    expect(text(rev)).toContain('résultat net de −412,50 $')
    expect(text(make({ ...rev, netPnl: '80' }))).toContain('de +80,00 $')
    const o = make({ kind: 'overtradingPattern', messageKey: 'overtradingPattern', dayCount: 2, limit: 1 })
    expect(text(o)).toBe('2 jours au-dessus de votre limite de 1 trade par jour ces 90 derniers jours.')
  })

  it('erreur coûteuse : coût affiché comme une perte, part des pertes', () => {
    const m = make({ kind: 'costlyMistake', messageKey: 'costlyMistake.tag', mistakeSource: 'tag', label: 'FOMO', tradeCount: 4, cost: '1620', shareOfLosses: 0.4321 })
    expect(text(m)).toBe('L’erreur « FOMO » apparaît sur 4 trades ces 90 derniers jours ; ces trades totalisent −1 620,00 $ de pertes, soit 43 % de vos pertes.')
    const rule = make({ ...m, messageKey: 'costlyMistake.rule', mistakeSource: 'rule', label: 'Stop obligatoire' })
    expect(text(rule)).toContain('La règle « Stop obligatoire » a été notée non respectée sur 4 trades')
    // Valeur manquante : « — », jamais 0.
    expect(text(make({ ...m, shareOfLosses: null }))).toContain('soit — de vos pertes')
  })

  it('émotion et segments : R avec signe, valeur manquante « — »', () => {
    const e = make({ kind: 'emotionLower', messageKey: 'emotionLower', name: 'Stress', group: summary({ tradeCount: 6, expectancyR: -0.4 }), others: summary({ expectancyR: 0.35 }) })
    expect(text(e)).toBe('Les 6 trades où vous avez déclaré « Stress » avant d’entrer ont en même temps une expectancy de −0,40 R, contre +0,35 R pour vos autres trades.')
    expect(text(make({ ...e, others: summary({ expectancyR: null }) }))).toContain('contre — pour')
    const best = make({ kind: 'bestSegment', messageKey: 'bestSegment.setup', dimension: 'setup', name: 'Breakout', summary: summary({ rTradeCount: 14, expectancyR: 0.8 }), baselineExpectancyR: 0.2 })
    expect(text(best)).toBe('Votre setup « Breakout » se détache : expectancy de +0,80 R sur 14 trades, contre +0,20 R pour l’ensemble de vos trades.')
    const weak = make({ ...best, kind: 'weakSegment', messageKey: 'weakSegment.session', dimension: 'session', name: 'Londres', summary: summary({ rTradeCount: 11, expectancyR: -0.3 }), baselineExpectancyR: 0.1 })
    expect(text(weak)).toBe('La session « Londres » est en retrait : expectancy de −0,30 R sur 11 trades, contre +0,10 R pour l’ensemble de vos trades.')
  })

  it('facteur externe : composé selon les verdicts « lower »', () => {
    const f = make({ kind: 'factorLower', messageKey: 'factorLower', factor: 'poorSleep', discipline: cmp('lower', -14.2), expectancyR: cmp('lower', -0.42) })
    expect(text(f)).toBe(
      'Les jours de mauvais sommeil, votre discipline était plus basse de 14 points et votre expectancy était plus basse de 0,42 R (constat sur les mêmes jours, pas une cause).',
    )
    const onlyDiscipline = make({ ...f, factor: 'lowMood', expectancyR: cmp('similar', -0.05) })
    expect(text(onlyDiscipline)).toBe('Les jours d’humeur basse, votre discipline était plus basse de 14 points (constat sur les mêmes jours, pas une cause).')
    const onlyExpectancy = make({ ...f, factor: 'highFatigue', discipline: cmp('notEnoughData', null) })
    expect(text(onlyExpectancy)).toContain('Les jours de forte fatigue, votre expectancy était plus basse de 0,42 R')
    expect(text(onlyExpectancy)).not.toContain('discipline')
    // 1 point au singulier ; verdict « lower » sans valeur : ignoré plutôt que d’inventer un chiffre.
    expect(text(make({ ...f, discipline: cmp('lower', -1), expectancyR: cmp('lower', null) }))).toContain('plus basse de 1 point ')
    // Aucun verdict « lower » (ne devrait pas arriver) : phrase sobre, pas de « undefined ».
    expect(text(make({ ...f, discipline: cmp('similar', 0), expectancyR: cmp('similar', 0) }))).toBe(t.insights.factorUnknown('de mauvais sommeil'))
  })

  it('aucune phrase ne contient undefined, NaN ou null', () => {
    const all = [
      make({ kind: 'planDrop', messageKey: 'planDrop', olderRate: 0.9, recentRate: 0.4, recent: half(10) }),
      make({ kind: 'feesUp', messageKey: 'feesUp', olderAvgFees: '1', recentAvgFees: '2', change: 1, recent: half(10), currency: null }),
    ]
    for (const i of all) expect(text(i)).not.toMatch(/undefined|NaN|null/)
  })
})

describe('piste, phrase « pas une cause », fenêtre', () => {
  it('piste par clé quand elle existe, « pas une cause » sur les suggestions seulement', () => {
    const s = make({ kind: 'costlyMistake', messageKey: 'costlyMistake.tag', category: 'suggestion' })
    expect(insightHint(t, s)).toBe(t.insights.suggestions['costlyMistake.tag'])
    expect(insightNotCausal(t, s)).toBe(t.insights.notCausal)
    const b = make({ kind: 'bestSegment', messageKey: 'bestSegment.setup', category: 'highlight' })
    expect(insightHint(t, b)).toBeNull()
    expect(insightNotCausal(t, b)).toBeNull()
    expect(insightNotCausal(t, make({ category: 'trend' }))).toBeNull()
  })

  it('période : derniers trades ou jours, avec bornes si connues', () => {
    expect(insightPeriod(t, make({}))).toBe('Sur vos 20 trades les plus récents')
    expect(insightPeriod(t, make({ period: { basis: 'lastTrades', from: null, to: null, tradeCount: 1, days: null } }))).toBe('Sur vos 1 trade les plus récents')
    const days = insightPeriod(t, make({ period: { basis: 'days', from: Date.UTC(2026, 6, 1, 12), to: Date.UTC(2026, 8, 28, 12), tradeCount: 30, days: 90 } }))
    expect(days).toMatch(/^Sur les 90 derniers jours · du 1 juil\. 2026 au 28 sept\. 2026$/)
    expect(insightPeriod(t, make({ period: { basis: 'days', from: null, to: null, tradeCount: 3, days: null } }))).toBe('Sur les 90 derniers jours')
  })
})

describe('liens de preuve', () => {
  it('filtre erreur / setup vers /trades, sinon les trades en cause (limités), toujours le rapport', () => {
    expect(insightEvidence(make({ filter: { kind: 'mistake', source: 'tag', id: 12 }, source: 'mistakes', tradeIds: [1, 2] }))).toEqual({
      filterTo: '/trades?mistake=tag:12', tradeIds: [], reportTo: '/behavior',
    })
    expect(insightEvidence(make({ filter: { kind: 'mistake', source: 'rule', id: 3 }, source: 'ruleAdherence' })).filterTo).toBe('/trades?mistake=rule:3')
    expect(insightEvidence(make({ filter: { kind: 'setup', tagId: 7 }, source: 'segments' }))).toMatchObject({ filterTo: '/trades?setup=7', reportTo: '/analytics?tab=strategies' })
    // Jusqu'à 5 trades en cause : liens directs. Au-delà (une fenêtre entière), le rapport lié est la preuve.
    expect(insightEvidence(make({ filter: null, source: 'patterns', tradeIds: [4, 9] }))).toEqual({ filterTo: null, tradeIds: [4, 9], reportTo: '/behavior' })
    expect(insightEvidence(make({ filter: null, source: 'discipline', tradeIds: [1, 2, 3, 4, 5] })).tradeIds).toEqual([1, 2, 3, 4, 5])
    expect(insightEvidence(make({ filter: null, source: 'discipline', tradeIds: [1, 2, 3, 4, 5, 6] }))).toEqual({ filterTo: null, tradeIds: [], reportTo: '/discipline' })
    expect(insightEvidence(make({ filter: null, source: 'patterns', tradeIds: [] }))).toEqual({ filterTo: null, tradeIds: [], reportTo: '/behavior' })
  })

  it('page du rapport selon la source', () => {
    expect(reportLink('risk')).toBe('/analytics?tab=scaling')
    expect(reportLink('fees')).toBe('/analytics?tab=fees')
    expect(reportLink('discipline')).toBe('/discipline')
    for (const s of ['ruleAdherence', 'mistakes', 'emotions', 'sizeChange', 'patterns', 'externalFactors'] as const) expect(reportLink(s)).toBe('/behavior')
  })
})

describe('regroupement et ordre', () => {
  it('tendances, mises en avant, suggestions ; ordre du moteur conservé dans chaque groupe ; groupes vides omis', () => {
    const list = [
      make({ id: 'a', category: 'trend' }),
      make({ id: 'b', category: 'suggestion' }),
      make({ id: 'c', category: 'highlight' }),
      make({ id: 'd', category: 'trend' }),
      make({ id: 'e', category: 'suggestion' }),
    ]
    expect(groupInsights(list).map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ['trend', ['a', 'd']],
      ['highlight', ['c']],
      ['suggestion', ['b', 'e']],
    ])
    expect(groupInsights(list.filter((i) => i.category !== 'highlight')).map((g) => g.category)).toEqual(['trend', 'suggestion'])
    expect(groupInsights([])).toEqual([])
  })

  it('priorités affichées en texte', () => {
    expect(t.insights.priorities).toEqual({ high: 'Important', medium: 'À regarder', low: 'Pour information' })
  })
})

describe('repère « nouveau » (firstSeenAt)', () => {
  const at = (firstSeenAt: number | null, dismissedAt: number | null = null) => ({ firstSeenAt, dismissedAt })
  it('nouveau = apparu après la dernière visite ; un insight masqué n’est jamais nouveau', () => {
    expect(isNewInsight(at(200), 100)).toBe(true)
    expect(isNewInsight(at(100), 100)).toBe(false)
    expect(isNewInsight(at(50), 100)).toBe(false)
    expect(isNewInsight(at(null), 100)).toBe(true)
    expect(isNewInsight(at(200, 250), 100)).toBe(false)
  })
  it('compteur de la barre latérale', () => {
    expect(unseenCount([at(50), at(150), at(300), at(400, 500)], 100)).toBe(2)
    expect(unseenCount([], 0)).toBe(0)
    expect(unseenCount([at(1), at(2)], 0)).toBe(2)
  })
})
