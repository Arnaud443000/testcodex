import type { ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'

/**
 * Bloom : une seconde copie floutée et éclaircie, ajoutée en « screen ». Seulement quand
 * `amount` > 0 (impacts, révélation du logo) : le coût de rendu reste ponctuel.
 */
export function Bloom({ amount, radius = 28, children }: { amount: number; radius?: number; children: ReactNode }) {
  return (
    <AbsoluteFill>
      {children}
      {amount > 0.01 && (
        <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: Math.min(1, amount), filter: `blur(${radius}px) brightness(1.5) saturate(1.15)` }}>
          {children}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
