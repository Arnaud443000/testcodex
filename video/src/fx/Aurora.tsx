import { AbsoluteFill } from 'remotion'
import { useBeat } from '../lib/time'
import { C } from '../theme'

/**
 * Fond « aurore » de la charte (2.5) : quatre lueurs radiales sur #080B20, qui dérivent
 * lentement. `intensity` 0 = noir de cinéma, 1 = l'aurore de l'app.
 */
export function Aurora({ intensity = 1, hueShift = 0 }: { intensity?: number; hueShift?: number }) {
  const b = useBeat()
  const t = b * 0.6 // secondes
  const d = (f: number, a: number) => Math.sin(t * f + a)
  const k = intensity
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill
        style={{
          opacity: k,
          filter: hueShift ? `hue-rotate(${hueShift}deg)` : undefined,
          background: [
            `radial-gradient(${900 + 60 * d(0.21, 0)}px ${620 + 40 * d(0.17, 1)}px at ${8 + 3 * d(0.13, 2)}% ${6 + 3 * d(0.11, 0)}%, rgba(74,95,217,.42), transparent 60%)`,
            `radial-gradient(800px 600px at ${95 + 2 * d(0.09, 3)}% ${10 + 4 * d(0.12, 1)}%, rgba(139,127,232,.30), transparent 60%)`,
            `radial-gradient(900px 700px at ${65 + 5 * d(0.07, 4)}% 108%, rgba(74,95,217,.30), transparent 60%)`,
            `radial-gradient(600px 420px at 3% 96%, rgba(95,203,158,.10), transparent 60%)`,
            C.bgDeep,
          ].join(','),
        }}
      />
    </AbsoluteFill>
  )
}
