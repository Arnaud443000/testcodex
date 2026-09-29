import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Account, AccountUpdate, NewAccount } from '../types/account'
import { api } from './api'

interface AccountsCtx {
  /** Comptes actifs : sélecteurs, nouveau trade, totaux par défaut. */
  accounts: Account[]
  /** Tous les comptes, archivés compris (page Paramètres, lecture de l'historique). */
  allAccounts: Account[]
  loading: boolean
  /** null = all accounts */
  selectedId: number | null
  select: (id: number | null) => void
  create: (a: NewAccount) => Promise<Account>
  update: (id: number, a: AccountUpdate) => Promise<Account>
  setArchived: (id: number, archived: boolean) => Promise<Account>
  remove: (id: number) => Promise<void>
}

const Ctx = createContext<AccountsCtx | null>(null)

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [allAccounts, setAllAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    api
      .listAccounts()
      .then(setAllAccounts)
      .finally(() => setLoading(false))
  }, [])

  const create = useCallback(async (a: NewAccount) => {
    const acc = await api.createAccount(a)
    setAllAccounts((prev) => [...prev, acc])
    return acc
  }, [])

  const remove = useCallback(async (id: number) => {
    await api.deleteAccount(id)
    setAllAccounts((prev) => prev.filter((a) => a.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  const replace = (acc: Account) => setAllAccounts((prev) => prev.map((a) => (a.id === acc.id ? acc : a)))

  const update = useCallback(async (id: number, a: AccountUpdate) => {
    const acc = await api.updateAccount(id, a)
    replace(acc)
    return acc
  }, [])

  const setArchived = useCallback(async (id: number, archived: boolean) => {
    const acc = await api.setAccountArchived(id, archived)
    replace(acc)
    return acc
  }, [])

  const accounts = useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts])

  const value = useMemo(
    () => ({ accounts, allAccounts, loading, selectedId, select: setSelectedId, create, update, setArchived, remove }),
    [accounts, allAccounts, loading, selectedId, create, update, setArchived, remove],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccounts(): AccountsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAccounts must be used inside AccountsProvider')
  return v
}
