export type AccountKind = 'personal' | 'prop' | 'demo'

export interface Account {
  id: number
  name: string
  kind: AccountKind
  broker: string
  currency: string
  initialCapital: number
}

export type NewAccount = Omit<Account, 'id'>

export interface AppInfo {
  version: string
  dataDir: string
  schemaVersion: number
}
