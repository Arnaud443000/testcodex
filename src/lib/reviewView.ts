import type { IconName } from '../components/Icon'
import type { Messages } from '../i18n'
import type { FactReason, IntentionOutcome, ReviewAnswers, ReviewErrorCode, ReviewFacts, ReviewInput, ReviewState, WeeklyReview } from '../types/review'
import { ANSWER_KEYS, MAX_INTENTIONS } from '../types/review'

/**
 * Affichage du bilan hebdomadaire (lot 36) : mots, icônes, brouillon du formulaire. Aucun calcul : les faits,
 * la série et les règles de date viennent de pulse-core ; ici on choisit des mots et on prépare la saisie.
 */

/** Numéro de la semaine d'une clé « AAAA-Www ». */
export const weekNumber = (periodKey: string): number => Number(periodKey.slice(6))

/** Le brouillon du formulaire : les trois réponses et jusqu'à trois intentions (champs, vides compris). */
export interface ReviewDraft {
  answers: ReviewAnswers
  intentions: string[]
}

export const emptyDraft = (): ReviewDraft => ({ answers: { wentWell: '', doDifferently: '', nextPriority: '' }, intentions: [''] })

/** Le brouillon d'un bilan enregistré (au moins un champ d'intention pour pouvoir en écrire une). */
export const draftOf = (review: WeeklyReview | null): ReviewDraft =>
  review ? { answers: { ...review.answers }, intentions: review.intentions.length > 0 ? review.intentions.map((i) => i.text) : [''] } : emptyDraft()

/** Rien d'écrit : pulse-core refuse un bilan entièrement vide, le bouton ne propose pas de l'envoyer. */
export const isBlankDraft = (d: ReviewDraft): boolean => ANSWER_KEYS.every((k) => d.answers[k].trim() === '') && d.intentions.every((s) => s.trim() === '')

export const toInput = (periodKey: string, d: ReviewDraft): ReviewInput => ({ periodKey, answers: { ...d.answers }, intentions: d.intentions })

/** Le brouillon est-il identique à ce qui est enregistré ? (« Enregistré » / « Modifications non enregistrées »). */
export const sameDraft = (a: ReviewDraft, b: ReviewDraft): boolean => {
  const clean = (s: string) => s.trim()
  const intentions = (d: ReviewDraft) => d.intentions.map(clean).filter(Boolean).join('\n')
  return ANSWER_KEYS.every((k) => clean(a.answers[k]) === clean(b.answers[k])) && intentions(a) === intentions(b)
}

export const canAddIntention = (d: ReviewDraft): boolean => d.intentions.length < MAX_INTENTIONS

/** État d'un bilan : le texte et l'icône portent le sens, la couleur ne fait que le doubler. */
export function stateLook(state: ReviewState): { badge: string; icon: IconName } {
  switch (state) {
    case 'done':
      return { badge: 'badge-gain', icon: 'check' }
    case 'draft':
      return { badge: 'badge-warn', icon: 'edit' }
    case 'todo':
      return { badge: 'badge-neutral', icon: 'minus' }
  }
}

/** Suivi d'une intention : texte + icône, jamais de rouge (« Pas tenue » n'est pas une faute). */
export function outcomeLook(outcome: IntentionOutcome | null): { badge: string; icon: IconName } {
  switch (outcome) {
    case 'kept':
      return { badge: 'badge-gain', icon: 'check' }
    case 'partly':
      return { badge: 'badge-warn', icon: 'minus' }
    case 'notKept':
      return { badge: 'badge-neutral', icon: 'cross' }
    case null:
      return { badge: 'badge-neutral', icon: 'info' }
  }
}

/** La raison d'un fait manquant, avec les chiffres utiles quand il y en a. */
export function reasonText(t: Messages['review'], reason: FactReason | null, facts: Pick<ReviewFacts, 'scoredTradeCount' | 'minScoredTradeCount'>): string {
  if (reason === null) return ''
  if (reason === 'notEnoughTrades') return t.facts.notEnoughTrades(facts.scoredTradeCount, facts.minScoredTradeCount)
  return t.facts.reasons[reason]
}

/** Le code d'une erreur de pulse-core (`invalid input: review:<code>`), ou `null`. */
export function errorCode(message: string): ReviewErrorCode | null {
  const m = /review:(\w+)/.exec(message)
  return m && m[1] in frCodes ? (m[1] as ReviewErrorCode) : null
}
const frCodes: Record<ReviewErrorCode, true> = { empty: true, answerTooLong: true, intentionTooLong: true, tooManyIntentions: true, future: true, badTime: true, badDay: true }

/** Message d'erreur de l'utilisateur : le code traduit quand il est connu, sinon le détail tel quel. */
export function errorText(t: Messages['review'], e: unknown, wrap: (detail: string) => string): string {
  const message = String(e instanceof Error ? e.message : e)
  const code = errorCode(message)
  return code ? t.errors[code] : wrap(message.replace(/^invalid input: /, ''))
}

/** « 2026-09-14 » → « 14 sept. » (jour et mois courts, en français). */
export const shortDate = (day: string, withYear = false): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
