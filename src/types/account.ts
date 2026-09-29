import type { Decimal } from './money'

export type AccountKind = 'personal' | 'prop' | 'demo'

export interface Account {
  id: number
  name: string
  kind: AccountKind
  broker: string
  currency: string
  initialCapital: Decimal
}

export type NewAccount = Omit<Account, 'id'>

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
