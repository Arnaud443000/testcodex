/**
 * Calendrier économique (lot 25, cahier 3.6.8) : miroir des types de `pulse-core/src/news/`.
 * Règles décrites dans CLAUDE.md, « Calendrier économique (lot 25) ». L'interface ne convertit
 * aucune heure : jour et heure de Paris arrivent déjà calculés.
 */

export type Importance = 'low' | 'medium' | 'high'

/** `none` : aucune source en ligne (rien ne sort du PC) ; `icsUrl` : flux ICS à l'adresse saisie. */
export type NewsSourceKind = 'none' | 'icsUrl'

export interface NewsSettings {
  enabled: boolean
  source: NewsSourceKind
  icsUrl: string | null
  /** Importance d'un événement du flux sans `PRIORITY`. */
  icsImportance: Importance
  /** Devise d'un événement du flux sans devise ; `null` = non précisée. */
  icsCurrency: string | null
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
  /** Hôte du flux : la seule destination de la requête. */
  onlineHost: string | null
}

/** Un événement tel que l'interface l'affiche. */
export interface EconomicEvent {
  id: number
  /** `file`, `icsUrl`, ou `simulation` (faux backend du navigateur). */
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

export interface ImportSummary {
  added: number
  updated: number
  outsideWindow: number
  skipped: { line: number; reason: SkipReason }[]
  skippedCount: number
  purged: number
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
