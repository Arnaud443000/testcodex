import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account, NewAccount } from '../types/account'
import { api } from './api'

interface AccountsCtx {
  accounts: Account[]
  loading: boolean
  /** null = all accounts */
  selectedId: number | null
  select: (id: number | null) => void
  create: (a: NewAccount) => Promise<Account>
}

const Ctx = createContext<AccountsCtx | null>(null)

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    api
      .listAccounts()
      .then(setAccounts)
      .finally(() => setLoading(false))
  }, [])

  const create = useCallback(async (a: NewAccount) => {
    const acc = await api.createAccount(a)
    setAccounts((prev) => [...prev, acc])
    return acc
  }, [])

  const value = useMemo(
    () => ({ accounts, loading, selectedId, select: setSelectedId, create }),
    [accounts, loading, selectedId, create],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccounts(): AccountsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAccounts must be used inside AccountsProvider')
  return v
}
