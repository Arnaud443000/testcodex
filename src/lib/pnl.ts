import type { TradeSide } from '../types/trade';

/**
 * Net PnL: (exit - entry) * size, sign-flipped for shorts, minus fees.
 * Returns null while entry/exit/size aren't all valid numbers yet, so the
 * form can distinguish "not enough info" from "PnL is zero".
 */
export function computePnl(
  side: TradeSide,
  entryPrice: number | null,
  exitPrice: number | null,
  size: number | null,
  fees: number,
): number | null {
  if (entryPrice === null || exitPrice === null || size === null) {
    return null;
  }
  const direction = side === 'long' ? 1 : -1;
  return (exitPrice - entryPrice) * size * direction - fees;
}
