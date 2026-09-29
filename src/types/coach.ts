// Lot 21 : coach IA (miroir des types de pulse-core `coach` et des commandes de src-tauri).
// Une réponse est un texte généré par IA, affiché comme du texte : jamais une donnée de trading.

export interface CoachLimits {
  maxQuestionChars: number
  maxToolCalls: number
  maxRequests: number
  maxTurns: number
}

export interface CoachToolInfo {
  name: string
  description: string
}

export interface CoachStatus {
  enabled: boolean
  vaultAvailable: boolean
  keyStored: boolean
  /** Consentement propre au coach (ms UTC) ; `null` = jamais, ou IA éteinte depuis. */
  consentAt: number | null
  model: string
  /** `anthropic` dans l'application, `simulation` dans le navigateur. */
  provider: string
  providerHost: string
  limits: CoachLimits
  /** Liste fermée des outils que l'IA peut appeler, telle qu'envoyée. */
  tools: CoachToolInfo[]
}

/** Un appel d'outil pendant un tour : paramètres et résultat exacts envoyés à l'IA. */
export interface CoachToolCall {
  name: string
  input: unknown
  output: unknown
  isError: boolean
}

/** Journal local « données envoyées » d'un tour. */
export interface CoachSentLog {
  provider: string
  model: string
  question: string
  /** Ligne de contexte ajoutée par Pulse (date, décalage horaire, comptes de la portée). */
  context: string
  /** Tours précédents de la même conversation renvoyés tels quels. */
  historyTurns: number
  historyMessages: number
  requests: number
  toolCalls: CoachToolCall[]
  limitReached: boolean
}

export type CoachTurnStatus = 'answered' | 'failed'

export interface CoachTurn {
  id: number
  conversationId: number
  seq: number
  createdAt: number
  question: string
  status: CoachTurnStatus
  /** Code `ai:…` traduit par l'interface ; `null` quand la réponse est arrivée. */
  errorCode: string | null
  /** Texte généré par IA (affiché comme du texte, jamais comme du HTML). */
  answer: string | null
  provider: string
  model: string
  sent: CoachSentLog
  /** Chiffres de la réponse absents de tout ce que Pulse a fourni dans cette conversation. */
  unverified: string[]
  usage: { inputTokens: number; outputTokens: number; requests: number } | null
}

export interface ConversationSummary {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  turnCount: number
  /** Écrite avec une autre liste d'outils : lisible, mais plus de nouvelle question. */
  readOnly: boolean
  /** Limite de questions ou d'historique atteinte : il faut une nouvelle conversation. */
  full: boolean
}

export interface Conversation extends ConversationSummary {
  turns: CoachTurn[]
}

export interface AskCoachRequest {
  /** `null` : nouvelle conversation. */
  conversationId: number | null
  question: string
  /** Comptes de la barre du haut au moment de l'envoi (vide = comptes actifs). */
  accountIds: number[]
  tzOffsetMin: number
  /** Clic sur « Envoyer » : rien ne part sans lui. */
  confirmed: boolean
}
