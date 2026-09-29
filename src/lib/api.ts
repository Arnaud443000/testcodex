import type { Account, AppInfo, NewAccount } from '../types/account'
import type {
  ChecklistItem,
  Instrument,
  NewInstrument,
  Preview,
  Rule,
  Tag,
  TagKind,
  TradeData,
  TradeFilter,
  TradeView,
} from '../types/trade'
import { mock } from './mockBackend'

/**
 * Thin wrapper over the Tauri commands defined in src-tauri/src/lib.rs.
 * Outside Tauri (plain `npm run dev` in a browser) it falls back to an
 * in-memory mock (mockBackend.ts) so the UI can be developed and screenshotted without Rust.
 */
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const api = {
  appInfo: (): Promise<AppInfo> => (inTauri ? invoke('app_info') : mock.appInfo()),

  listAccounts: (): Promise<Account[]> => (inTauri ? invoke('list_accounts') : mock.listAccounts()),
  deleteAccount: (id: number): Promise<void> => (inTauri ? invoke('delete_account', { id }) : mock.deleteAccount(id)),
  createAccount: (account: NewAccount): Promise<Account> =>
    inTauri ? invoke('create_account', { account }) : mock.createAccount(account),

  listInstruments: (): Promise<Instrument[]> => (inTauri ? invoke('list_instruments') : mock.listInstruments()),
  createInstrument: (instrument: NewInstrument): Promise<Instrument> =>
    inTauri ? invoke('create_instrument', { instrument }) : mock.createInstrument(instrument),

  listTags: (kind?: TagKind, includeArchived = false): Promise<Tag[]> =>
    inTauri ? invoke('list_tags', { kind: kind ?? null, includeArchived }) : mock.listTags(kind, includeArchived),
  createTag: (kind: TagKind, name: string): Promise<Tag> =>
    inTauri ? invoke('create_tag', { kind, name }) : mock.createTag(kind, name),

  listRules: (includeArchived = false): Promise<Rule[]> =>
    inTauri ? invoke('list_rules', { includeArchived }) : mock.listRules(includeArchived),
  createRule: (text: string): Promise<Rule> => (inTauri ? invoke('create_rule', { text }) : mock.createRule(text)),

  listChecklist: (includeArchived = false): Promise<ChecklistItem[]> =>
    inTauri ? invoke('list_checklist', { includeArchived }) : mock.listChecklist(includeArchived),
  createChecklistItem: (label: string): Promise<ChecklistItem> =>
    inTauri ? invoke('create_checklist_item', { label }) : mock.createChecklistItem(label),

  listTrades: (filter?: TradeFilter): Promise<TradeView[]> =>
    inTauri ? invoke('list_trades', { filter: filter ?? null }) : mock.listTrades(filter),
  getTrade: (id: number): Promise<TradeView> => (inTauri ? invoke('get_trade', { id }) : mock.getTrade(id)),
  createTrade: (trade: TradeData): Promise<TradeView> =>
    inTauri ? invoke('create_trade', { trade }) : mock.createTrade(trade),
  updateTrade: (id: number, trade: TradeData): Promise<TradeView> =>
    inTauri ? invoke('update_trade', { id, trade }) : mock.updateTrade(id, trade),
  deleteTrade: (id: number): Promise<void> => (inTauri ? invoke('delete_trade', { id }) : mock.deleteTrade(id)),

  /** Aperçu P&L / R / risque : toujours calculé par pulse-core dans l'application. */
  previewTrade: (trade: TradeData): Promise<Preview> =>
    inTauri ? invoke('preview_trade', { trade }) : mock.previewTrade(trade),

  /** `image` : fichier en base64 (ou URL `data:`). Renvoie le chemin relatif à mémoriser sur le trade. */
  saveScreenshot: (image: string): Promise<string> =>
    inTauri ? invoke('save_screenshot', { image }) : mock.saveScreenshot(image),
  /** Renvoie une URL `data:` affichable. */
  readScreenshot: (path: string): Promise<string> =>
    inTauri ? invoke('read_screenshot', { path }) : mock.readScreenshot(path),
}
