import { DEFAULT_SETTINGS, type Settings } from '../types/settings';
import { createLocalStorageDocument } from './storage';

export const settingsStore = createLocalStorageDocument<Settings>(
  'pulse:settings',
  DEFAULT_SETTINGS,
);
