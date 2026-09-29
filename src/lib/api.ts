import type { Account, AccountUpdate, AppInfo, CashFlow, NewAccount, NewCashFlow } from '../types/account'
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
import type { BackupInfo, RestoreResult } from '../types/data'
import type { Calendar, CalendarQuery, Dashboard, DashboardQuery, DayTrade } from '../types/stats'
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

  renameRule: (id: number, text: string): Promise<Rule> =>
    inTauri ? invoke('rename_rule', { id, text }) : mock.renameRule(id, text),
  setRuleArchived: (id: number, archived: boolean): Promise<Rule> =>
    inTauri ? invoke('set_rule_archived', { id, archived }) : mock.setRuleArchived(id, archived),

  listChecklist: (includeArchived = false): Promise<ChecklistItem[]> =>
    inTauri ? invoke('list_checklist', { includeArchived }) : mock.listChecklist(includeArchived),
  createChecklistItem: (label: string): Promise<ChecklistItem> =>
    inTauri ? invoke('create_checklist_item', { label }) : mock.createChecklistItem(label),

  renameChecklistItem: (id: number, label: string): Promise<ChecklistItem> =>
    inTauri ? invoke('rename_checklist_item', { id, label }) : mock.renameChecklistItem(id, label),
  setChecklistItemArchived: (id: number, archived: boolean): Promise<ChecklistItem> =>
    inTauri ? invoke('set_checklist_item_archived', { id, archived }) : mock.setChecklistItemArchived(id, archived),

  listCashFlows: (accountId: number): Promise<CashFlow[]> =>
    inTauri ? invoke('list_cash_flows', { accountId }) : mock.listCashFlows(accountId),
  createCashFlow: (cashFlow: NewCashFlow): Promise<CashFlow> =>
    inTauri ? invoke('create_cash_flow', { cashFlow }) : mock.createCashFlow(cashFlow),
  deleteCashFlow: (id: number): Promise<void> => (inTauri ? invoke('delete_cash_flow', { id }) : mock.deleteCashFlow(id)),

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

  /** Tableau de bord d'une période et de la précédente : tout est calculé par pulse-core. */
  getDashboard: (query: DashboardQuery): Promise<Dashboard> =>
    inTauri ? invoke('get_dashboard', { query }) : mock.getDashboard(query),
  getCalendar: (query: CalendarQuery): Promise<Calendar> =>
    inTauri ? invoke('get_calendar', { query }) : mock.getCalendar(query),
  getDayTrades: (accountIds: number[], day: string): Promise<DayTrade[]> =>
    inTauri ? invoke('get_day_trades', { accountIds, day }) : mock.getDayTrades(accountIds, day),

  /** `image` : fichier en base64 (ou URL `data:`). Renvoie le chemin relatif à mémoriser sur le trade. */
  saveScreenshot: (image: string): Promise<string> =>
    inTauri ? invoke('save_screenshot', { image }) : mock.saveScreenshot(image),
  /** Renvoie une URL `data:` affichable. */
  readScreenshot: (path: string): Promise<string> =>
    inTauri ? invoke('read_screenshot', { path }) : mock.readScreenshot(path),

  /** Boîte de dialogue « choisir un dossier ». `null` si l'utilisateur annule. */
  pickFolder: async (title: string): Promise<string | null> => {
    if (!inTauri) return mock.pickFolder()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title })
    return typeof picked === 'string' ? picked : null
  },
  /** Boîte de dialogue « enregistrer sous » pour un fichier CSV. */
  pickCsvPath: async (title: string, defaultName: string): Promise<string | null> => {
    if (!inTauri) return mock.pickCsvPath(defaultName)
    const { save } = await import('@tauri-apps/plugin-dialog')
    return save({ title, defaultPath: defaultName, filters: [{ name: 'CSV', extensions: ['csv'] }] })
  },
  /** Exporte les trades (tous les comptes si `accountIds` est vide) ; renvoie le nombre de trades écrits. */
  exportTradesCsv: (path: string, accountIds: number[] = []): Promise<number> =>
    inTauri ? invoke('export_trades_csv', { accountIds, path }) : mock.exportTradesCsv(path),
  createBackup: (destDir: string): Promise<BackupInfo> =>
    inTauri ? invoke('create_backup', { destDir }) : mock.createBackup(destDir),
  inspectBackup: (folder: string): Promise<BackupInfo> =>
    inTauri ? invoke('inspect_backup', { folder }) : mock.inspectBackup(folder),
  restoreBackup: (folder: string, confirmed: boolean): Promise<RestoreResult> =>
    inTauri ? invoke('restore_backup', { folder, confirmed }) : mock.restoreBackup(folder, confirmed),
  updateAccount: (id: number, account: AccountUpdate): Promise<Account> =>
    inTauri ? invoke('update_account', { id, account }) : mock.updateAccount(id, account),
  setAccountArchived: (id: number, archived: boolean): Promise<Account> =>
    inTauri ? invoke('set_account_archived', { id, archived }) : mock.setAccountArchived(id, archived),
}

