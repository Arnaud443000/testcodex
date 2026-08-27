import type { Goal } from '../types/goal';
import { createLocalStorageRepository } from './storage';

export const goalsStore = createLocalStorageRepository<Goal>('pulse:goals');
