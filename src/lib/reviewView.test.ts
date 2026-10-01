import { describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { WeeklyReview } from '../types/review'
import { canAddIntention, draftOf, emptyDraft, errorCode, errorText, isBlankDraft, outcomeLook, reasonText, sameDraft, shortDate, stateLook, toInput, weekNumber } from './reviewView'

const review = (over: Partial<WeeklyReview> = {}): WeeklyReview => ({
  id: 1, periodKey: '2026-W38', firstDay: '2026-09-14', lastDay: '2026-09-20', createdAt: 0, updatedAt: 0, completedAt: null, state: 'draft',
  answers: { wentWell: 'Mes stops', doDifferently: '', nextPriority: '' },
  intentions: [{ id: 1, position: 1, text: 'Un stop partout', outcome: null }], ...over,
})

describe('brouillon du bilan', () => {
  it('un brouillon vide a un champ d’intention et est « vide » ; une espace seule ne compte pas', () => {
    expect(emptyDraft().intentions).toEqual([''])
    expect(isBlankDraft(emptyDraft())).toBe(true)
    expect(isBlankDraft({ answers: { wentWell: ' \n ', doDifferently: '', nextPriority: '' }, intentions: ['  '] })).toBe(true)
    expect(isBlankDraft(draftOf(review()))).toBe(false)
  })
  it('reprend le bilan enregistré et prévoit un champ quand il n’a pas d’intention', () => {
    expect(draftOf(review()).intentions).toEqual(['Un stop partout'])
    expect(draftOf(review({ intentions: [] })).intentions).toEqual([''])
    expect(draftOf(null)).toEqual(emptyDraft())
  })
  it('compare sans tenir compte des espaces autour ni des intentions vides', () => {
    const saved = draftOf(review())
    expect(sameDraft(saved, { ...saved, intentions: ['  Un stop partout ', ''] })).toBe(true)
    expect(sameDraft(saved, { ...saved, answers: { ...saved.answers, wentWell: 'Autre' } })).toBe(false)
  })
  it('au plus trois champs d’intention', () => {
    expect(canAddIntention({ ...emptyDraft(), intentions: ['a', 'b'] })).toBe(true)
    expect(canAddIntention({ ...emptyDraft(), intentions: ['a', 'b', 'c'] })).toBe(false)
  })
  it('prépare l’envoi tel quel : pulse-core nettoie et valide', () => {
    expect(toInput('2026-W38', draftOf(review()))).toEqual({ periodKey: '2026-W38', answers: review().answers, intentions: ['Un stop partout'] })
  })
})

describe('mots et icônes', () => {
  it('chaque état et chaque suivi a un texte ET une icône (jamais la couleur seule)', () => {
    for (const s of ['todo', 'draft', 'done'] as const) expect([fr.review.states[s], stateLook(s).icon].every(Boolean)).toBe(true)
    for (const o of ['kept', 'partly', 'notKept'] as const) expect([fr.review.lastWeek.outcomes[o], outcomeLook(o).icon].every(Boolean)).toBe(true)
    expect(outcomeLook(null).icon).toBe('info')
  })
  it('« Pas tenue » n’est jamais rouge : aucun reproche', () => {
    expect(outcomeLook('notKept').badge).not.toMatch(/badge-(loss|bad)/)
  })
  it('chaque raison de fait manquant a un texte ; « pas assez de trades » donne les chiffres', () => {
    for (const r of ['noClosedTrade', 'noRTrade', 'notEnoughTrades', 'noGoals', 'noMistake', 'notEnoughMistakeTrades', 'noMistakeCost', 'onlyCurrentWeek'] as const) {
      expect(reasonText(fr.review, r, { scoredTradeCount: 4, minScoredTradeCount: 5 }), r).not.toBe('')
    }
    expect(reasonText(fr.review, 'notEnoughTrades', { scoredTradeCount: 4, minScoredTradeCount: 5 })).toContain('4 sur 5')
    expect(reasonText(fr.review, null, { scoredTradeCount: 0, minScoredTradeCount: 5 })).toBe('')
  })
})

describe('erreurs et dates', () => {
  it('traduit les codes de pulse-core, laisse passer le reste', () => {
    expect(errorCode('invalid input: review:empty')).toBe('empty')
    expect(errorCode('invalid input: review:inconnu')).toBeNull()
    expect(errorText(fr.review, new Error('invalid input: review:future'), fr.review.saveError)).toBe(fr.review.errors.future)
    expect(errorText(fr.review, new Error('invalid input: boum'), fr.review.saveError)).toBe(fr.review.saveError('boum'))
  })
  it('numéro de semaine et date courte', () => {
    expect(weekNumber('2026-W05')).toBe(5)
    expect(shortDate('2026-09-14')).toMatch(/14\s+sept/)
    expect(shortDate('2026-12-28', true)).toMatch(/2026/)
  })
})
