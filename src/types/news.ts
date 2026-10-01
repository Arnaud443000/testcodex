/**
 * Calendrier économique (lot 25, cahier 3.6.8) : miroir des types de `pulse-core/src/news/`.
 * Règles décrites dans CLAUDE.md, « Calendrier économique (lot 25) ». L'interface ne convertit
 * aucune heure : jour et heure de Paris arrivent déjà calculés.
 */

export type Importance = 'low' | 'medium' | 'high'

/**
 * `none` : aucune source en ligne (rien ne sort du PC) ; `icsUrl` : flux ICS à l'adresse saisie ;
 * `forexFactory` : export hebdomadaire de Forex Factory (lot 28, non officiel, consentement exigé).
 */
export type NewsSourceKind = 'none' | 'icsUrl' | 'forexFactory'

export interface NewsSettings {
  enabled: boolean
  source: NewsSourceKind
  icsUrl: string | null
  /** Importance d'un événement du flux sans `PRIORITY`. */
  icsImportance: Importance
  /** Devise d'un événement du flux sans devise ; `null` = non précisée. */
  icsCurrency: string | null
  /** Forex Factory : l'utilisateur a lu et accepte ce qu'est cette source (obligatoire pour la choisir). */
  ffConsent: boolean
  windowBeforeMin: number
  windowAfterMin: number
  /** Alerte 3.6.8 (seulement si `enabled`). */
  alert: boolean
}

export interface FetchState {
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  /** Code de la dernière tentative échouée (`news:offline`…), effacé par un succès. */
  lastError: string | null
  lastCount: number | null
  lastImportAt: number | null
}

export interface NewsStatus {
  settings: NewsSettings
  state: FetchState
  eventCount: number
  onlineReady: boolean
  /** Hôte de la source en ligne : la seule destination des requêtes. */
  onlineHost: string | null
  /** Instant (ms) à partir duquel une nouvelle requête est permise (5 min après la dernière) ; `null` = maintenant. */
  nextRequestAt: number | null
}

/** Un événement tel que l'interface l'affiche. */
export interface EconomicEvent {
  id: number
  /** `file`, `icsUrl`, `forexFactory`, ou `simulation` (faux backend du navigateur). */
  source: string
  /** Instant UTC (ms) ; `null` = sans heure. */
  startsAt: number | null
  /** Jour de Paris « AAAA-MM-JJ ». */
  day: string
  /** Heure de Paris « HH:MM » ; `null` = sans heure. */
  parisTime: string | null
  /** 1 = lundi … 7 = dimanche. */
  weekday: number
  /** `''` = non précisée. */
  currency: string
  title: string
  importance: Importance
  forecast: string | null
  previous: string | null
  actual: string | null
  updatedAt: number
}

/** Ce que le fichier ou le flux ne dit pas, choisi par l'utilisateur. */
export interface NewsDefaults {
  importance: Importance
  currency: string | null
}

export type NewsFileFormat = 'ics' | 'csv'

export type SkipReason =
  | 'missingDate'
  | 'invalidDate'
  | 'invalidTime'
  | 'unsupportedTimeZone'
  | 'floatingTime'
  | 'nonexistentTime'
  | 'missingTitle'
  | 'invalidImportance'
  | 'invalidCurrency'
  | 'missingColumns'
  | 'tooManyEvents'
  | 'incomplete'
  | 'missingCurrency'
  | 'missingImportance'
  | 'invalidEntry'
  | 'duplicate'

export interface ImportSummary {
  added: number
  updated: number
  outsideWindow: number
  skipped: { line: number; reason: SkipReason }[]
  skippedCount: number
  purged: number
  /** Forex Factory : événements des jours couverts que la source ne liste plus (déplacés ou retirés). */
  removed: number
  /** Code d'une partie illisible alors que le reste l'a été (semaine suivante de Forex Factory), sinon `null`. */
  partial: string | null
}

export type CalendarView = 'today' | 'week'

export interface NewsFilter {
  importances: Importance[]
  currencies: string[]
}

export interface NewsCalendar {
  today: string
  fromDay: string
  toDay: string
  events: EconomicEvent[]
  currencies: string[]
}

export interface NewsRefresh {
  /** `false` : rien n'a été récupéré (appel automatique : désactivé, sans source, déjà essayé aujourd'hui). */
  fetched: boolean
  summary: ImportSummary | null
  status: NewsStatus
}

/** Un événement montré par « Tester la source », avant tout enregistrement. */
export interface PreviewEvent {
  day: string
  parisTime: string | null
  weekday: number
  currency: string
  title: string
  importance: Importance
  forecast: string | null
  previous: string | null
}

/** Résultat de « Tester la source » : rien n'est enregistré avant confirmation. */
export interface NewsPreview {
  count: number
  /** Les 3 prochains événements (ou les 3 premiers s'ils sont tous passés). */
  events: PreviewEvent[]
  skipped: { line: number; reason: SkipReason }[]
  skippedCount: number
  partial: string | null
}
