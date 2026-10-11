import { isPlainDecimal, normalizeDecimalInput } from './decimal'
import { fromLocalInput, toLocalInput, tzOffsetMinutes } from './tradeTime'
import type { Decimal } from '../types/money'
import type { Direction } from '../types/trade'
import type { BacktestCase, BacktestData, BacktestStatus, CaseData, CaseOutcome, Observation, SetupValidity } from '../types/backtest'

/**
 * Lecture et validation de la saisie des backtests. Pas de calcul : les règles de pulse-core (`backtests.rs`)
 * font foi, ce contrôle ne sert qu'à afficher une erreur claire avant l'enregistrement.
 */

export interface CaseDraft {
  when: string
  direction: Direction | null
  observation: Observation
  setupValid: SetupValidity
  outcome: CaseOutcome
  plannedRr: string
  resultR: string
  maxR: string
  notes: string
}

export type CaseErrorKey = 'when' | 'plannedRr' | 'resultR' | 'maxR' | 'tpSign' | 'slSign' | 'maxBelowResult'

export const emptyCaseDraft = (now = Date.now()): CaseDraft => ({
  when: toLocalInput(now),
  direction: null,
  observation: 'past',
  setupValid: 'yes',
  outcome: 'tp',
  plannedRr: '',
  resultR: '',
  maxR: '',
  notes: '',
})

export const draftFromCase = (c: BacktestCase): CaseDraft => ({
  when: toLocalInput(c.occurredAt),
  direction: c.direction,
  observation: c.observation,
  setupValid: c.setupValid,
  outcome: c.outcome,
  plannedRr: c.plannedRr ?? '',
  resultR: c.resultR ?? '',
  maxR: c.maxR ?? '',
  notes: c.notes,
})

/** Valeur de départ du résultat quand on choisit une issue : −1 R pour un stop, le R:R prévu pour un TP. */
export function suggestedResult(outcome: CaseOutcome, plannedRr: string): string {
  if (outcome === 'sl') return '-1'
  if (outcome === 'tp') return isPlainDecimal(plannedRr) && /[1-9]/.test(plannedRr) ? normalizeDecimalInput(plannedRr) : ''
  return ''
}

const readR = (input: string, allowNegative: boolean): Decimal | null | 'bad' => {
  const s = normalizeDecimalInput(input)
  if (s === '') return null
  return isPlainDecimal(s, { allowNegative }) ? s : 'bad'
}

export type CaseParse = { ok: true; data: CaseData } | { ok: false; errors: Partial<Record<CaseErrorKey, true>> }

export function parseCaseDraft(d: CaseDraft): CaseParse {
  const errors: Partial<Record<CaseErrorKey, true>> = {}
  const when = fromLocalInput(d.when)
  if (when === null) errors.when = true
  const planned = readR(d.plannedRr, false)
  if (planned === 'bad' || (planned !== null && !/[1-9]/.test(planned))) errors.plannedRr = true
  const entered = d.outcome !== 'no_entry'
  const result = entered ? readR(d.resultR, true) : null
  if (entered && (result === null || result === 'bad')) errors.resultR = true
  const max = entered ? readR(d.maxR, false) : null
  if (max === 'bad') errors.maxR = true
  if (typeof result === 'string' && result !== 'bad') {
    const r = Number(result)
    if (d.outcome === 'tp' && r <= 0) errors.tpSign = true
    if (d.outcome === 'sl' && r > 0) errors.slSign = true
    if (typeof max === 'string' && max !== 'bad' && Number(max) < r) errors.maxBelowResult = true
  }
  if (Object.keys(errors).length > 0 || when === null) return { ok: false, errors }
  return {
    ok: true,
    data: {
      occurredAt: when,
      tzOffsetMin: tzOffsetMinutes(when),
      direction: d.direction,
      observation: d.observation,
      setupValid: d.setupValid,
      outcome: d.outcome,
      plannedRr: planned === 'bad' ? null : planned,
      resultR: entered && typeof result === 'string' && result !== 'bad' ? result : null,
      maxR: entered && typeof max === 'string' && max !== 'bad' ? max : null,
      notes: d.notes,
    },
  }
}

export interface SessionDraft {
  name: string
  asset: string
  timeframe: string
  entryConditions: string
  exitRules: string
  notes: string
  status: BacktestStatus
  setupTagId: number | null
}

export const emptySessionDraft = (): SessionDraft => ({
  name: '', asset: '', timeframe: '', entryConditions: '', exitRules: '', notes: '', status: 'running', setupTagId: null,
})

export const draftFromSession = (b: BacktestData): SessionDraft => ({
  name: b.name, asset: b.asset, timeframe: b.timeframe, entryConditions: b.entryConditions, exitRules: b.exitRules,
  notes: b.notes, status: b.status, setupTagId: b.setupTagId,
})

export type SessionParse = { ok: true; data: BacktestData } | { ok: false; errors: { name?: true } }

export function parseSessionDraft(d: SessionDraft): SessionParse {
  const name = d.name.split(/\s+/).filter(Boolean).join(' ')
  if (name === '' || name.length > 80) return { ok: false, errors: { name: true } }
  return { ok: true, data: { ...d, name } }
}
