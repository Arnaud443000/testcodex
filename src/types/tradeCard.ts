import type { Decimal } from './money'
import type { Outcome } from './trade'

/** Miroir de `crates/pulse-core/src/stats/trade_card.rs`. Jamais de solde : seulement des résultats du trade. */
export interface TradeCardFigures {
  tradeId: number
  /** `false` tant que le trade est ouvert : tous les chiffres sont alors `null`. */
  closed: boolean
  outcome: Outcome | null
  /** `null` sans stop prévu valide. */
  rMultiple: number | null
  /** PnL net / solde juste avant la sortie (0,012 = +1,2 %) ; `null` si ce solde n'est pas positif. */
  returnFraction: number | null
  /** Ne sert que si l'utilisateur coche « montrer le P&L en argent ». */
  netPnl: Decimal | null
}

export type CardFormat = 'portrait' | 'square'

/** Chaque case à cocher de la boîte de dialogue = un élément de la carte. */
export interface CardOptions {
  format: CardFormat
  symbol: boolean
  direction: boolean
  resultR: boolean
  resultPct: boolean
  setup: boolean
  date: boolean
  /** La capture du trade : elle peut montrer un solde ou un courtier, donc décochée par défaut. */
  screenshot: boolean
  /** Montant en argent : décoché par défaut, avec un avertissement. */
  pnlMoney: boolean
  thesis: boolean
  postMortem: boolean
}

export type CardOutcome = Outcome | 'open'

/**
 * Tout ce que la carte peut afficher. Une clé n'existe QUE si l'utilisateur a coché l'élément
 * (et que la donnée existe) : le modèle ne contient donc jamais de capital, de solde, de nom de
 * compte, de courtier ni de montant en argent par défaut. `brand` est la seule clé permanente.
 */
export interface CardModel {
  format: CardFormat
  brand: string
  symbol?: string
  direction?: { side: 'long' | 'short'; label: string }
  /** Présent dès que R ou % est coché ; le libellé (« Gain », « Perte »…) porte le sens avec le signe. */
  result?: { outcome: CardOutcome; label: string; r?: string; pct?: string }
  pnlMoney?: { outcome: CardOutcome; text: string }
  setup?: string
  date?: string
  screenshot?: true
  thesis?: string
  postMortem?: string
}
