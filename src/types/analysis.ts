import type { Decimal } from './money'
import type { Comparison } from './behavior'

/**
 * Analyse avant trading, idées à surveiller et revue du lendemain (lot 31) : miroir des types de
 * `pulse-core/src/analysis/`. Que des textes à lire, relus le lendemain : aucun calcul côté interface.
 * Règles : CLAUDE.md, « Analyse avant trading (lot 31) ».
 */

export type QuestionKind = 'shortText' | 'longText' | 'choice' | 'trend' | 'conviction' | 'setups' | 'emotions' | 'news'

/** Unités de temps proposées, dans l'ordre d'affichage. */
export const TIMEFRAMES = ['monthly', 'weekly', 'daily', 'h4', 'h1', 'm15'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export type TrendValue = 'up' | 'down' | 'range' | 'unclear'
export const TRENDS: TrendValue[] = ['up', 'down', 'range', 'unclear']

export interface Question {
  id: number
  /** Clé technique stable : celle des questions d'origine traduit leur libellé. */
  key: string
  /** `null` = libellé d'origine (traduit depuis `key`). */
  label: string | null
  kind: QuestionKind
  position: number
  archived: boolean
  /** `{ timeframes }` (tendance), `{ choices }` (choix unique), `{}` sinon. */
  options: { timeframes?: Timeframe[]; choices?: string[] }
}

/** Réponse à une question de tendance : une entrée par unité de temps renseignée. */
export type TrendAnswer = Partial<Record<Timeframe, { trend: TrendValue | null; note: string | null }>>
export interface EmotionsAnswer {
  text: string | null
  tagIds: number[]
}

/** La valeur dépend du `kind` de la question : texte, nombre, liste d'identifiants, objet. */
export type AnswerValue = string | number | number[] | TrendAnswer | EmotionsAnswer | { note: string | null } | null

export interface Answer {
  questionId: number
  value: AnswerValue
}

export interface Analysis {
  id: number
  createdAt: number
  tzOffsetMin: number
  /** Jour local de `createdAt` avec son propre décalage, « AAAA-MM-JJ ». */
  day: string
  updatedAt: number
  note: string | null
  answers: Answer[]
}

export interface AnswerInput {
  questionId: number
  /** `null`, `''`, `[]`… = vide : la réponse est effacée (ou jamais écrite). */
  value: AnswerValue | undefined
}

export interface AnalysisInput {
  /** `null` = maintenant. */
  createdAt: number | null
  tzOffsetMin: number
  note: string | null
  answers: AnswerInput[]
}

export type NewsBlockState = 'off' | 'none' | 'events'
export interface NewsBlockEvent {
  id: number
  title: string
  currency: string
  /** Heure de Paris « HH:MM » ; `null` = sans heure. */
  parisTime: string | null
}
export interface NewsBlock {
  state: NewsBlockState
  /** Jour de Paris. */
  day: string
  events: NewsBlockEvent[]
}

export type IdeaStatus = 'active' | 'closed'
export type IdeaOutcome = 'worked' | 'invalidated' | 'noFollowUp'
export type NoteKind = 'created' | 'edit' | 'complement' | 'snooze' | 'closed'

export interface IdeaNote {
  id: number
  createdAt: number
  kind: NoteKind
  /** Texte du trader ; vide pour un report. Les libellés (« Reportée jusqu'au… ») sont ceux de l'interface. */
  body: string
  /** Jour de retour (report) ou résultat (clôture). */
  data: string | null
}

export interface Idea {
  id: number
  instrumentId: number
  symbol: string
  timeframes: Timeframe[]
  note: string
  levelLow: Decimal | null
  levelHigh: Decimal | null
  invalidation: string | null
  createdAt: number
  /** Dernière mise à jour du contenu (un report ou « Toujours valable » n'y touche pas). */
  updatedAt: number
  lastReviewedAt: number | null
  status: IdeaStatus
  outcome: IdeaOutcome | null
  closedAt: number | null
  /** Jour local jusqu'auquel l'idée est reportée. */
  snoozedUntilDay: string | null
  snoozeCount: number
  notes: IdeaNote[]
}

/** Une idée et ce que les règles de la revue en disent (calculé par pulse-core). */
export interface IdeaView extends Idea {
  ageDays: number
  /** « À revoir » : sans mise à jour depuis `staleDays` jours ou plus, et pas en report. */
  stale: boolean
  /** Reportée et le jour de retour n'est pas encore arrivé. */
  snoozed: boolean
  /** Report dont le jour est arrivé : l'idée revient en tête de la revue. */
  returned: boolean
  reviewedToday: boolean
  inReview: boolean
}

export interface IdeaInput {
  instrumentId: number
  timeframes: Timeframe[]
  note: string
  levelLow: string | null
  levelHigh: string | null
  invalidation: string | null
}

export interface ReviewQueue {
  day: string
  items: IdeaView[]
  /** Combien l'interface montre d'abord ; les autres sont derrière « Voir les N autres ». */
  visible: number
  hidden: number
}

export interface ReviewBanner {
  day: string
  count: number
}

export interface AnalysisSettings {
  /** Jours sans mise à jour avant « à revoir » (1 à 60). */
  staleDays: number
  /** Alerte facultative « trade pris sans analyse du jour » (éteinte par défaut). */
  noAnalysisAlert: boolean
}

export interface IdeaLink {
  id: number
  symbol: string
  note: string
  status: IdeaStatus
  outcome: IdeaOutcome | null
}
export interface AnalysisLink {
  id: number
  createdAt: number
  tzOffsetMin: number
  day: string
}
export interface TradeLinks {
  ideas: IdeaLink[]
  analyses: AnalysisLink[]
}

export interface IdeaOutcomes {
  worked: number
  invalidated: number
  noFollowUp: number
  closedCount: number
  /** `null` sous 5 idées clôturées (ou sans idée « a fonctionné » / « invalidée »). */
  successRate: number | null
  activeCount: number
}

export interface LinkedSide {
  tradeCount: number
  disciplineScore: number | null
  expectancyR: number | null
  rTradeCount: number
}

export interface LinkedComparison {
  linked: LinkedSide
  unlinked: LinkedSide
  discipline: Comparison
  expectancyR: Comparison
  minTradeCount: number
}

export interface AnalysisReport {
  ideas: IdeaOutcomes
  comparison: LinkedComparison
  analysisCount: number
}

export const MIN_SNOOZE_DAYS = 1
export const MAX_SNOOZE_DAYS = 30
export const MIN_STALE_DAYS = 1
export const MAX_STALE_DAYS = 60
