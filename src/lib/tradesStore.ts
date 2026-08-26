import type { Trade } from '../types/trade';
import { createLocalStorageRepository } from './storage';

export const tradesStore = createLocalStorageRepository<Trade>('pulse:trades');
