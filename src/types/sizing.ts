import type { Decimal } from './money'
import type { Direction } from './trade'

/** Miroir de `crates/pulse-core/src/sizing.rs` (lot 27). Tout montant, prix et taille est une chaîne décimale exacte. */

export type RiskMode = 'percent' | 'amount'

export interface SizingRequest {
  accountId: number
  instrumentId: number
  direction: Direction
  entryPrice: Decimal
  stopLoss: Decimal
  takeProfit: Decimal | null
  riskMode: RiskMode
  /** Pourcentage du solde (« 1.5 » = 1,5 %) ou montant dans la devise du compte. */
  riskValue: Decimal
  /** Remplace le multiplicateur de l'actif. */
  multiplier: Decimal | null
  /** Remplace le pas de taille par défaut de la classe d'actif. */
  sizeStep: Decimal | null
}

export interface Sizing {
  /** Taille retenue : la taille brute arrondie vers le bas au pas. */
  size: Decimal
  /** Taille avant arrondi, tronquée à 8 décimales (affichage). */
  rawSize: Decimal
  sizeStep: Decimal
  sizeStepIsDefault: boolean
  multiplier: Decimal
  balance: Decimal
  riskWanted: Decimal
  riskWantedPercent: Decimal | null
  riskActual: Decimal
  riskActualPercent: Decimal | null
  /** Risque voulu − risque réel (≥ 0) : uniquement l'arrondi vers le bas. */
  riskGap: Decimal
  stopDistance: Decimal
  rewardAmount: Decimal | null
  /** Ratio sans unité ; `null` sans take profit ou si celui-ci est du mauvais côté. */
  rewardRisk: number | null
  takeProfitWrongSide: boolean
  maxRiskPercent: Decimal | null
  maxRiskAmount: Decimal | null
  exceedsMaxRisk: boolean
}

export type SizingRefusalCode =
  | 'priceNotPositive'
  | 'stopEqualsEntry'
  | 'stopWrongSide'
  | 'riskNotPositive'
  | 'riskPercentTooHigh'
  | 'balanceNotPositive'
  | 'multiplierNotPositive'
  | 'stepNotPositive'
  | 'sizeZero'
  | 'overflow'

export type SizingOutcome =
  | { status: 'ok'; result: Sizing; currency: string }
  /** `detail` : pour `sizeZero`, le risque qu'aurait la taille minimum. */
  | { status: 'refused'; code: SizingRefusalCode; detail: string | null }
