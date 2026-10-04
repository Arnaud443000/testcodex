import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { useBeat } from '../lib/time'
import { noise1 } from '../lib/random'

/** Tremblement de caméra (bruit lisse, pas de hasard brut). */
export function Shake({ amount, children }: { amount: number; children: ReactNode }) {
  const b = useBeat()
  const f = b * 9
  const x = noise1(f, 1) * amount
  const y = noise1(f, 2) * amount * 0.7
  const r = noise1(f, 3) * amount * 0.04
  return <AbsoluteFill style={{ transform: amount > 0.01 ? `translate(${x}px, ${y}px) rotate(${r}deg)` : undefined }}>{children}</AbsoluteFill>
}
