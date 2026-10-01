import type { Decimal } from './money'
import type { Comparison } from './behavior'
import type { Summary } from './stats'

/** Miroir de `crates/pulse-core/src/pause.rs` (lot 35). Un rappel, jamais un blocage. Instants : millisecondes Unix UTC. */

/** Motifs proposés (traduits par l'interface) ; le texte libre est `note`. */
export const PAUSE_REASONS = ['loss', 'lossStreak', 'fatigue', 'emotion', 'other'] as const
export type PauseReason = (typeof PAUSE_REASONS)[number]

export const MIN_PAUSE_MINUTES = 1
export const MAX_PAUSE_MINUTES = 480
export const PAUSE_NOTE_MAX_CHARS = 140

export interface Pause {
  id: number
  startedAt: number
  plannedEndAt: number
  /** Heure réelle si la pause a été terminée plus tôt ; `null` tant qu'elle court ou quand elle s'est terminée d'elle-même. */
  endedAt: number | null
  tzOffsetMin: number
  reason: PauseReason | null
  note: string | null
}

export type PauseLength = { kind: 'minutes'; minutes: number } | { kind: 'untilTomorrow' }

export interface NewPause {
  length: PauseLength
  reason: PauseReason | null
  note: string | null
  /** Décalage local du trader maintenant, en minutes : il fixe ce qu'est « demain matin ». */
  tzOffsetMin: number
}

export interface CurrentPause {
  pause: Pause
  remainingMs: number
  /** Minutes restantes, arrondies au-dessus. */
  remainingMin: number
}

export type PauseStatus = 'running' | 'completed' | 'endedEarly'

export interface PauseRow {
  pause: Pause
  status: PauseStatus
  plannedMs: number
  /** Durée réelle (écoulée jusqu'ici si elle court). */
  actualMs: number
  /** Trades entrés pendant la pause : instant d'entrée dans [début ; fin réelle). */
  tradeCount: number
}

export interface PauseGroup {
  summary: Summary
  disciplineScore: number | null
  scoredTradeCount: number
  tradeIds: number[]
}

export interface PauseReport {
  /** Pauses commencées dans la période. */
  pauseCount: number
  tradeCount: number
  during: PauseGroup
  others: PauseGroup
  shareDuring: number | null
  minTradeCount: number
  sampleTooSmall: boolean
  /** pendant − autres ; aucun verdict (dépend de la taille). */
  avgNetPnlDifference: Decimal | null
  expectancyR: Comparison
  discipline: Comparison
}

/** Une proposition seulement : elle ne démarre jamais une pause. */
export interface PauseSuggestion {
  accountId: number
  losses: number
  threshold: number
}

export interface PauseSettings {
  /** 2 à 10, ou `null` (jamais). */
  suggestAfterLosses: number | null
  /** 1 à 480. */
  defaultMinutes: number
}
