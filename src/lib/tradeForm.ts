import type {
  ChecklistAnswer,
  ChecklistItem,
  Direction,
  EmotionEntry,
  EmotionMoment,
  ExecutionType,
  PlanFollowed,
  Tag,
  TradeData,
  TradeView,
} from '../types/trade'
import { isPlainDecimal, isPositiveDecimal, normalizeDecimalInput } from './decimal'
import { fromLocalInput, toLocalInput, tzOffsetMinutes } from './tradeTime'

/** État du formulaire de trade : tout est saisi en texte, la conversion et les contrôles de forme sont ici. */
export interface TradeForm {
  accountId: number | null
  instrumentId: number | null
  direction: Direction
  entryTime: string
  exitTime: string
  sessionTagId: number | null
  /** true dès que le trader corrige la session déduite. */
  sessionManual: boolean
  timeframeTagId: number | null
  setupTagId: number | null
  marketTagId: number | null
  mistakeTagIds: number[]
  entryPrice: string
  exitPrice: string
  size: string
  plannedSl: string
  plannedTp: string
  fees: string
  actualSl: string
  actualTp: string
  priceAfterExit: string
  executionType: ExecutionType | null
  thesis: string
  conviction: number | null
  emotions: EmotionEntry[]
  planFollowed: PlanFollowed | null
  rating: number | null
  executionQuality: number | null
  postMortem: string
  screenshotPath: string | null
  /** règle → respectée ? (absent = pas de réponse) */
  ruleChecks: Record<number, boolean>
  /** élément de checklist → coché ? */
  checklist: Record<number, boolean>
  /** Réponses de checklist dont l'élément n'existe plus : conservées telles quelles. */
  legacyChecklist: ChecklistAnswer[]
}

export function emptyForm(accountId: number | null, now: number): TradeForm {
  return {
    accountId,
    instrumentId: null,
    direction: 'long',
    entryTime: toLocalInput(now),
    exitTime: '',
    sessionTagId: null,
    sessionManual: false,
    timeframeTagId: null,
    setupTagId: null,
    marketTagId: null,
    mistakeTagIds: [],
    entryPrice: '',
    exitPrice: '',
    size: '',
    plannedSl: '',
    plannedTp: '',
    fees: '',
    actualSl: '',
    actualTp: '',
    priceAfterExit: '',
    executionType: null,
    thesis: '',
    conviction: null,
    emotions: [],
    planFollowed: null,
    rating: null,
    executionQuality: null,
    postMortem: '',
    screenshotPath: null,
    ruleChecks: {},
    checklist: {},
    legacyChecklist: [],
  }
}

const text = (v: string | null | undefined) => v ?? ''

export function formFromTrade(t: TradeView, tags: Tag[], checklistItems: ChecklistItem[]): TradeForm {
  const kindOf = (id: number) => tags.find((g) => g.id === id)?.kind
  const one = (kind: string) => t.tagIds.find((id) => kindOf(id) === kind) ?? null
  const activeIds = new Set(checklistItems.map((i) => i.id))
  const checklist: Record<number, boolean> = {}
  const legacyChecklist: ChecklistAnswer[] = []
  for (const a of t.checklist) {
    if (a.itemId !== null && activeIds.has(a.itemId)) checklist[a.itemId] = a.checked
    else legacyChecklist.push(a)
  }
  return {
    accountId: t.accountId,
    instrumentId: t.instrumentId,
    direction: t.direction,
    entryTime: toLocalInput(t.entryTime),
    exitTime: t.exitTime != null ? toLocalInput(t.exitTime) : '',
    sessionTagId: one('session'),
    sessionManual: one('session') !== null,
    timeframeTagId: one('timeframe'),
    setupTagId: one('setup'),
    marketTagId: one('market_condition'),
    mistakeTagIds: t.tagIds.filter((id) => kindOf(id) === 'mistake'),
    entryPrice: t.entryPrice,
    exitPrice: text(t.exitPrice),
    size: t.size,
    plannedSl: text(t.plannedSl),
    plannedTp: text(t.plannedTp),
    fees: t.fees === '0' ? '' : t.fees,
    actualSl: text(t.actualSl),
    actualTp: text(t.actualTp),
    priceAfterExit: text(t.priceAfterExit),
    executionType: t.executionType ?? null,
    thesis: t.thesis,
    conviction: t.conviction ?? null,
    emotions: t.emotions,
    planFollowed: t.planFollowed ?? null,
    rating: t.rating ?? null,
    executionQuality: t.executionQuality ?? null,
    postMortem: t.postMortem,
    screenshotPath: t.screenshotPath ?? null,
    ruleChecks: Object.fromEntries(t.ruleChecks.map((c) => [c.ruleId, c.respected])),
    checklist,
    legacyChecklist,
  }
}

export type FormErrorCode =
  | 'account'
  | 'instrument'
  | 'entryTime'
  | 'exitTime'
  | 'entryPrice'
  | 'size'
  | 'exitPrice'
  | 'exitPair'
  | 'exitBeforeEntry'
  | 'plannedSl'
  | 'plannedTp'
  | 'actualSl'
  | 'actualTp'
  | 'fees'
  | 'priceAfterExit'

export type FormErrors = Partial<Record<FormErrorCode, true>>

export interface BuildContext {
  checklistItems: ChecklistItem[]
  /** Saisie rapide : la checklist n'est envoyée que si le trader y a répondu. */
  quick: boolean
  /** Pour les tests ; par défaut, le décalage réel de l'ordinateur. */
  tzOffsetMin?: number
}

/** Une valeur facultative : vide → null, sinon décimal normalisé ; `undefined` si la forme est invalide. */
function optional(value: string, allowNegative = false): string | null | undefined {
  const s = normalizeDecimalInput(value)
  if (s === '') return null
  return isPlainDecimal(s, { allowNegative }) ? s : undefined
}

export function buildTradeData(f: TradeForm, ctx: BuildContext): { data: TradeData | null; errors: FormErrors } {
  const errors: FormErrors = {}
  if (f.accountId === null) errors.account = true
  if (f.instrumentId === null) errors.instrument = true

  const entryTime = fromLocalInput(f.entryTime)
  if (entryTime === null) errors.entryTime = true
  if (!isPlainDecimal(f.entryPrice)) errors.entryPrice = true
  if (!isPositiveDecimal(f.size)) errors.size = true

  const exitPrice = optional(f.exitPrice)
  const exitTime = f.exitTime === '' ? null : fromLocalInput(f.exitTime)
  if (exitPrice === undefined) errors.exitPrice = true
  if (f.exitTime !== '' && exitTime === null) errors.exitTime = true
  if (!errors.exitPrice && !errors.exitTime && (exitPrice === null) !== (exitTime === null)) errors.exitPair = true
  if (entryTime !== null && exitTime !== null && exitTime < entryTime) errors.exitBeforeEntry = true

  const plannedSl = optional(f.plannedSl)
  const plannedTp = optional(f.plannedTp)
  const actualSl = optional(f.actualSl)
  const actualTp = optional(f.actualTp)
  const priceAfterExit = optional(f.priceAfterExit)
  const fees = optional(f.fees, true)
  if (plannedSl === undefined) errors.plannedSl = true
  if (plannedTp === undefined) errors.plannedTp = true
  if (actualSl === undefined) errors.actualSl = true
  if (actualTp === undefined) errors.actualTp = true
  if (priceAfterExit === undefined) errors.priceAfterExit = true
  if (fees === undefined) errors.fees = true

  if (Object.keys(errors).length > 0) return { data: null, errors }

  const items = ctx.quick ? ctx.checklistItems.filter((i) => i.id in f.checklist) : ctx.checklistItems
  const checklist: ChecklistAnswer[] = [
    ...items.map((i) => ({ itemId: i.id, label: i.label, checked: f.checklist[i.id] ?? false })),
    ...f.legacyChecklist,
  ]
  const tagIds = [f.setupTagId, f.marketTagId, f.timeframeTagId, f.sessionTagId, ...f.mistakeTagIds].filter(
    (id): id is number => id !== null,
  )

  return {
    errors,
    data: {
      accountId: f.accountId!,
      instrumentId: f.instrumentId!,
      direction: f.direction,
      size: normalizeDecimalInput(f.size),
      entryPrice: normalizeDecimalInput(f.entryPrice),
      exitPrice: exitPrice ?? null,
      entryTime: entryTime!,
      exitTime,
      tzOffsetMin: ctx.tzOffsetMin ?? tzOffsetMinutes(entryTime!),
      plannedSl: plannedSl ?? null,
      plannedTp: plannedTp ?? null,
      actualSl: actualSl ?? null,
      actualTp: actualTp ?? null,
      fees: fees ?? '0',
      priceAfterExit: priceAfterExit ?? null,
      executionType: f.executionType,
      rating: f.rating,
      conviction: f.conviction,
      executionQuality: f.executionQuality,
      planFollowed: f.planFollowed,
      thesis: f.thesis,
      postMortem: f.postMortem,
      screenshotPath: f.screenshotPath,
      tagIds,
      emotions: f.emotions,
      ruleChecks: Object.entries(f.ruleChecks).map(([id, respected]) => ({ ruleId: Number(id), respected })),
      checklist,
    },
  }
}

/** Ajoute ou retire une émotion à un moment donné. */
export function toggleEmotion(list: EmotionEntry[], moment: EmotionMoment, tagId: number): EmotionEntry[] {
  return list.some((e) => e.moment === moment && e.tagId === tagId)
    ? list.filter((e) => !(e.moment === moment && e.tagId === tagId))
    : [...list, { moment, tagId }]
}

/** Règle : pas de réponse → respectée → non respectée → pas de réponse. */
export function nextRuleState(current: boolean | undefined): boolean | undefined {
  return current === undefined ? true : current ? false : undefined
}
