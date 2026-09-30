import type { Decimal } from './money'

/** Miroir des types de pulse-core (crates/pulse-core/src/{trades,tags,trade_view,stats/pnl}.rs). */

export type Direction = 'long' | 'short'
export type PlanFollowed = 'yes' | 'partial' | 'no'
export type ExecutionType = 'discretionary' | 'system'
export type EmotionMoment = 'before' | 'during' | 'after'
export type TagKind = 'setup' | 'timeframe' | 'session' | 'market_condition' | 'emotion' | 'mistake'
export type AssetClass = 'forex' | 'index' | 'crypto' | 'stock' | 'commodity' | 'future' | 'other'
export type Outcome = 'win' | 'loss' | 'breakeven'
export type StopLoss = 'missing' | 'invalid' | 'valid'

export interface Tag {
  id: number
  kind: TagKind
  name: string
  archived: boolean
}

/** Famille du catalogue de suggestions d'émotions (lot 30). */
export interface EmotionCatalogGroup {
  key: string
  label: string
  emotions: string[]
}

/** Nombre de trades portant une émotion (jamais utilisée = 0 : suppression possible). */
export interface EmotionUsage {
  tagId: number
  tradeCount: number
}

export interface Instrument {
  id: number
  symbol: string
  /** Nom complet (« Solana ») ; vide pour un actif personnalisé créé sans nom. */
  name: string
  assetClass: AssetClass
  defaultMultiplier: Decimal
}

export interface NewInstrument {
  symbol: string
  name?: string
  assetClass: AssetClass
  defaultMultiplier: Decimal
}

export interface Rule {
  id: number
  text: string
  archived: boolean
  position: number
}

export interface ChecklistItem {
  id: number
  label: string
  archived: boolean
  position: number
}

export interface EmotionEntry {
  moment: EmotionMoment
  tagId: number
}

export interface RuleCheck {
  ruleId: number
  respected: boolean
}

export interface ChecklistAnswer {
  itemId: number | null
  label: string
  checked: boolean
}

/** Tout ce que le trader saisit sur un trade (création et modification). */
export interface TradeData {
  accountId: number
  instrumentId: number
  direction: Direction
  size: Decimal
  multiplier?: Decimal | null
  entryPrice: Decimal
  exitPrice?: Decimal | null
  /** Millisecondes Unix, UTC. */
  entryTime: number
  exitTime?: number | null
  /** Décalage UTC du trader en minutes (ex. 120 pour UTC+2). */
  tzOffsetMin: number
  plannedSl?: Decimal | null
  plannedTp?: Decimal | null
  actualSl?: Decimal | null
  actualTp?: Decimal | null
  fees: Decimal
  priceAfterExit?: Decimal | null
  executionType?: ExecutionType | null
  rating?: number | null
  conviction?: number | null
  executionQuality?: number | null
  planFollowed?: PlanFollowed | null
  thesis: string
  postMortem: string
  screenshotPath?: string | null
  tagIds: number[]
  emotions: EmotionEntry[]
  ruleChecks: RuleCheck[]
  checklist: ChecklistAnswer[]
}

/** Chiffres calculés par pulse-core pour un trade clôturé. Les ratios sont des flottants, l'argent des chaînes. */
export interface Figures {
  grossPnl: Decimal
  fees: Decimal
  netPnl: Decimal
  initialRisk: Decimal | null
  rMultiple: number | null
  plannedRewardRisk: number | null
  outcome: Outcome
}

/** Un trade enregistré avec ses chiffres calculés (liste et détail). */
export interface TradeView extends TradeData {
  id: number
  createdAt: string
  updatedAt: string
  symbol: string
  assetClass: AssetClass
  accountName: string
  currency: string
  /** null tant que le trade est ouvert. */
  figures: Figures | null
  initialRisk: Decimal | null
  durationMs: number | null
  opportunityCost: Decimal | null
}

/** Aperçu en direct du formulaire, calculé par pulse-core (commande `preview_trade`). */
export interface Preview {
  figures: Figures | null
  initialRisk: Decimal | null
  riskPctOfCapital: number | null
  plannedRewardRisk: number | null
  durationMs: number | null
  /** Nom de la session déduite de l'heure d'entrée (Asie, Londres, New York). */
  session: string
  stopLoss: StopLoss
  opportunityCost: Decimal | null
}

/** Erreur récurrente : une étiquette d'erreur, ou une règle cochée « non respectée » (mêmes sources que `MistakeReport`). */
export interface MistakeFilter {
  source: 'tag' | 'rule'
  id: number
}

export interface TradeFilter {
  accountIds?: number[]
  /** Fenêtre sur l'heure d'entrée, `[from, to)`. */
  from?: number | null
  to?: number | null
  /** Seulement les trades portant cette erreur (filtré par pulse-core). */
  mistake?: MistakeFilter | null
}
