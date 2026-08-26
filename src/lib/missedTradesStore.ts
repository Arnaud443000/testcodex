import type { MissedTrade } from '../types/missedTrade';
import { createLocalStorageRepository } from './storage';

export const missedTradesStore =
  createLocalStorageRepository<MissedTrade>('pulse:missed-trades');
