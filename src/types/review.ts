import type { Decimal } from './money'
import type { ProcessGoalProgress, ProcessPeriodInfo } from './processGoals'

/** Miroir de pulse-core::weekly_review (lot 36) : le bilan hebdomadaire. Rien n'est calculé ici. */

export const MAX_ANSWER_CHARS = 1000
export const MAX_INTENTION_CHARS = 200
export const MAX_INTENTIONS = 3
/** Une série ne compte jamais plus d'un an de semaines. */
export const MAX_REVIEW_STREAK = 52
/** L'erreur la plus coûteuse n'est citée qu'avec au moins ce nombre de trades. */
export const MIN_MISTAKE_TRADES = 3

/** Ce que le trader dit d'une intention, la semaine d'après (`null` = pas évaluée). */
export type IntentionOutcome = 'kept' | 'partly' | 'notKept'
export const INTENTION_OUTCOMES: IntentionOutcome[] = ['kept', 'partly', 'notKept']

/** `todo` : aucun bilan enregistré pour la semaine. */
export type ReviewState = 'todo' | 'draft' | 'done'

/** Pourquoi un fait n'est pas disponible (traduit par l'interface). */
export type FactReason =
  | 'noClosedTrade'
  | 'noRTrade'
  | 'notEnoughTrades'
  | 'noGoals'
  | 'noMistake'
  | 'notEnoughMistakeTrades'
  | 'noMistakeCost'
  | 'onlyCurrentWeek'

/** Une valeur, ou `null` avec la raison : jamais 0 à la place d'une valeur inconnue. */
export interface Fact<T> {
  value: T | null
  reason: FactReason | null
}

export interface CostlyMistake {
  source: 'tag' | 'rule'
  id: number
  label: string
  tradeCount: number
  /** Somme des pertes de ces trades, montant positif. */
  cost: Decimal
  tradeIds: number[]
}

export interface ReviewFacts {
  /** Trades clôturés dans la semaine (0 est un vrai nombre). */
  closedTradeCount: number
  netPnl: Fact<Decimal>
  winRate: Fact<number>
  expectancyR: Fact<number>
  rTradeCount: number
  discipline: Fact<number>
  scoredTradeCount: number
  minScoredTradeCount: number
  goals: Fact<ProcessGoalProgress[]>
  pauseCount: number
  tradesDuringPause: number
  ideasClosed: number
  ideasToReview: Fact<number>
  costlyMistake: Fact<CostlyMistake>
  journalDays: number
}

/** Les trois réponses courtes. Clés techniques : le libellé des questions est dans `fr.review`. */
export interface ReviewAnswers {
  wentWell: string
  doDifferently: string
  nextPriority: string
}
export type AnswerKey = keyof ReviewAnswers
export const ANSWER_KEYS: AnswerKey[] = ['wentWell', 'doDifferently', 'nextPriority']

export interface ReviewIntention {
  id: number
  /** 1 à 3. */
  position: number
  text: string
  outcome: IntentionOutcome | null
}

export interface WeeklyReview {
  id: number
  periodKey: string
  firstDay: string
  lastDay: string
  createdAt: number
  updatedAt: number
  completedAt: number | null
  state: Exclude<ReviewState, 'todo'>
  answers: ReviewAnswers
  intentions: ReviewIntention[]
}

export interface ReviewInput {
  periodKey: string
  answers: ReviewAnswers
  /** 0 à 3 intentions, dans l'ordre (une intention vide est ignorée). */
  intentions: string[]
}

export interface ReviewQuery {
  /** Comptes lus (tous les comptes actifs si vide) ; même devise obligatoire. */
  accountIds: number[]
  periodKey: string
  nowMs: number
  tzOffsetMin: number
  /** Décalage à minuit local de certains jours, pour une semaine à cheval sur un changement d'heure. */
  boundaryOffsets: Record<string, number>
}

export interface LastWeekIntentions {
  periodKey: string
  firstDay: string
  lastDay: string
  intentions: ReviewIntention[]
}

export interface WeeklyReviewView {
  period: ProcessPeriodInfo
  currency: string | null
  facts: ReviewFacts
  review: WeeklyReview | null
  /** `null` : la semaine d'avant n'a pas de bilan, ou pas d'intention. */
  lastWeek: LastWeekIntentions | null
  /** Semaines de suite avant celle-ci où au moins une intention a été tenue. */
  streak: number
}

/** Où en est la semaine en cours (widget), sans calculer aucun fait. */
export interface WeekStatus {
  periodKey: string
  firstDay: string
  lastDay: string
  state: ReviewState
  /** Les intentions en cours (celles du bilan de cette semaine s'il en a, sinon celles de la semaine d'avant). */
  intentions: ReviewIntention[]
  intentionsFrom: string | null
}

export interface ReviewReminderSettings {
  enabled: boolean
  /** Heure locale « HH:MM ». */
  time: string
  /** Toujours `sunday` : le jour n'est pas un réglage. */
  day: 'sunday'
}

export interface ReviewDue {
  periodKey: string
  closedTradeCount: number
  journalDays: number
}

/** Codes d'erreur de pulse-core (`invalid input: review:<code>`), traduits par `fr.review`. */
export type ReviewErrorCode =
  | 'empty'
  | 'answerTooLong'
  | 'intentionTooLong'
  | 'tooManyIntentions'
  | 'future'
  | 'badTime'
  | 'badDay'
