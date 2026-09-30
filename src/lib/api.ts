import type { Account, AccountUpdate, AppInfo, CashFlow, NewAccount, NewCashFlow } from '../types/account'
import type {
  ChecklistItem,
  Instrument,
  NewInstrument,
  Preview,
  Rule,
  Tag,
  EmotionCatalogGroup,
  EmotionUsage,
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
import type { AssetRow, ExecutionReport, FeeGranularity, FeeReport, StrategyRow } from '../types/stats'
import type { AccountComparison, ExposureReport, RiskBenchmark } from '../types/stats'
import { mockComparisons } from './mockBackend'
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
import { mockAnalyses, mockBehaviorExtra } from './mockBackend'
import { createDashboardsMock } from './mockDashboards'
import type { DashboardLayout, DashboardScope, DashboardSummary, ImportResult, ResolvedDashboard, WidgetDefinition, WidgetInstance } from '../types/dashboardLayout'

/**
 * Thin wrapper over the Tauri commands defined in src-tauri/src/lib.rs.
 * Outside Tauri (plain `npm run dev` in a browser) it falls back to an
 * in-memory mock (mockBackend.ts) so the UI can be developed and screenshotted without Rust.
 */
const mockDashboards = createDashboardsMock(() => mock.listAccounts())
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Lot 22 : appelés quand une commande répond `lock:locked` (Pulse s'est verrouillé entre-temps). */
const lockedListeners = new Set<() => void>()
export function onLockedError(listener: () => void): () => void {
  lockedListeners.add(listener)
  return () => lockedListeners.delete(listener)
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    if (isLockedError(e)) lockedListeners.forEach((f) => f())
    throw e
  }
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
  /** « Ma liste » d'émotions (lot 30) : retirer = archiver, supprimer seulement si jamais utilisée. */
  getEmotionCatalog: (): Promise<EmotionCatalogGroup[]> => (inTauri ? invoke('get_emotion_catalog') : mock.getEmotionCatalog()),
  getEmotionUsage: (): Promise<EmotionUsage[]> => (inTauri ? invoke('get_emotion_usage') : mock.getEmotionUsage()),
  addEmotionToList: (name: string): Promise<Tag> =>
    inTauri ? invoke('add_emotion_to_list', { name }) : mock.addEmotionToList(name),
  removeEmotionFromList: (tagId: number): Promise<Tag> =>
    inTauri ? invoke('remove_emotion_from_list', { tagId }) : mock.removeEmotionFromList(tagId),
  deleteUnusedEmotion: (tagId: number): Promise<void> =>
    inTauri ? invoke('delete_unused_emotion', { tagId }) : mock.deleteUnusedEmotion(tagId),

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
  /** `password` : seulement pour une sauvegarde chiffrée (lot 22), celui du moment où elle a été faite. */
  inspectBackup: (folder: string, password?: string): Promise<BackupInfo> =>
    inTauri ? invoke('inspect_backup', { folder, password: password ?? null }) : mock.inspectBackup(folder, password),
  restoreBackup: (folder: string, confirmed: boolean, password?: string): Promise<RestoreResult> =>
    inTauri ? invoke('restore_backup', { folder, confirmed, password: password ?? null }) : mock.restoreBackup(folder, confirmed, password),
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

  // --- Lot 12 : alertes à seuils (garde-fous, 3.6) ---
  /** Alertes actives maintenant (comptes actifs si la liste est vide), sans celles déjà masquées. */
  getActiveAlerts: (accountIds: number[], tzOffsetMin: number): Promise<Alert[]> =>
    inTauri ? invoke('get_active_alerts', { accountIds, tzOffsetMin }) : mockAlerts.getActiveAlerts(accountIds, tzOffsetMin),
  /** Masque une alerte pour de bon : elle ne revient jamais sous le même identifiant. */
  dismissAlert: (alertId: string): Promise<void> => (inTauri ? invoke('dismiss_alert', { alertId }) : mockAlerts.dismissAlert(alertId)),
  getAlertHistory: (accountIds: number[], limit?: number): Promise<AlertRecord[]> =>
    inTauri ? invoke('get_alert_history', { accountIds, limit: limit ?? null }) : mockAlerts.getAlertHistory(accountIds, limit),
  /** Seuils alerts.* ; la limite de trades par jour et la revanche sont dans get/setBehaviorSettings. */
  getAlertSettings: (): Promise<AlertSettings> => (inTauri ? invoke('get_alert_settings') : mockAlerts.getAlertSettings()),
  setAlertSettings: (settings: AlertSettings): Promise<AlertSettings> =>
    inTauri ? invoke('set_alert_settings', { settings }) : mockAlerts.setAlertSettings(settings),

  // --- Lot 14 : analyses d'étape 3 ---
  /** Performance par instrument (3.3.13). */
  getAssetReport: (query: StatsQuery): Promise<AssetRow[]> =>
    inTauri ? invoke('get_asset_report', { query }) : mockAnalyses.getAssetReport(query),
  /** Frais et commissions : courbe cumulée et tableau par jour / semaine / mois (3.3.15). */
  getFeeReport: (query: StatsQuery, granularity: FeeGranularity = 'month'): Promise<FeeReport> =>
    inTauri ? invoke('get_fee_report', { query, granularity }) : mockAnalyses.getFeeReport(query, granularity),
  /** Stratégies côte à côte : une stratégie = un tag « setup » (3.3.16). */
  getStrategyReport: (query: StatsQuery): Promise<StrategyRow[]> =>
    inTauri ? invoke('get_strategy_report', { query }) : mockAnalyses.getStrategyReport(query),
  /** Système contre discrétionnaire, d'après le type du trade (3.3.17). */
  getExecutionReport: (query: StatsQuery): Promise<ExecutionReport> =>
    inTauri ? invoke('get_execution_report', { query }) : mockAnalyses.getExecutionReport(query),

  // --- Lot 13 : dashboard personnalisable (disposition seulement ; les chiffres viennent des commandes ci-dessus) ---
  listWidgetCatalog: (): Promise<WidgetDefinition[]> => (inTauri ? invoke('list_widget_catalog') : mockDashboards.listWidgetCatalog()),
  listDashboardLayouts: (): Promise<DashboardSummary[]> => (inTauri ? invoke('list_dashboard_layouts') : mockDashboards.listDashboardLayouts()),
  getDashboardLayout: (key: string): Promise<DashboardLayout> =>
    inTauri ? invoke('get_dashboard_layout', { key }) : mockDashboards.getDashboardLayout(key),
  /** Le dashboard affiché au démarrage : « Essentiel » tant qu'aucun autre n'est choisi par défaut. */
  getStartupDashboard: (): Promise<DashboardLayout> => (inTauri ? invoke('get_startup_dashboard') : mockDashboards.getStartupDashboard()),
  /** `key` `null` ou d'un preset : crée un dashboard de l'utilisateur ; sinon remplace le sien. */
  saveDashboardLayout: (key: string | null, name: string, widgets: WidgetInstance[], scope: DashboardScope | null = null): Promise<DashboardLayout> =>
    inTauri ? invoke('save_dashboard_layout', { key, name, widgets, scope }) : mockDashboards.saveDashboardLayout(key, name, widgets, scope),
  renameDashboardLayout: (key: string, name: string): Promise<DashboardLayout> =>
    inTauri ? invoke('rename_dashboard_layout', { key, name }) : mockDashboards.renameDashboardLayout(key, name),
  deleteDashboardLayout: (key: string): Promise<void> =>
    inTauri ? invoke('delete_dashboard_layout', { key }) : mockDashboards.deleteDashboardLayout(key),
  setDefaultDashboardLayout: (key: string): Promise<DashboardLayout> =>
    inTauri ? invoke('set_default_dashboard_layout', { key }) : mockDashboards.setDefaultDashboardLayout(key),

  // --- Lot 16 : analyses complémentaires ---
  /** Coût d'opportunité : gains laissés sur la table d'après le TP prévu et le prix après sortie saisi (3.3.18). */
  getOpportunityReport: (query: StatsQuery): Promise<OpportunityReport> =>
    inTauri ? invoke('get_opportunity_report', { query }) : mockAnalysesMore.getOpportunityReport(query),
  /** Même période un an plus tôt, avec les écarts du tableau de bord (3.3.19). */
  getYearComparison: (query: YearComparisonQuery): Promise<YearComparison> =>
    inTauri ? invoke('get_year_comparison', { query }) : mockAnalysesMore.getYearComparison(query),
  /** Durée moyenne et médiane des gagnants contre les perdants (3.3.20). */
  getDurationReport: (query: StatsQuery): Promise<DurationReport> =>
    inTauri ? invoke('get_duration_report', { query }) : mockAnalysesMore.getDurationReport(query),
  /** Le risque pris suit-il le capital ? Risque en % du solde, moitié ancienne contre moitié récente (3.3.21). */
  getScalingReport: (query: StatsQuery): Promise<ScalingReport> =>
    inTauri ? invoke('get_scaling_report', { query }) : mockAnalysesMore.getScalingReport(query),
  // (fin lot 16)
  // --- Lot 17 : comparaisons et exposition ---
  /** Comptes côte à côte (3.7.6) ; chaque compte est calculé seul, les devises peuvent différer. */
  getAccountComparison: (query: StatsQuery): Promise<AccountComparison> =>
    inTauri ? invoke('get_account_comparison', { query }) : mockComparisons.getAccountComparison(query),
  /** Risque pris trade par trade contre la limite « risque max » (3.4.11). */
  getRiskBenchmark: (query: StatsQuery): Promise<RiskBenchmark> =>
    inTauri ? invoke('get_risk_benchmark', { query }) : mockComparisons.getRiskBenchmark(query),
  /** Répartition du risque pris par catégorie d'actif (3.7.9). */
  getExposureReport: (query: StatsQuery): Promise<ExposureReport> =>
    inTauri ? invoke('get_exposure_report', { query }) : mockComparisons.getExposureReport(query),
  // --- Lot 18 : portée d'un dashboard (3.8.9) ---
  /** Change ce que lit un dashboard de l'utilisateur : barre du haut, un compte, ou tous les comptes. */
  setDashboardScope: (key: string, scope: DashboardScope): Promise<DashboardLayout> =>
    inTauri ? invoke('set_dashboard_scope', { key, scope }) : mockDashboards.setDashboardScope(key, scope),
  /** Comptes réellement lus par le dashboard et par chaque widget (`widgets` peut être un brouillon). */
  resolveDashboardScope: (scope: DashboardScope, widgets: WidgetInstance[], selectedAccountId: number | null): Promise<ResolvedDashboard> =>
    inTauri
      ? invoke('resolve_dashboard_scope', { scope, widgets, selectedAccountId })
      : mockDashboards.resolveDashboardScope(scope, widgets, selectedAccountId),

  // --- Lot 18 : duplication, export et import de configuration (3.8.7) ---
  /** Copie un dashboard (livré ou à soi) comme point de départ ; sans nom : « <nom> (copie) ». */
  duplicateDashboardLayout: (key: string, name: string | null = null): Promise<DashboardLayout> =>
    inTauri ? invoke('duplicate_dashboard_layout', { key, name }) : mockDashboards.duplicateDashboardLayout(key, name),
  /** Écrit la configuration d'un dashboard (JSON versionné) au chemin choisi. */
  exportDashboardConfig: (key: string, path: string): Promise<void> =>
    inTauri ? invoke('export_dashboard_config', { key, path }) : mockDashboards.exportDashboardConfig(key, path),
  /** Importe une configuration : tout ou rien, jamais d'écrasement. Les erreurs portent un code `dashboard_import:…`. */
  importDashboardConfig: (path: string): Promise<ImportResult> =>
    inTauri ? invoke('import_dashboard_config', { path }) : mockDashboards.importDashboardConfig(path),
  /** Boîte de dialogue « enregistrer sous » d'un fichier de configuration (`null` si annulée). */
  pickConfigSavePath: async (title: string, defaultName: string): Promise<string | null> => {
    if (!inTauri) return mockDashboards.pickExportPath(defaultName)
    const { save } = await import('@tauri-apps/plugin-dialog')
    return save({ title, defaultPath: defaultName, filters: [{ name: 'Configuration Pulse (JSON)', extensions: ['json'] }] })
  },
  /** Boîte de dialogue « ouvrir » d'un fichier de configuration (`null` si annulée). */
  pickConfigOpenPath: async (title: string): Promise<string | null> => {
    if (!inTauri) return mockDashboards.pickImportPath()
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ title, multiple: false, directory: false, filters: [{ name: 'Configuration Pulse (JSON)', extensions: ['json'] }] })
    return typeof picked === 'string' ? picked : null
  },
  // --- Lot 19 : insights automatiques (déterministes, calculés localement, sans IA) ---
  /** Insights de maintenant (comptes actifs si la liste est vide), chaque compte seul ; masqués omis sauf `includeDismissed`. */
  getInsights: (accountIds: number[], tzOffsetMin: number, includeDismissed = false): Promise<Insight[]> =>
    inTauri ? invoke('get_insights', { accountIds, tzOffsetMin, includeDismissed }) : mockInsights.getInsights(accountIds, tzOffsetMin, includeDismissed),
  /** Masque un insight : il ne revient que si la situation s'aggrave ou dans un nouvel épisode. */
  dismissInsight: (insightId: string): Promise<void> => (inTauri ? invoke('dismiss_insight', { insightId }) : mockInsights.dismissInsight(insightId)),
  getInsightHistory: (accountIds: number[], limit?: number): Promise<InsightRecord[]> =>
    inTauri ? invoke('get_insight_history', { accountIds, limit: limit ?? null }) : mockInsights.getInsightHistory(accountIds, limit),

  // --- Lot 20 : IA optionnelle (réseau seulement dans pulse-ai, à la demande ; simulation dans le navigateur) ---
  /** Réglages de l'IA et état du coffre : l'interface sait seulement si une clé est enregistrée, jamais laquelle. */
  getAiStatus: (): Promise<AiStatus> => (inTauri ? invoke('get_ai_status') : mockAi.getAiStatus()),
  /** Éteindre l'IA oublie le consentement de première utilisation. */
  setAiSettings: (settings: AiSettingsUpdate): Promise<AiStatus> =>
    inTauri ? invoke('set_ai_settings', { settings }) : mockAi.setAiSettings(settings),
  recordAiConsent: (): Promise<AiStatus> => (inTauri ? invoke('record_ai_consent') : mockAi.recordAiConsent()),
  /** Enregistre ou remplace la clé dans le coffre Windows ; l'erreur ne répète jamais la clé. */
  saveAiKey: (key: string): Promise<AiStatus> => (inTauri ? invoke('save_ai_key', { key }) : mockAi.saveAiKey(key)),
  deleteAiKey: (): Promise<AiStatus> => (inTauri ? invoke('delete_ai_key') : mockAi.deleteAiKey()),
  /** Vérifie la clé et le modèle ; n'envoie aucune donnée de trading. */
  testAiConnection: (): Promise<void> => (inTauri ? invoke('test_ai_connection') : mockAi.testAiConnection()),
  /** Ce qui partirait pour ce trade, calculé par pulse-core et montré tel quel avant l'envoi. */
  previewScreenshotAnalysis: (tradeId: number): Promise<AiSendPreview> =>
    inTauri ? invoke('preview_screenshot_analysis', { tradeId }) : mockAi.previewScreenshotAnalysis(tradeId),
  /** À la demande, après confirmation. Erreurs : codes `ai:…` (voir `aiErrorMessage`). */
  analyzeScreenshot: (tradeId: number, confirmed: boolean): Promise<ScreenshotNote> =>
    inTauri ? invoke('analyze_screenshot', { tradeId, confirmed }) : mockAi.analyzeScreenshot(tradeId, confirmed),
  listScreenshotNotes: (tradeId: number): Promise<ScreenshotNote[]> =>
    inTauri ? invoke('list_screenshot_notes', { tradeId }) : mockAi.listScreenshotNotes(tradeId),
  deleteScreenshotNote: (id: number): Promise<void> =>
    inTauri ? invoke('delete_screenshot_note', { id }) : mockAi.deleteScreenshotNote(id),

  // --- Lot 21 : coach IA (outils locaux en lecture seule ; réseau seulement dans pulse-ai ; simulation dans le navigateur) ---
  getCoachStatus: (): Promise<CoachStatus> => (inTauri ? invoke('get_coach_status') : mockCoach.getCoachStatus()),
  /** Consentement propre au coach (distinct de celui de l'analyse de screenshot). */
  recordCoachConsent: (): Promise<CoachStatus> => (inTauri ? invoke('record_coach_consent') : mockCoach.recordCoachConsent()),
  /** À la demande, après le clic sur « Envoyer ». Erreurs : codes `ai:…` (voir `aiErrorMessage`). */
  askCoach: (r: AskCoachRequest): Promise<CoachTurn> => (inTauri ? invoke('ask_coach', { ...r }) : mockCoach.askCoach(r)),
  listCoachConversations: (): Promise<ConversationSummary[]> =>
    inTauri ? invoke('list_coach_conversations') : mockCoach.listCoachConversations(),
  getCoachConversation: (id: number): Promise<Conversation> =>
    inTauri ? invoke('get_coach_conversation', { id }) : mockCoach.getCoachConversation(id),
  renameCoachConversation: (id: number, title: string): Promise<ConversationSummary> =>
    inTauri ? invoke('rename_coach_conversation', { id, title }) : mockCoach.renameCoachConversation(id, title),
  deleteCoachConversation: (id: number): Promise<void> =>
    inTauri ? invoke('delete_coach_conversation', { id }) : mockCoach.deleteCoachConversation(id),
  deleteAllCoachConversations: (): Promise<number> =>
    inTauri ? invoke('delete_all_coach_conversations') : mockCoach.deleteAllCoachConversations(),

  // --- Lot 22 : verrouillage par mot de passe (simulation sans chiffrement dans le navigateur) ---
  // Les mots de passe ne font que passer : jamais gardés dans un état global ni dans localStorage.
  /** Disponible même verrouillé (écran de déverrouillage). */
  getLockStatus: (): Promise<LockStatus> => (inTauri ? invoke('get_lock_status') : mockLock.status()),
  unlockDatabase: (password: string): Promise<LockStatus> => (inTauri ? invoke('unlock_database', { password }) : mockLock.unlock(password)),
  /** `confirmed` : case « J'ai compris » (mot de passe perdu = données irrécupérables), vérifiée aussi par pulse-core. */
  enableLock: (password: string, confirmed: boolean, encryptCopies: boolean): Promise<LockStatus> =>
    inTauri ? invoke('enable_lock', { password, confirmed, encryptCopies }) : mockLock.enable(password, confirmed, encryptCopies),
  disableLock: (password: string): Promise<LockStatus> => (inTauri ? invoke('disable_lock', { password }) : mockLock.disable(password)),
  changeLockPassword: (oldPassword: string, newPassword: string): Promise<LockStatus> =>
    inTauri ? invoke('change_lock_password', { oldPassword, newPassword }) : mockLock.changePassword(oldPassword, newPassword),
  lockNow: (): Promise<LockStatus> => (inTauri ? invoke('lock_now') : mockLock.lockNow()),
  /** `null` = jamais (défaut). */
  setLockIdle: (minutes: number | null): Promise<LockStatus> => (inTauri ? invoke('set_lock_idle', { minutes }) : mockLock.setIdle(minutes)),
  /** Activité de l'utilisateur (clavier, souris), signalée au plus toutes les 30 s. */
  lockTouch: (): Promise<void> => (inTauri ? invoke('lock_touch') : mockLock.touch()),
  retryPersist: (): Promise<LockStatus> => (inTauri ? invoke('retry_persist') : mockLock.retryPersist()),
  quitDiscardingChanges: (): Promise<void> => (inTauri ? invoke('quit_discarding_changes') : Promise.resolve()),
  /** Événements de la coque : verrouillage (manuel ou inactivité) et échec d'écriture. Rien dans le navigateur. */
  onLockEvents: async (onLocked: () => void, onPersistFailed: () => void): Promise<() => void> => {
    if (!inTauri) return () => {}
    const { listen } = await import('@tauri-apps/api/event')
    const offs = await Promise.all([listen('pulse://locked', onLocked), listen('pulse://persist-failed', onPersistFailed)])
    return () => offs.forEach((off) => off())
  },
  // --- Lot 23 : export PDF d'un bilan de période (simulation dans le navigateur : aucun fichier) ---
  /** Boîte de dialogue « enregistrer sous » pour un fichier PDF. */
  pickPdfPath: async (title: string, defaultName: string): Promise<string | null> => {
    if (!inTauri) return `(dossier de démonstration)/${defaultName}`
    const { save } = await import('@tauri-apps/plugin-dialog')
    return save({ title, defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  },
  /** `overwrite = false` : un fichier existant est refusé (`pdf:fileExists`), l'interface demande alors confirmation. */
  exportPeriodPdf: (req: PdfExportRequest, path: string, overwrite = false): Promise<PdfExport> =>
    inTauri
      ? invoke('export_period_pdf', {
          accountIds: [req.accountId],
          from: req.from,
          to: req.to,
          includeAccountName: req.includeAccountName,
          tzOffsetMin: req.tzOffsetMin,
          path,
          overwrite,
        })
      : mockPdf.exportPeriodPdf(req, path, overwrite),
  // --- Lot 27 : calculateur de taille de position (un refus est une donnée : `status: 'refused'` + code traduisible) ---
  calculatePositionSize: (request: SizingRequest): Promise<SizingOutcome> =>
    inTauri ? invoke('calculate_position_size', { request }) : mockSizing.calculatePositionSize(request),

  // --- Lot 25 : calendrier économique (réseau seulement dans pulse-news ; simulation dans le navigateur) ---
  getNewsStatus: (): Promise<NewsStatus> => (inTauri ? invoke('get_news_status') : mockNews.getNewsStatus()),
  setNewsSettings: (settings: NewsSettings): Promise<NewsStatus> =>
    inTauri ? invoke('set_news_settings', { settings }) : mockNews.setNewsSettings(settings),
  /** Fichier local ICS ou CSV (aucun réseau). */
  importNewsFile: (format: NewsFileFormat, path: string, defaults: NewsDefaults): Promise<ImportSummary> =>
    inTauri ? invoke('import_news_file', { format, path, defaults }) : mockNews.importNewsFile(format, path, defaults),
  /** `manual` : bouton « Actualiser » (au plus toutes les 5 min) ; sinon l'appel de l'ouverture (au plus une fois par jour). Erreurs : `news:…`. */
  refreshNews: (manual: boolean): Promise<NewsRefresh> => (inTauri ? invoke('refresh_news', { manual }) : mockNews.refreshNews(manual)),
  getNewsCalendar: (view: CalendarView, filter: NewsFilter): Promise<NewsCalendar> =>
    inTauri ? invoke('get_news_calendar', { view, filter }) : mockNews.getNewsCalendar(view, filter),
  getUpcomingNews: (limit: number, importances: Importance[]): Promise<EconomicEvent[]> =>
    inTauri ? invoke('get_upcoming_news', { limit, importances }) : mockNews.getUpcomingNews(limit, importances),
  clearNewsEvents: (): Promise<number> => (inTauri ? invoke('clear_news_events') : mockNews.clearNewsEvents()),
  /** Lot 28 : interroge la source saisie (non enregistrée) sans rien stocker ; compte dans le délai de 5 min. */
  testNewsSource: (settings: NewsSettings): Promise<NewsPreview> =>
    inTauri ? invoke('test_news_source', { settings }) : mockNews.testNewsSource(settings),
  /** Enregistre les événements du dernier test, une fois ses réglages enregistrés (`news:previewOutdated` sinon). */
  keepTestedNews: (): Promise<NewsRefresh> => (inTauri ? invoke('keep_tested_news') : mockNews.keepTestedNews()),
  // --- Lot 33 : suivi d'un compte prop firm (trades clôturés seulement ; refus codés `prop:<code>[:<champ>]`) ---
  /** Règles d'un compte prop (`null` = aucune) ; refusé pour un compte qui n'est pas de type prop. */
  getPropRules: (accountId: number): Promise<PropRules | null> =>
    inTauri ? invoke('get_prop_rules', { accountId }) : mockProp.getPropRules(accountId),
  setPropRules: (accountId: number, rules: PropRulesInput): Promise<PropRules> =>
    inTauri ? invoke('set_prop_rules', { accountId, rules }) : mockProp.setPropRules(accountId, rules),
  deletePropRules: (accountId: number): Promise<void> =>
    inTauri ? invoke('delete_prop_rules', { accountId }) : mockProp.deletePropRules(accountId),
  /** État à l'instant lu par la coque (`null` = aucune règle). Le jour de trading vient des règles de la firme, pas du PC. */
  getPropStatus: (accountId: number): Promise<PropStatus | null> =>
    inTauri ? invoke('get_prop_status', { accountId, tzOffsetMin: -new Date().getTimezoneOffset() }) : mockProp.getPropStatus(accountId),
  /** Réglage `alerts.prop` (activé par défaut). */
  setPropAlerts: (enabled: boolean): Promise<boolean> => (inTauri ? invoke('set_prop_alerts', { enabled }) : mockProp.setPropAlerts(enabled)),
  /** Boîte de dialogue « ouvrir » d'un calendrier (`null` si annulée). */
  pickNewsFile: async (title: string, format: NewsFileFormat): Promise<string | null> => {
    if (!inTauri) return `simulation.${format}`
    const { open } = await import('@tauri-apps/plugin-dialog')
    const filter = format === 'ics' ? { name: 'Calendrier (ICS)', extensions: ['ics', 'ical'] } : { name: 'CSV', extensions: ['csv', 'txt'] }
    const picked = await open({ title, multiple: false, directory: false, filters: [filter] })
    return typeof picked === 'string' ? picked : null
  },
  isBrowserPreview: !inTauri,

  // --- Lot 24 : carte de trade (3.7.7) ---
  /** R, rendement en % et P&L net d'un trade (jamais un solde), calculés par pulse-core. */
  getTradeCardFigures: (tradeId: number): Promise<TradeCardFigures> =>
    inTauri ? invoke('get_trade_card_figures', { tradeId }) : mockTradeCard.getTradeCardFigures(tradeId),
  /** Boîte de dialogue « enregistrer sous » d'une image PNG (`null` si annulée). Elle demande elle-même avant de remplacer un fichier. */
  pickPngPath: async (title: string, defaultName: string): Promise<string | null> => {
    if (!inTauri) return mockTradeCard.pickPngPath(defaultName)
    const { save } = await import('@tauri-apps/plugin-dialog')
    return save({ title, defaultPath: defaultName, filters: [{ name: 'PNG', extensions: ['png'] }] })
  },
  /** Écrit l'image (PNG en base64) à `path` ; renvoie la taille écrite en octets. */
  saveTradeCardImage: (path: string, image: string): Promise<number> =>
    inTauri ? invoke('save_trade_card_image', { path, image }) : mockTradeCard.saveTradeCardImage(path, image),
}


import type { Alert, AlertRecord, AlertSettings } from '../types/alerts'
import { mockAlerts } from './mockBackend'
import type { DurationReport, OpportunityReport, ScalingReport, YearComparison, YearComparisonQuery } from '../types/stats'
import { mockAnalysesMore } from './mockBackend'
import type { Insight, InsightRecord } from '../types/insights'
import { mockInsights } from './mockBackend'
import type { AiSendPreview, AiSettingsUpdate, AiStatus, ScreenshotNote } from '../types/ai'
import { mockAi } from './mockBackend'
import type { AskCoachRequest, CoachStatus, CoachTurn, Conversation, ConversationSummary } from '../types/coach'
import { mockCoach } from './mockBackend'
import type { LockStatus } from '../types/lock'
import { mockLock } from './mockBackend'
import { isLockedError } from './lockView'

import type { PdfExport, PdfExportRequest } from '../types/pdf'
import { mockPdf } from './mockBackend'
import type { TradeCardFigures } from '../types/tradeCard'
import { mockTradeCard } from './mockBackend'
import type { SizingOutcome, SizingRequest } from '../types/sizing'
import { mockSizing } from './mockBackend'
import type {
  CalendarView,
  EconomicEvent,
  ImportSummary,
  Importance,
  NewsCalendar,
  NewsDefaults,
  NewsFileFormat,
  NewsFilter,
  NewsPreview,
  NewsRefresh,
  NewsSettings,
  NewsStatus,
} from '../types/news'
import { mockNews } from './mockBackend'
import type { PropRules, PropRulesInput, PropStatus } from '../types/prop'
import { mockProp } from './mockBackend'
