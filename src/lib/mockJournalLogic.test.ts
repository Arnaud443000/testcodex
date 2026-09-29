import { describe, expect, it } from 'vitest'
import { bucketOf, isBlankEntry, mockExecutionScore, pearson } from './mockJournalLogic'

const base = { checklist: [], planFollowed: null, ruleChecks: [], executionQuality: null }

describe('mockExecutionScore (même barème que pulse-core)', () => {
  it('moyenne les composantes disponibles', () => {
    const s = mockExecutionScore({
      checklist: [true, true, true, false].map((checked) => ({ itemId: null, label: 'x', checked })),
      planFollowed: 'partial',
      ruleChecks: [{ ruleId: 1, respected: true }, { ruleId: 2, respected: false }],
      executionQuality: null,
    })
    expect(s.components).toEqual({ checklist: 75, plan: 50, rules: 50 })
    expect(s.autoScore).toBeCloseTo(175 / 3)
    expect(s.grade).toBe('poor')
  })
  it('la note manuelle prime ; rien à évaluer donne null', () => {
    expect(mockExecutionScore({ ...base, planFollowed: 'yes', executionQuality: 2 })).toMatchObject({ score: 25, source: 'manual', grade: 'poor' })
    expect(mockExecutionScore({ ...base, executionQuality: 4 }).grade).toBe('good')
    expect(mockExecutionScore(base)).toMatchObject({ score: null, source: null, grade: null })
  })
})

describe('confiance', () => {
  it('groupes de conviction', () => {
    expect([1, 3, 4, 7, 8, 10].map(bucketOf)).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high'])
  })
  it('corrélation de Pearson : cas connus', () => {
    expect(pearson([[1, 2], [2, 1], [3, 4], [4, 3], [5, 5]])).toBeCloseTo(0.8)
    expect(pearson([[1, 1], [1, 2], [1, 3]])).toBeNull()
    expect(pearson([[1, 1], [2, 2]])).toBeNull()
  })
})

describe('journal', () => {
  it('un journal vide est détecté', () => {
    const blank = { day: '2026-09-29', lateHours: false, wentWell: ' ', toImprove: '', notes: '' }
    expect(isBlankEntry(blank)).toBe(true)
    expect(isBlankEntry({ ...blank, mood: 3 })).toBe(false)
    expect(isBlankEntry({ ...blank, lateHours: true })).toBe(false)
  })
})
