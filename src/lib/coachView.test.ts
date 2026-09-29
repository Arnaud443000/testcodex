import { describe, expect, it } from 'vitest'
import { canSend, coachBlocker, coachErrorMessage, isClosed, prettyJson, questionLength, toolLabel, turnErrorMessage } from './coachView'
import { fr } from '../i18n/fr'
import type { CoachStatus, CoachTurn } from '../types/coach'

const status = (over: Partial<CoachStatus> = {}): CoachStatus => ({
  enabled: true, vaultAvailable: true, keyStored: true, consentAt: null, model: 'claude-opus-5-5', provider: 'anthropic',
  providerHost: 'api.anthropic.com', limits: { maxQuestionChars: 2000, maxToolCalls: 8, maxRequests: 6, maxTurns: 20 }, tools: [], ...over,
})
const texts = { aiErrors: fr.ai.errors, coachErrors: fr.coach.errors, unknownError: fr.ai.unknownError }

describe('vue du coach', () => {
  it('dit ce qui empêche de poser une question, dans l’ordre', () => {
    expect(coachBlocker(status({ enabled: false, keyStored: false }))).toBe('disabled')
    expect(coachBlocker(status({ vaultAvailable: false }))).toBe('vault')
    expect(coachBlocker(status({ keyStored: false }))).toBe('noKey')
    expect(coachBlocker(status())).toBeNull()
  })
  it('n’autorise l’envoi que d’une question valide, jamais pendant un envoi', () => {
    const ok = { busy: false, blocked: false, closed: false }
    expect(questionLength('  é😀  ')).toBe(2)
    expect(canSend('Résume ma semaine', 2000, ok)).toBe(true)
    expect(canSend('   ', 2000, ok)).toBe(false)
    expect(canSend('x'.repeat(2001), 2000, ok)).toBe(false)
    expect(canSend('Q', 2000, { ...ok, busy: true })).toBe(false)
    expect(canSend('Q', 2000, { ...ok, closed: true })).toBe(false)
    expect(isClosed({ id: 1, title: 't', createdAt: 0, updatedAt: 0, turnCount: 20, readOnly: false, full: true })).toBe(true)
    expect(isClosed(null)).toBe(false)
  })
  it('traduit les erreurs, celles du coach d’abord', () => {
    expect(coachErrorMessage(new Error('ai:questionInvalid'), texts)).toBe(fr.coach.errors.questionInvalid)
    expect(coachErrorMessage(new Error('ai:truncated'), texts)).toBe(fr.coach.errors.truncated)
    expect(coachErrorMessage(new Error('ai:rateLimited'), texts)).toBe(fr.ai.errors.rateLimited)
    expect(coachErrorMessage(new Error('boom'), texts)).toBe('Erreur : boom')
    const failed = { status: 'failed', errorCode: 'ai:timeout' } as CoachTurn
    expect(turnErrorMessage(failed, texts)).toBe(fr.ai.errors.timeout)
    expect(turnErrorMessage({ ...failed, status: 'answered' }, texts)).toBeNull()
  })
  it('libellés d’outils et JSON tel qu’envoyé', () => {
    expect(toolLabel('period_summary', fr.coach.tools)).toBe('Résumé de période')
    expect(toolLabel('inconnu', fr.coach.tools)).toBe('inconnu')
    expect(prettyJson({})).toBe('{}')
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
  it('chaque outil de pulse-core a un libellé', () => {
    const names = ['list_accounts', 'period_summary', 'segments', 'recurring_mistakes', 'discipline', 'streaks_and_sequences', 'plan_and_rules', 'risk', 'external_factors', 'fees_and_holding_time', 'insights', 'alerts_today', 'trade_list']
    for (const n of names) expect(fr.coach.tools[n]).toBeTruthy()
  })
})
