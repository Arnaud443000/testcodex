import type { Decimal } from './money'
import type { ExposureBasis } from './behavior'
import type { PropAlertDetail } from './prop'

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
  | 'newsTrade'
  | 'noAnalysis'
  // Lot 33 : règles d'un compte prop firm (trades clôturés seulement).
  | 'propDailyLoss.warning'
  | 'propDailyLoss.critical'
  | 'propDailyLoss.reached'
  | 'propMaxLoss.warning'
  | 'propMaxLoss.critical'
  | 'propMaxLoss.reached'
  | 'propConsistency.warning'
  | 'propConsistency.critical'
  | 'propConsistency.reached'

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
  | ({ kind: 'newsTrade' } & NewsTradeDetail)
  /** Lot 31 : trade entré avant toute analyse de séance du jour (alerte facultative, éteinte par défaut). */
  | { kind: 'noAnalysis'; day: string }
  | ({ kind: 'propDailyLoss' } & PropAlertDetail)
  | ({ kind: 'propMaxLoss' } & PropAlertDetail)
  | ({ kind: 'propConsistency' } & PropAlertDetail)

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

// --- Lot 25 : alerte 3.6.8 « trade pris pendant une news majeure » (pulse-core/src/alerts/news.rs) ---

/** Une news forte (avec heure) dont la fenêtre contient l'entrée du trade. */
export interface NewsEventRef {
  eventId: number
  title: string
  /** `''` = non précisée. */
  currency: string
  startsAt: number
  /** Heure de Paris « HH:MM ». */
  parisTime: string
}

/** La comparaison qui a permis l'alerte : trades pris pendant les news contre les autres. */
export interface NewsComparison {
  newsTradeCount: number
  newsRTradeCount: number
  newsExpectancyR: number
  otherTradeCount: number
  otherRTradeCount: number
  otherExpectancyR: number
  /** news − autres, en R (≤ −0,25 quand l'alerte apparaît). */
  difference: number
  byCalendar: number
  byTag: number
  byBoth: number
}

export interface NewsTradeDetail {
  /** 5 au plus, dans l'ordre de l'heure. */
  events: NewsEventRef[]
  eventCount: number
  windowBeforeMin: number
  windowAfterMin: number
  comparison: NewsComparison
}

