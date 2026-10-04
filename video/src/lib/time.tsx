import { createContext, useContext } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { BEAT, beatToFrame, frameToBeat } from '../timeline'
import { clamp01 } from './ease'

/** Temps global du film, en temps musicaux (continu, fractionnaire pendant le flou de bougé). */
export function useBeat() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return frameToBeat(frame, fps)
}

const SceneStart = createContext(0)
export const SceneStartProvider = SceneStart.Provider

/** Temps local au plan courant (0 = la coupe d'entrée). */
export function useLocalBeat() {
  const start = useContext(SceneStart)
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // La coupe tombe sur l'image arrondie du temps : le temps local part de 0 à cette image.
  return frameToBeat(frame - beatToFrame(start, fps), fps)
}

/** Progression 0 → 1 entre `start` et `start + dur` (en temps), passée dans une courbe. */
export function prog(b: number, start: number, dur: number, ease: (t: number) => number = (t) => t) {
  return ease(clamp01((b - start) / dur))
}

/**
 * Ressort amorti analytique (indépendant des i/s). `damping` 0.65 ≈ 7 % de dépassement.
 * `freq` en oscillations par seconde.
 */
export function spring(b: number, start: number, { freq = 1.5, damping = 0.65 } = {}) {
  const t = (b - start) * BEAT
  if (t <= 0) return 0
  const w = 2 * Math.PI * freq
  const z = damping
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Interpolation par segments sur des temps, avec une courbe par segment. */
export function keys(b: number, pts: [number, number][], ease: (t: number) => number = (t) => t) {
  if (b <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [b1, v1] = pts[i]
    const [b0, v0] = pts[i - 1]
    if (b <= b1) return mix(v0, v1, ease((b - b0) / (b1 - b0)))
  }
  return pts[pts.length - 1][1]
}

/** Format de la composition : 16:9 (1920×1080) ou vertical (1080×1920). */
export function useLayout() {
  const { width, height } = useVideoConfig()
  return { W: width, H: height, vertical: height > width }
}
