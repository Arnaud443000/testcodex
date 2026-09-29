import type { Direction } from '../types/trade'
import type { RiskMode, Sizing, SizingRequest } from '../types/sizing'
import type { TradeForm } from './tradeForm'
import { isPlainDecimal, normalizeDecimalInput } from './decimal'

/**
 * Formulaire du calculateur de taille (lot 27) : saisie en texte, contrôles de FORME seulement.
 * Aucun calcul ici : la taille, le risque et les refus viennent de pulse-core (`sizing.rs`).
 */
export interface SizingForm {
  accountId: number | null
  instrumentId: number | null
  direction: Direction
  entry: string
  stop: string
  takeProfit: string
  riskMode: RiskMode
  riskValue: string
  /** Vide = multiplicateur de l'actif. */
  multiplier: string
  /** Vide = pas par défaut de la classe d'actif. */
  sizeStep: string
}

export type SizingFormError = 'entry' | 'stop' | 'takeProfit' | 'risk' | 'multiplier' | 'sizeStep'

export function emptySizingForm(): SizingForm {
  return {
    accountId: null, instrumentId: null, direction: 'long', entry: '', stop: '', takeProfit: '',
    riskMode: 'percent', riskValue: '1', multiplier: '', sizeStep: '',
  }
}

const filled = (s: string) => s.trim() !== ''

/**
 * `request` : la demande à envoyer, quand tout est prêt. `errors` : champs remplis mais illisibles
 * (jamais un champ simplement vide). `incomplete` : il manque un champ obligatoire.
 */
export function buildSizingRequest(f: SizingForm): {
  request: SizingRequest | null
  errors: Partial<Record<SizingFormError, true>>
  incomplete: boolean
} {
  const errors: Partial<Record<SizingFormError, true>> = {}
  const check = (key: SizingFormError, value: string) => {
    if (filled(value) && !isPlainDecimal(value)) errors[key] = true
  }
  check('entry', f.entry)
  check('stop', f.stop)
  check('takeProfit', f.takeProfit)
  check('risk', f.riskValue)
  check('multiplier', f.multiplier)
  check('sizeStep', f.sizeStep)
  const incomplete = f.accountId === null || f.instrumentId === null || !filled(f.entry) || !filled(f.stop) || !filled(f.riskValue)
  if (incomplete || Object.keys(errors).length > 0 || f.accountId === null || f.instrumentId === null) {
    return { request: null, errors, incomplete }
  }
  const opt = (v: string) => (filled(v) ? normalizeDecimalInput(v) : null)
  return {
    request: {
      accountId: f.accountId,
      instrumentId: f.instrumentId,
      direction: f.direction,
      entryPrice: normalizeDecimalInput(f.entry),
      stopLoss: normalizeDecimalInput(f.stop),
      takeProfit: opt(f.takeProfit),
      riskMode: f.riskMode,
      riskValue: normalizeDecimalInput(f.riskValue),
      multiplier: opt(f.multiplier),
      sizeStep: opt(f.sizeStep),
    },
    errors,
    incomplete: false,
  }
}

export type SizingWarning = 'exceedsMax' | 'takeProfitWrongSide' | 'defaultStep'

/** Avertissements à afficher, dans l'ordre d'importance ; lecture pure du résultat de pulse-core. */
export function sizingWarnings(r: Sizing): SizingWarning[] {
  const list: SizingWarning[] = []
  if (r.exceedsMaxRisk) list.push('exceedsMax')
  if (r.takeProfitWrongSide) list.push('takeProfitWrongSide')
  if (r.sizeStepIsDefault) list.push('defaultStep')
  return list
}

// --- Mémoire locale (par PC) : compte, actif et façon d'exprimer le risque ; jamais un prix. ---

const MEMORY_KEY = 'pulse.sizing.v1'

export interface SizingMemory {
  accountId: number | null
  instrumentId: number | null
  riskMode: RiskMode
  riskValue: string
}

export function loadSizingMemory(): SizingMemory | null {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<SizingMemory>
    return {
      accountId: typeof v.accountId === 'number' ? v.accountId : null,
      instrumentId: typeof v.instrumentId === 'number' ? v.instrumentId : null,
      riskMode: v.riskMode === 'amount' ? 'amount' : 'percent',
      riskValue: typeof v.riskValue === 'string' && isPlainDecimal(v.riskValue) ? v.riskValue : '',
    }
  } catch {
    return null
  }
}

export function saveSizingMemory(f: SizingForm): void {
  try {
    const memory: SizingMemory = { accountId: f.accountId, instrumentId: f.instrumentId, riskMode: f.riskMode, riskValue: f.riskValue }
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
  } catch {
    /* stockage indisponible : le calculateur marche sans mémoire */
  }
}

// --- Passerelles avec le formulaire de trade (rien n'est enregistré) ---

/** Du formulaire de trade vers le calculateur (lien « Calculer la taille »). */
export interface SizingSeed {
  accountId: number | null
  instrumentId: number | null
  direction: Direction
  entry: string
  stop: string
  takeProfit: string
  multiplier: string
}

/** Du calculateur vers le formulaire de trade (« Utiliser dans un nouveau trade »). */
export interface TradePrefill {
  accountId: number
  instrumentId: number
  direction: Direction
  entryPrice: string
  plannedSl: string
  plannedTp: string
  multiplier: string
  size: string
}

export function seedToForm(seed: SizingSeed, base: SizingForm): SizingForm {
  return { ...base, ...seed }
}

export function tradePrefill(request: SizingRequest, result: Sizing): TradePrefill {
  return {
    accountId: request.accountId,
    instrumentId: request.instrumentId,
    direction: request.direction,
    entryPrice: request.entryPrice,
    plannedSl: request.stopLoss,
    plannedTp: request.takeProfit ?? '',
    multiplier: result.multiplier,
    size: result.size,
  }
}

export function applyTradePrefill(form: TradeForm, p: TradePrefill): TradeForm {
  return {
    ...form,
    accountId: p.accountId,
    instrumentId: p.instrumentId,
    direction: p.direction,
    entryPrice: p.entryPrice,
    plannedSl: p.plannedSl,
    plannedTp: p.plannedTp,
    multiplier: p.multiplier,
    size: p.size,
  }
}
