import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Account } from '../types/account';
import type { Deposit } from '../types/deposit';
import type { Trade } from '../types/trade';
import { accountsStore, ensureDefaultAccount } from './accountsStore';
import { tradesStore } from './tradesStore';
import { computeTradePnl } from './pnl';

interface AccountContextValue {
  accounts: Account[];
  /** null = "Tous les comptes". */
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  refreshAccounts: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(() => {
    ensureDefaultAccount();
    return accountsStore.getAll();
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const refreshAccounts = () => setAccounts(accountsStore.getAll());

  const value = useMemo(
    () => ({ accounts, selectedAccountId, setSelectedAccountId, refreshAccounts }),
    [accounts, selectedAccountId],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccounts(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used within an AccountProvider');
  return ctx;
}

/** Trades scoped to the currently selected account (or all of them). */
export function useAccountTrades(): Trade[] {
  const { selectedAccountId } = useAccounts();
  return useMemo(() => {
    const all = tradesStore.getAll();
    return selectedAccountId === null
      ? all
      : all.filter((t) => t.accountId === selectedAccountId);
  }, [selectedAccountId]);
}

/**
 * capitalCourant = capital initial + dépôts - retraits + PnL net cumulé (2.1).
 * Deposits/withdrawals are tracked separately from trading PnL precisely so
 * they never distort the equity curve (3.7.10) — this is the one place they
 * get folded back in, to answer "what's actually in the account right now".
 */
export function computeCurrentCapital(
  account: Account,
  trades: Trade[],
  deposits: Deposit[],
): number {
  const accountTrades = trades.filter((t) => t.accountId === account.id && t.closed);
  const accountDeposits = deposits.filter((d) => d.accountId === account.id);
  const netPnl = accountTrades.reduce((sum, t) => sum + computeTradePnl(t), 0);
  const netFlows = accountDeposits.reduce((sum, d) => sum + d.amount, 0);
  return account.initialCapital + netFlows + netPnl;
}
