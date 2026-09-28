import type { Account, AppInfo, NewAccount } from '../types/account'

/**
 * Thin wrapper over the Tauri commands defined in src-tauri/src/lib.rs.
 * Outside Tauri (plain `npm run dev` in a browser) it falls back to an
 * in-memory mock so the UI can be developed and screenshotted without Rust.
 */
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

const mockAccounts: Account[] = []

const mock = {
  appInfo: async (): Promise<AppInfo> => ({ version: '0.1.0', dataDir: '(browser preview)', schemaVersion: 1 }),
  listAccounts: async (): Promise<Account[]> => [...mockAccounts],
  createAccount: async (a: NewAccount): Promise<Account> => {
    if (!a.name.trim()) throw new Error('invalid input: account name is required')
    const acc = { ...a, name: a.name.trim(), id: mockAccounts.length + 1 }
    mockAccounts.push(acc)
    return acc
  },
}

export const api = {
  appInfo: (): Promise<AppInfo> => (inTauri ? invoke('app_info') : mock.appInfo()),
  listAccounts: (): Promise<Account[]> => (inTauri ? invoke('list_accounts') : mock.listAccounts()),
  createAccount: (account: NewAccount): Promise<Account> =>
    inTauri ? invoke('create_account', { account }) : mock.createAccount(account),
}
