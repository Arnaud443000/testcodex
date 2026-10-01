import type { AssetClass, Direction } from '../types/trade'
import type { Sizing, SizingOutcome, SizingRefusalCode, SizingRequest } from '../types/sizing'
import type { MockLedger } from './mockStats'

/**
 * MOCK du calculateur de taille (lot 27) — uniquement pour `npm run dev` dans un navigateur.
 * Miroir de `pulse-core/src/sizing.rs` (CLAUDE.md, « Calculateur de position ») en BigInt exact,
 * vérifié par `mockSizing.test.ts` sur les mêmes cas calculés à la main. Dans l'application, tout vient de Rust.
 */

const S = 30
const ONE = 10n ** BigInt(S)
/** Plus grand décimal de Rust (2^96 − 1) : au-delà, « débordement ». */
const LIMIT = 79228162514264337593543950335n * ONE

class Refusal extends Error {
  constructor(
    readonly code: SizingRefusalCode,
    readonly detail: string | null = null,
  ) {
    super(code)
  }
}

const parse = (v: string): bigint => {
  const neg = v.startsWith('-')
  const [i, f = ''] = (neg ? v.slice(1) : v).split('.')
  const n = BigInt(i + f.padEnd(S, '0').slice(0, S))
  return neg ? -n : n
}
const abs = (n: bigint) => (n < 0n ? -n : n)
const guard = (n: bigint): bigint => {
  if (abs(n) > LIMIT) throw new Refusal('overflow')
  return n
}
const mul = (a: bigint, b: bigint) => guard((a * b) / ONE)
const div = (a: bigint, b: bigint) => guard((a * ONE) / b)
const sub = (a: bigint, b: bigint) => guard(a - b)

/** Chaîne décimale ; `scale` fixe le nombre de décimales (sinon zéros de fin retirés). */
const str = (n: bigint, scale?: number): string => {
  const neg = n < 0n
  const digits = abs(n).toString().padStart(S + 1, '0')
  let frac = digits.slice(-S)
  frac = scale === undefined ? frac.replace(/0+$/, '') : frac.slice(0, scale).padEnd(scale, '0')
  return `${neg ? '-' : ''}${digits.slice(0, -S)}${frac ? `.${frac}` : ''}`
}
const truncate = (n: bigint, dp: number): bigint => {
  const unit = 10n ** BigInt(S - dp)
  return (n / unit) * unit
}
/** part × 100 / whole, arrondi à 4 décimales, milieu vers l'extérieur (comme rust_decimal). */
const percent = (part: bigint, whole: bigint): string => {
  const num = guard(part * 100n * 10_000n)
  const q = (2n * abs(num) + abs(whole)) / (2n * abs(whole))
  const signed = (num < 0n) !== (whole < 0n) ? -q : q
  return str(signed * 10n ** BigInt(S - 4))
}
const ratio = (a: bigint, b: bigint): number => Number((a * 10n ** 12n) / b) / 1e12
const decimals = (v: string) => (v.split('.')[1] ?? '').length

/** Pas de taille par défaut d'une classe d'actif (même table que `default_size_step`). */
export function defaultSizeStep(c: AssetClass): string {
  switch (c) {
    case 'crypto':
      return '0.0001'
    case 'stock':
    case 'future':
      return '1'
    default:
      return '0.01'
  }
}

export interface MockSizingInput {
  direction: Direction
  entry: string
  stop: string
  takeProfit: string | null
  riskMode: 'percent' | 'amount'
  riskValue: string
  balance: string
  multiplier: string
  sizeStep: string
  sizeStepIsDefault: boolean
  maxRiskPercent: string | null
}

function compute(i: MockSizingInput): Sizing {
  const entry = parse(i.entry)
  const stop = parse(i.stop)
  const tp = i.takeProfit === null ? null : parse(i.takeProfit)
  const balance = parse(i.balance)
  const sign = i.direction === 'long' ? 1n : -1n
  if (entry <= 0n || stop <= 0n || (tp !== null && tp <= 0n)) throw new Refusal('priceNotPositive')
  const perUnitPrice = sub(entry, stop)
  if (perUnitPrice === 0n) throw new Refusal('stopEqualsEntry')
  if (perUnitPrice * sign < 0n) throw new Refusal('stopWrongSide')
  const distance = abs(perUnitPrice)
  const value = parse(i.riskValue)
  let riskWanted: bigint
  if (i.riskMode === 'amount') {
    if (value <= 0n) throw new Refusal('riskNotPositive')
    riskWanted = value
  } else {
    if (value <= 0n) throw new Refusal('riskNotPositive')
    if (value > 100n * ONE) throw new Refusal('riskPercentTooHigh')
    if (balance <= 0n) throw new Refusal('balanceNotPositive')
    riskWanted = div(mul(value, balance), 100n * ONE)
  }
  const multiplier = parse(i.multiplier)
  const step = parse(i.sizeStep)
  if (multiplier <= 0n) throw new Refusal('multiplierNotPositive')
  if (step <= 0n) throw new Refusal('stepNotPositive')
  const perUnitRisk = mul(distance, multiplier)
  const raw = div(riskWanted, perUnitRisk)
  // floor(raw / step) sans l'arrondi de la division : le risque réel ne dépasse jamais le voulu.
  const steps = riskWanted / mul(step, perUnitRisk)
  const size = guard(steps * step)
  const riskActual = mul(size, perUnitRisk)
  if (size <= 0n) throw new Refusal('sizeZero', str(mul(step, perUnitRisk)))

  const positive = balance > 0n
  let rewardAmount: string | null = null
  let rewardRisk: number | null = null
  let wrong = false
  if (tp !== null) {
    const rewardPerUnit = sub(tp, entry) * sign
    if (rewardPerUnit <= 0n) wrong = true
    else {
      rewardAmount = str(mul(mul(size, rewardPerUnit), multiplier))
      rewardRisk = ratio(rewardPerUnit, distance)
    }
  }
  const max = i.maxRiskPercent === null ? null : parse(i.maxRiskPercent)
  return {
    size: str(size, decimals(i.sizeStep)),
    rawSize: str(truncate(raw, 8)),
    sizeStep: i.sizeStep,
    sizeStepIsDefault: i.sizeStepIsDefault,
    multiplier: i.multiplier,
    balance: i.balance,
    riskWanted: str(riskWanted),
    riskWantedPercent: positive ? percent(riskWanted, balance) : null,
    riskActual: str(riskActual),
    riskActualPercent: positive ? percent(riskActual, balance) : null,
    riskGap: str(sub(riskWanted, riskActual)),
    stopDistance: str(distance),
    rewardAmount,
    rewardRisk,
    takeProfitWrongSide: wrong,
    maxRiskPercent: i.maxRiskPercent,
    maxRiskAmount: max !== null && positive ? str(div(mul(max, balance), 100n * ONE)) : null,
    // riskActual × 100 > limite × solde, comparaison exacte ; égalité = respecté.
    exceedsMaxRisk: max !== null && positive && guard(riskActual * 100n) > mul(max, balance),
  }
}

export function mockSize(i: MockSizingInput, currency: string): SizingOutcome {
  try {
    return { status: 'ok', result: compute(i), currency }
  } catch (e) {
    if (e instanceof Refusal) return { status: 'refused', code: e.code, detail: e.detail }
    throw e
  }
}

/** Solde réel maintenant : capital initial + dépôts / retraits + PnL nets des trades clôturés. */
export function balanceOf(ledger: MockLedger): string {
  let n = parse(ledger.initialCapital)
  for (const m of ledger.capitalMoves) n += parse(m.amount)
  for (const c of ledger.closed) n += parse(c.netPnl)
  return str(n)
}

export function toMockInput(
  req: SizingRequest,
  ctx: { balance: string; defaultMultiplier: string; assetClass: AssetClass; maxRiskPercent: string | null },
): MockSizingInput {
  return {
    direction: req.direction,
    entry: req.entryPrice,
    stop: req.stopLoss,
    takeProfit: req.takeProfit,
    riskMode: req.riskMode,
    riskValue: req.riskValue,
    balance: ctx.balance,
    multiplier: req.multiplier ?? ctx.defaultMultiplier,
    sizeStep: req.sizeStep ?? defaultSizeStep(ctx.assetClass),
    sizeStepIsDefault: req.sizeStep === null,
    maxRiskPercent: ctx.maxRiskPercent,
  }
}
