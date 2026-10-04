import type { ReactNode } from 'react'
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from 'remotion'
import { beatToFrame, blurSamplesAt, frameToBeat, HARD_CUTS } from '../timeline'

/**
 * Flou de bougé réel par sous-images : le film est rendu N fois à des instants répartis sur
 * l'obturateur (180°), puis moyenné (plus-lighter à 1/N). Les échantillons ne remontent jamais
 * avant la dernière coupe : une coupe franche reste franche. N vient de la timeline
 * (blurSamplesAt) pour ne payer le coût que sur les mouvements rapides.
 */
export function MotionBlur({ children, shutter = 0.5, enabled = true }: { children: ReactNode; shutter?: number; enabled?: boolean }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = enabled ? blurSamplesAt(frameToBeat(frame, fps)) : 1
  if (n <= 1) return <>{children}</>
  let lastCut = 0
  for (const b of HARD_CUTS) {
    const f = beatToFrame(b, fps)
    if (f <= frame) lastCut = f
  }
  // L'obturateur est exprimé en images à 30 i/s, pour garder le même flou à 60 i/s.
  const span = shutter * (fps / 30)
  return (
    <AbsoluteFill style={{ isolation: 'isolate', background: '#000' }}>
      {Array.from({ length: n }, (_, i) => {
        const f = Math.max(lastCut, frame - (span * i) / n)
        return (
          <AbsoluteFill key={i} style={{ mixBlendMode: 'plus-lighter', opacity: 1 / n }}>
            <Freeze frame={f}>{children}</Freeze>
          </AbsoluteFill>
        )
      })}
    </AbsoluteFill>
  )
}
