import type { Deposit } from '../types/deposit';
import { createLocalStorageRepository } from './storage';

export const depositsStore = createLocalStorageRepository<Deposit>('pulse:deposits');
