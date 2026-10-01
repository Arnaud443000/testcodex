/**
 * Accès MCP local (lot 37) : miroir des types de `pulse-core/src/mcp/`. Règles dans CLAUDE.md,
 * « Serveur MCP (lot 37) ». Pulse n'appelle aucune IA : c'est le client MCP de l'utilisateur (Claude Code)
 * qui appelle les outils en lecture seule du coach, par un pont sur 127.0.0.1.
 */

/** Durée d'une activation ; l'accès s'éteint aussi à la fermeture et au verrouillage. */
export type McpDuration = 'untilClose' | '1h' | '4h'

export interface McpSettings {
  /** Instant du consentement (ms UTC) ; `null` = jamais donné, ou retiré. */
  consentAt: number | null
  /** Comptes lisibles par les outils (cochés par l'utilisateur ; aucun par défaut). */
  accountIds: number[]
  duration: McpDuration
  /** « Rester activé au prochain démarrage » (désactivé par défaut). */
  autostart: boolean
}

export interface McpSettingsUpdate {
  accountIds: number[]
  duration: McpDuration
  autostart: boolean
}

/** Pourquoi l'accès s'est coupé la dernière fois. */
export type McpStopReason = 'manual' | 'expired' | 'locked' | 'closed' | 'settings'

/** Jamais le port ni le jeton. */
export interface McpStatus {
  settings: McpSettings
  active: boolean
  startedAt: number | null
  /** `null` = jusqu'à la fermeture de Pulse. */
  expiresAt: number | null
  /** Appels répondus pendant cette activation. */
  calls: number
  /** Appels refusés par la limite de 60 par minute pendant cette activation. */
  refused: number
  lastCallAt: number | null
  lastStopReason: McpStopReason | null
  lastStopAt: number | null
  /** Pourquoi on ne peut pas activer maintenant ; `null` = possible. */
  cannotEnable: 'consentRequired' | 'noAccount' | null
  /** Lignes du journal « Données envoyées ». */
  logCount: number
}

/** Une ligne du journal : `result` est exactement le texte envoyé au client MCP. */
export interface McpCall {
  id: number
  at: number
  tzOffsetMin: number
  tool: string
  /** Paramètres reçus (texte JSON). */
  params: string
  result: string
  isError: boolean
  /** Taille de `result`, en octets. */
  size: number
  durationMs: number
}

export interface McpInstallCommand {
  /** Emplacement attendu de pulse-mcp.exe, à côté de Pulse. */
  exePath: string
  exeFound: boolean
  add: string
  list: string
  remove: string
  /** `--data-dir` a été ajouté (dossier de données différent de celui que pulse-mcp trouve seul). */
  withDataDir: boolean
}
