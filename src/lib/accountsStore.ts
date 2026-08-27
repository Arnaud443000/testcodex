import type { Account } from '../types/account';
import { createLocalStorageRepository } from './storage';

export const accountsStore = createLocalStorageRepository<Account>('pulse:accounts');

/** First launch needs at least one account for trades to be attached to. */
export function ensureDefaultAccount(): Account {
  const existing = accountsStore.getAll();
  if (existing.length > 0) return existing[0];
  return accountsStore.create({
    id: crypto.randomUUID(),
    name: 'Compte principal',
    type: 'Personnel',
    broker: '',
    currency: 'EUR',
    initialCapital: 0,
  });
}
