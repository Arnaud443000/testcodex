import type { Decimal } from './money'
import type { ExposureBasis } from './behavior'

/**
 * Alertes à seuils (garde-fous, cahier 3.6) : miroir des types de `pulse-core/src/alerts/`.
 * Chaque définition est décrite dans CLAUDE.md, « Alertes à seuils (lot 12) ».
 */

/** `critical` : limite dépassée, perte plafond atteinte ou position ouverte sans stop ; `warning` sinon. */
export type AlertSeverity = 'critical' | 'warning'

/** Où en est un compteur face à une limite « maximum autorisé ». */
export type LimitLevel = 'reached' | 'exceeded'

export type AlertMessageKey =
  | 'consecutiveLosses'
  | 'tradesPerDay.reached'
  | 'tradesPerDay.exceeded'
  | 'tradesPerWindow.reached'
  | 'tradesPerWindow.exceeded'
  | 'dailyLoss'
  | 'weeklyLoss'
  | 'revenge'
  | 'outsideHours'
  | 'unusualSession'
  | 'noStopLoss.open'
  | 'noStopLoss.closed'

/** Perte du jour ou de la semaine face à ses limites (3.6.3). */
export interface LossDetail {
  /** Premier jour local de la période « AAAA-MM-JJ » (aujourd'hui, ou le lundi). */
  periodStart: string
  currency: string | null
  /** Perte nette des trades clôturés sur la période, en positif. */
  loss: Decimal
  /** Solde réel du compte au début de la période (dépôts/retraits compris). */
  referenceBalance: Decimal
  /** perte / solde de référence (0,03 = 3 %) ; `null` si ce solde n'est pas positif. */
  lossPct: number | null
  thresholdAmount: Decimal | null
  /** En pour cent (« 3 » = 3 %). */
  thresholdPercent: Decimal | null
  amountReached: boolean
  percentReached: boolean
}

export type AlertDetail =
  | { kind: 'consecutiveLosses'; count: number; threshold: number; tradeIds: number[] }
  | { kind: 'tradesPerDay'; level: LimitLevel; count: number; threshold: number; day: string }
  | { kind: 'tradesPerWindow'; level: LimitLevel; count: number; threshold: number; windowMin: number }
  | ({ kind: 'dailyLoss' } & LossDetail)
  | ({ kind: 'weeklyLoss' } & LossDetail)
  | { kind: 'revenge'; previousTradeId: number; gapMs: number; basis: ExposureBasis; ratio: number | null; sizeFactor: Decimal; windowMin: number }
  | { kind: 'outsideHours'; localTime: string; tradingHours: string }
  | { kind: 'unusualSession'; session: string; sessionCount: number; historyCount: number; share: number }
  | { kind: 'noStopLoss'; open: boolean }

export type AlertKind = AlertDetail['kind']

export type Alert = AlertDetail & {
  /** Identité stable `kind:compte:portée` : une alerte masquée ne revient jamais sous cet identifiant. */
  id: string
  accountId: number
  severity: AlertSeverity
  /** Clé de traduction du message (`src/i18n/fr.ts`, `alerts.messages`) ; les valeurs sont dans le détail. */
  messageKey: AlertMessageKey
  /** Instant de l'événement déclencheur, ms UTC. */
  at: number
  /** Trade concerné, ou dernier trade ayant déclenché l'alerte. */
  tradeId: number | null
}

/** Une ligne de l'historique des alertes. */
export interface AlertRecord {
  alertId: string
  accountId: number
  kind: AlertKind
  severity: AlertSeverity
  tradeId: number | null
  firstSeenAt: number
  dismissedAt: number | null
  /** L'alerte telle qu'affichée la première fois. */
  alert: Alert
}

/**
 * Seuils `alerts.*` (3.6.7). `null` = alerte désactivée. La limite de trades par jour et la définition
 * de la revanche sont les réglages du lot 8 (`BehaviorSettings`), jamais dupliqués ici.
 */
export interface AlertSettings {
  /** Pertes d'affilée dans la journée (2 à 20). Défaut : 3. */
  consecutiveLosses: number | null
  /** Nombre maximum de trades dans la fenêtre glissante (1 à 100). Défaut : 3. */
  burstMaxTrades: number | null
  /** Durée de la fenêtre glissante en minutes (1 à 1440). Défaut : 60. */
  burstWindowMin: number
  /** Perte du jour en % du solde de début de journée (> 0, ≤ 100). Défaut : « 3 ». */
  dailyLossPercent: Decimal | null
  /** Perte du jour en argent, dans la devise de chaque compte. Défaut : désactivé. */
  dailyLossAmount: Decimal | null
  /** Défaut : « 6 ». */
  weeklyLossPercent: Decimal | null
  weeklyLossAmount: Decimal | null
  revenge: boolean
  /** Plage horaire locale « HH:MM-HH:MM » (début inclus, fin exclue, peut passer minuit). Défaut : désactivé. */
  tradingHours: string | null
  unusualSession: boolean
  noStopLoss: boolean
}
