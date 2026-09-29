import type { Decimal } from './money'

export type AccountKind = 'personal' | 'prop' | 'demo'

export interface Account {
  id: number
  name: string
  kind: AccountKind
  broker: string
  currency: string
  initialCapital: Decimal
  /** Archivé : absent des sélecteurs et des totaux par défaut, historique conservé. */
  archived: boolean
  /** Au moins un trade, dépôt/retrait ou trade manqué : devise verrouillée, suppression impossible. */
  hasHistory: boolean
}

export type NewAccount = Omit<Account, 'id' | 'archived' | 'hasHistory'>

/** Champs modifiables d'un compte (la devise est refusée si le compte a de l'historique). */
export type AccountUpdate = NewAccount

export interface AppInfo {
  version: string
  dataDir: string
  schemaVersion: number
}

export type CashFlowKind = 'deposit' | 'withdrawal'

/** Dépôt ou retrait : jamais compté dans la performance (cahier des charges 3.7.10). */
export interface CashFlow {
  id: number
  accountId: number
  kind: CashFlowKind
  /** Toujours positif : le type donne le sens. */
  amount: Decimal
  occurredAt: number
  tzOffsetMin: number
  note: string
}

export type NewCashFlow = Omit<CashFlow, 'id'>
