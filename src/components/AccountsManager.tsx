import { useMemo, useState } from 'react';
import type { AccountType } from '../types/account';
import { accountsStore } from '../lib/accountsStore';
import { depositsStore } from '../lib/depositsStore';
import { tradesStore } from '../lib/tradesStore';
import { useAccounts, computeCurrentCapital } from '../lib/accountContext';
import { formatCurrency } from '../lib/format';
import { Field, inputClass } from './Field';

const ACCOUNT_TYPES: AccountType[] = ['Personnel', 'Prop firm', 'Démo'];

export function AccountsManager() {
  const { accounts, refreshAccounts } = useAccounts();
  const trades = useMemo(() => tradesStore.getAll(), []);
  const [deposits, setDeposits] = useState(() => depositsStore.getAll());

  const [newAccount, setNewAccount] = useState({
    name: '',
    type: 'Personnel' as AccountType,
    broker: '',
    currency: 'EUR',
    initialCapital: '0',
  });

  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [depositForm, setDepositForm] = useState({ date: '', amount: '', note: '' });

  function createAccount() {
    if (!newAccount.name.trim()) return;
    accountsStore.create({
      id: crypto.randomUUID(),
      name: newAccount.name.trim(),
      type: newAccount.type,
      broker: newAccount.broker,
      currency: newAccount.currency || 'EUR',
      initialCapital: Number(newAccount.initialCapital) || 0,
    });
    setNewAccount({ name: '', type: 'Personnel', broker: '', currency: 'EUR', initialCapital: '0' });
    refreshAccounts();
  }

  function addDeposit(accountId: string) {
    const amount = Number(depositForm.amount);
    if (!depositForm.date || !Number.isFinite(amount) || amount === 0) return;
    depositsStore.create({
      id: crypto.randomUUID(),
      accountId,
      date: depositForm.date,
      amount,
      note: depositForm.note || undefined,
    });
    setDepositForm({ date: '', amount: '', note: '' });
    setDeposits(depositsStore.getAll());
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">Comptes</h2>

      <div className="flex flex-col gap-3">
        {accounts.map((account) => {
          const capital = computeCurrentCapital(account, trades, deposits);
          const accountDeposits = deposits
            .filter((d) => d.accountId === account.id)
            .sort((a, b) => b.date.localeCompare(a.date));
          const expanded = expandedAccountId === account.id;

          return (
            <div key={account.id} className="rounded-xl bg-background/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-cream">{account.name}</div>
                  <div className="text-xs text-cream/50">
                    {account.type}
                    {account.broker && ` · ${account.broker}`} · {account.currency}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-cream/50">
                      Capital courant
                    </div>
                    <div
                      className={`font-semibold tabular-nums ${
                        capital >= account.initialCapital ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatCurrency(capital, false)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedAccountId(expanded ? null : account.id)}
                    className="text-sm font-medium text-accent hover:text-cream"
                  >
                    {expanded ? 'Fermer' : 'Dépôts/retraits'}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
                  {accountDeposits.length === 0 ? (
                    <p className="text-xs text-cream/40">Aucun mouvement enregistré.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {accountDeposits.map((d) => (
                        <li key={d.id} className="flex justify-between text-xs text-cream/70">
                          <span>
                            {d.date}
                            {d.note && ` — ${d.note}`}
                          </span>
                          <span
                            className={`tabular-nums ${
                              d.amount >= 0 ? 'text-success' : 'text-danger'
                            }`}
                          >
                            {formatCurrency(d.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Date">
                      <input
                        type="date"
                        className={inputClass}
                        value={depositForm.date}
                        onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                      />
                    </Field>
                    <Field label="Montant (négatif = retrait)">
                      <input
                        type="number"
                        step="any"
                        className={inputClass}
                        value={depositForm.amount}
                        onChange={(e) =>
                          setDepositForm({ ...depositForm, amount: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Note (optionnel)">
                      <input
                        className={inputClass}
                        value={depositForm.note}
                        onChange={(e) => setDepositForm({ ...depositForm, note: e.target.value })}
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => addDeposit(account.id)}
                      className="rounded-full bg-cream px-4 py-2 text-sm font-semibold text-background transition hover:brightness-95"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <span className="text-xs uppercase tracking-wide text-cream/50">Nouveau compte</span>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Nom">
            <input
              className={inputClass}
              value={newAccount.name}
              onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
              placeholder="Prop firm FTMO"
            />
          </Field>
          <Field label="Type">
            <select
              className={inputClass}
              value={newAccount.type}
              onChange={(e) =>
                setNewAccount({ ...newAccount, type: e.target.value as AccountType })
              }
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Broker">
            <input
              className={inputClass}
              value={newAccount.broker}
              onChange={(e) => setNewAccount({ ...newAccount, broker: e.target.value })}
            />
          </Field>
          <Field label="Devise">
            <input
              className={inputClass}
              value={newAccount.currency}
              onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}
            />
          </Field>
          <Field label="Capital initial">
            <input
              type="number"
              step="any"
              className={inputClass}
              value={newAccount.initialCapital}
              onChange={(e) =>
                setNewAccount({ ...newAccount, initialCapital: e.target.value })
              }
            />
          </Field>
          <button
            type="button"
            onClick={createAccount}
            className="rounded-full bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-cream transition hover:brightness-110"
          >
            Créer
          </button>
        </div>
      </div>
    </section>
  );
}
