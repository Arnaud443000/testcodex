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
import type {
  Calendar,
  CalendarQuery,
  Dashboard,
  DashboardQuery,
  DayTrade,
  Heatmap,
  LongShort,
  RDistribution,
  RiskReport,
  StatsQuery,
} from '../types/stats'
import type {
  BehaviorSettings,
  DisciplineReport,
  EmotionReport,
  FirstTradeReport,
  MistakeReport,
  PatternReport,
  PlanReport,
  RuleAdherenceReport,
  StreakReport,
  TradeDiscipline,
} from '../types/behavior'
import type {
  ConfidenceReport,
  DayOverview,
  ExecutionScore,
  JournalEntry,
  MissedTrade,
  MissedTradeData,
  PeriodQuery,
  QualityReport,
  ReminderDue,
  ReminderSettings,
} from '../types/journal'
import type { Goal, GoalProgress, NewGoal, ProgressQuery } from '../types/goals'
import type { ReplayCard, ReplayFilter, ReplayItem } from '../types/replay'
import { mock, mockGoalsReplay, mockJournal } from './mockBackend'
import type { AfterLossesReport, ExternalFactorReport, PlanSimulation, SizeChangeReport } from '../types/behavior'
import { mockBehaviorExtra } from './mockBackend'
import { createDashboardsMock } from './mockDashboards'
import type { DashboardLayout, DashboardSummary, WidgetDefinition, WidgetInstance } from '../types/dashboardLayout'

/**
 * Thin wrapper over the Tauri commands defined in src-tauri/src/lib.rs.
 * Outside Tauri (plain `npm run dev` in a browser) it falls back to an
 * in-memory mock (mockBackend.ts) so the UI can be developed and screenshotted without Rust.
 */
const mockDashboards = createDashboardsMock(async () => (await mock.listAccounts()).map((a) => a.id))
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

  /** Seuils de l'analyse comportementale (risque max, trades max par jour, revanche). */
  getBehaviorSettings: (): Promise<BehaviorSettings> =>
    inTauri ? invoke('get_behavior_settings') : mock.getBehaviorSettings(),
  setBehaviorSettings: (settings: BehaviorSettings): Promise<BehaviorSettings> =>
    inTauri ? invoke('set_behavior_settings', { settings }) : mock.setBehaviorSettings(settings),

  /** Analyse comportementale (lot 8) : un rapport par commande, tout est calculé par pulse-core. */
  getDiscipline: (query: StatsQuery): Promise<DisciplineReport> =>
    inTauri ? invoke('get_discipline', { query }) : mock.getDiscipline(query),
  getTradeDiscipline: (id: number): Promise<TradeDiscipline> =>
    inTauri ? invoke('get_trade_discipline', { id }) : mock.getTradeDiscipline(id),
  getEmotions: (query: StatsQuery): Promise<EmotionReport> =>
    inTauri ? invoke('get_emotions', { query }) : mock.getEmotions(query),
  getStreaks: (query: StatsQuery): Promise<StreakReport> =>
    inTauri ? invoke('get_streaks', { query }) : mock.getStreaks(query),
  getPlanComparison: (query: StatsQuery): Promise<PlanReport> =>
    inTauri ? invoke('get_plan_comparison', { query }) : mock.getPlanComparison(query),
  getFirstTrade: (query: StatsQuery): Promise<FirstTradeReport> =>
    inTauri ? invoke('get_first_trade', { query }) : mock.getFirstTrade(query),
  getMistakes: (query: StatsQuery): Promise<MistakeReport> =>
    inTauri ? invoke('get_mistakes', { query }) : mock.getMistakes(query),
  getRuleAdherence: (query: StatsQuery): Promise<RuleAdherenceReport> =>
    inTauri ? invoke('get_rule_adherence', { query }) : mock.getRuleAdherence(query),
  getPatterns: (query: StatsQuery): Promise<PatternReport> =>
    inTauri ? invoke('get_patterns', { query }) : mock.getPatterns(query),
  getRDistribution: (query: StatsQuery): Promise<RDistribution> =>
    inTauri ? invoke('get_r_distribution', { query }) : mock.getRDistribution(query),
  getHeatmap: (query: StatsQuery): Promise<Heatmap> =>
    inTauri ? invoke('get_heatmap', { query }) : mock.getHeatmap(query),
  getLongShort: (query: StatsQuery): Promise<LongShort> =>
    inTauri ? invoke('get_long_short', { query }) : mock.getLongShort(query),
  getRisk: (query: StatsQuery): Promise<RiskReport> =>
    inTauri ? invoke('get_risk', { query }) : mock.getRisk(query),

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

  // --- Lot 10 : trades manqués, journal quotidien, qualité d'exécution, confiance, rappel ---
  listMissedTrades: (accountIds: number[] = []): Promise<MissedTrade[]> =>
    inTauri ? invoke('list_missed_trades', { accountIds }) : mockJournal.listMissedTrades(accountIds),
  createMissedTrade: (missed: MissedTradeData): Promise<MissedTrade> =>
    inTauri ? invoke('create_missed_trade', { missed }) : mockJournal.createMissedTrade(missed),
  updateMissedTrade: (id: number, missed: MissedTradeData): Promise<MissedTrade> =>
    inTauri ? invoke('update_missed_trade', { id, missed }) : mockJournal.updateMissedTrade(id, missed),
  deleteMissedTrade: (id: number): Promise<void> =>
    inTauri ? invoke('delete_missed_trade', { id }) : mockJournal.deleteMissedTrade(id),

  /** Un journal entièrement vide est supprimé au lieu d'être enregistré : renvoie alors `null`. */
  saveJournalEntry: (entry: JournalEntry): Promise<JournalEntry | null> =>
    inTauri ? invoke('save_journal_entry', { entry }) : mockJournal.saveJournalEntry(entry),
  /** Le journal d'un jour local (« AAAA-MM-JJ ») et les trades entrés ce jour-là. */
  getJournalDay: (accountIds: number[], day: string): Promise<DayOverview> =>
    inTauri ? invoke('get_journal_day', { accountIds, day }) : mockJournal.getJournalDay(accountIds, day),
  listJournalEntries: (from?: string | null, to?: string | null): Promise<JournalEntry[]> =>
    inTauri ? invoke('list_journal_entries', { from: from ?? null, to: to ?? null }) : mockJournal.listJournalEntries(from, to),
  deleteJournalEntry: (day: string): Promise<void> =>
    inTauri ? invoke('delete_journal_entry', { day }) : mockJournal.deleteJournalEntry(day),

  /** Score de qualité d'exécution d'un trade enregistré (calculé par pulse-core). */
  getExecutionScore: (tradeId: number): Promise<ExecutionScore> =>
    inTauri ? invoke('get_execution_score', { tradeId }) : mockJournal.getExecutionScore(tradeId),
  getQualityReport: (query: PeriodQuery): Promise<QualityReport> =>
    inTauri ? invoke('get_quality_report', { query }) : mockJournal.getQualityReport(query),
  getConfidenceReport: (query: PeriodQuery): Promise<ConfidenceReport> =>
    inTauri ? invoke('get_confidence_report', { query }) : mockJournal.getConfidenceReport(query),

  getReminderSettings: (): Promise<ReminderSettings> =>
    inTauri ? invoke('get_reminder_settings') : mockJournal.getReminderSettings(),
  setReminderSettings: (settings: ReminderSettings): Promise<ReminderSettings> =>
    inTauri ? invoke('set_reminder_settings', { settings }) : mockJournal.setReminderSettings(settings),
  /** Le rappel a déjà été envoyé aujourd'hui et il reste du travail : sert à la bannière dans l'application. */
  getReminderPending: (tzOffsetMin: number): Promise<ReminderDue | null> =>
    inTauri ? invoke('get_reminder_pending', { tzOffsetMin }) : mockJournal.getReminderPending(tzOffsetMin),

  // --- Lot 11 : objectifs mensuels et replay ---
  listGoals: (month: string): Promise<Goal[]> => (inTauri ? invoke('list_goals', { month }) : mockGoalsReplay.listGoals(month)),
  /** Crée l'objectif d'un mois et d'une métrique, ou change sa cible. */
  setGoal: (goal: NewGoal): Promise<Goal> => (inTauri ? invoke('set_goal', { goal }) : mockGoalsReplay.setGoal(goal)),
  deleteGoal: (id: number): Promise<void> => (inTauri ? invoke('delete_goal', { id }) : mockGoalsReplay.deleteGoal(id)),
  /** Reporte les objectifs d'un mois sur un autre (sans écraser ceux qui existent déjà). */
  copyGoals: (from: string, to: string): Promise<Goal[]> => (inTauri ? invoke('copy_goals', { from, to }) : mockGoalsReplay.copyGoals(from, to)),
  getGoalProgress: (query: ProgressQuery): Promise<GoalProgress[]> =>
    inTauri ? invoke('get_goal_progress', { query }) : mockGoalsReplay.getGoalProgress(query),

  listReplay: (filter?: ReplayFilter): Promise<ReplayItem[]> =>
    inTauri ? invoke('list_replay', { filter: filter ?? null }) : mockGoalsReplay.listReplay(filter),
  getReplayCard: (id: number): Promise<ReplayCard> => (inTauri ? invoke('get_replay_card', { id }) : mockGoalsReplay.getReplayCard(id)),

  // --- Lot 8 bis : compléments de l'analyse comportementale (aucune causalité affirmée) ---
  /** Facteurs du journal quotidien (sommeil, fatigue, heure tardive, humeur) : jours avec / sans. */
  getExternalFactors: (query: StatsQuery): Promise<ExternalFactorReport> =>
    inTauri ? invoke('get_external_factors', { query }) : mockBehaviorExtra.getExternalFactors(query),
  /** Trades entrés après deux pertes consécutives du même compte, comparés aux autres. */
  getAfterLosses: (query: StatsQuery): Promise<AfterLossesReport> =>
    inTauri ? invoke('get_after_losses', { query }) : mockBehaviorExtra.getAfterLosses(query),
  /** Variation d'exposition par rapport au trade précédent, selon son résultat. */
  getSizeChange: (query: StatsQuery): Promise<SizeChangeReport> =>
    inTauri ? invoke('get_size_change', { query }) : mockBehaviorExtra.getSizeChange(query),
  /** Simulation sans les trades hors plan : à étiqueter comme une simulation, jamais un conseil. */
  getPlanSimulation: (query: StatsQuery): Promise<PlanSimulation> =>
    inTauri ? invoke('get_plan_simulation', { query }) : mockBehaviorExtra.getPlanSimulation(query),

  // --- Lot 13 : dashboard personnalisable (disposition seulement ; les chiffres viennent des commandes ci-dessus) ---
  listWidgetCatalog: (): Promise<WidgetDefinition[]> => (inTauri ? invoke('list_widget_catalog') : mockDashboards.listWidgetCatalog()),
  listDashboardLayouts: (): Promise<DashboardSummary[]> => (inTauri ? invoke('list_dashboard_layouts') : mockDashboards.listDashboardLayouts()),
  getDashboardLayout: (key: string): Promise<DashboardLayout> =>
    inTauri ? invoke('get_dashboard_layout', { key }) : mockDashboards.getDashboardLayout(key),
  /** Le dashboard affiché au démarrage : « Essentiel » tant qu'aucun autre n'est choisi par défaut. */
  getStartupDashboard: (): Promise<DashboardLayout> => (inTauri ? invoke('get_startup_dashboard') : mockDashboards.getStartupDashboard()),
  /** `key` `null` ou d'un preset : crée un dashboard de l'utilisateur ; sinon remplace le sien. */
  saveDashboardLayout: (key: string | null, name: string, widgets: WidgetInstance[]): Promise<DashboardLayout> =>
    inTauri ? invoke('save_dashboard_layout', { key, name, widgets }) : mockDashboards.saveDashboardLayout(key, name, widgets),
  renameDashboardLayout: (key: string, name: string): Promise<DashboardLayout> =>
    inTauri ? invoke('rename_dashboard_layout', { key, name }) : mockDashboards.renameDashboardLayout(key, name),
  deleteDashboardLayout: (key: string): Promise<void> =>
    inTauri ? invoke('delete_dashboard_layout', { key }) : mockDashboards.deleteDashboardLayout(key),
  setDefaultDashboardLayout: (key: string): Promise<DashboardLayout> =>
    inTauri ? invoke('set_default_dashboard_layout', { key }) : mockDashboards.setDefaultDashboardLayout(key),
}
