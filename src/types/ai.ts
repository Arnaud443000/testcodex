// Lot 20 : IA optionnelle (miroir des types de pulse-core `ai` et des commandes de src-tauri).
// La clé API n'apparaît dans aucun type : l'interface sait seulement si une clé est enregistrée.

export interface AiSettings {
  enabled: boolean
  model: string
  /** Instant (ms UTC) où l'utilisateur a accepté l'explication de première utilisation ; `null` = jamais. */
  consentAt: number | null
}

export interface AiSettingsUpdate {
  enabled: boolean
  model: string
}

export interface AiStatus {
  settings: AiSettings
  vaultAvailable: boolean
  keyStored: boolean
  /** `anthropic` dans l'application, `simulation` dans le navigateur. */
  provider: string
  providerHost: string
  defaultModel: string
  suggestedModels: string[]
}

/** Donnée du trade envoyée avec l'image, dans l'ordre d'envoi. */
export type SentFieldKey = 'instrument' | 'direction' | 'entryPrice' | 'plannedStopLoss' | 'plannedTakeProfit' | 'thesis'

export interface SentField {
  key: SentFieldKey
  /** Texte exact envoyé (`long` / `short` pour le sens, décimales telles que saisies). */
  value: string
}

export interface ImageInfo {
  mediaType: string
  bytes: number
  tooLarge: boolean
  missing: boolean
}

export interface ScreenshotContext {
  tradeId: number
  /** `null` : le trade n'a pas de screenshot. */
  image: ImageInfo | null
  fields: SentField[]
}

/** Ce qui partirait, calculé par pulse-core et montré tel quel dans la confirmation. */
export interface AiSendPreview {
  context: ScreenshotContext
  enabled: boolean
  firstUse: boolean
  provider: string
  providerHost: string
  model: string
}

/** Commentaire de l'IA sur un screenshot : texte à lire, jamais une donnée de trading. */
export interface ScreenshotNote {
  id: number
  tradeId: number
  createdAt: number
  provider: string
  model: string
  sent: SentFieldKey[]
  content: string
}
