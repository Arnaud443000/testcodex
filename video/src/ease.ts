import { interpolate, spring } from 'remotion'

type Bez = [number, number, number, number]
function bezier([x1, y1, x2, y2]: Bez) {
  const cx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3
  const cy = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0
    let hi = 1
    let s = t
    for (let i = 0; i < 22; i++) {
      const x = cx(s)
      if (Math.abs(x - t) < 1e-5) break
      if (x < t) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return cy(s)
  }
}

/** Easings sur mesure : jamais de mouvement linéaire. */
export const E = {
  out: bezier([0.16, 1, 0.3, 1]), // expo out, arrivée douce
  snap: bezier([0.2, 0.9, 0.1, 1]),
  inOut: bezier([0.83, 0, 0.17, 1]), // quint in-out
  in: bezier([0.7, 0, 0.84, 0]),
  back: bezier([0.34, 1.45, 0.64, 1]), // léger overshoot
  soft: bezier([0.45, 0, 0.15, 1]),
}

/** Progression 0→1 entre `start` et `start+dur` (images) avec easing. */
export const prog = (frame: number, start: number, dur: number, e: (t: number) => number = E.out) =>
  e(Math.min(1, Math.max(0, (frame - start) / dur)))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

/** Ressort avec léger overshoot (ressort amorti, 60 fps). */
export const sp = (frame: number, start: number, damping = 16, stiffness = 120, mass = 0.9) =>
  spring({ frame: frame - start, fps: 60, config: { damping, stiffness, mass }, durationInFrames: 90 })

export { interpolate }

/** Aléatoire déterministe (mulberry32) : le rendu est identique à chaque passage. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Format français : espace fine insécable, virgule décimale, vrai signe moins. */
export function fmt(n: number, dec = 0, sign = false) {
  const neg = n < 0
  const abs = Math.abs(n).toFixed(dec)
  const [i, d] = abs.split('.')
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const body = d ? `${g},${d}` : g
  return `${neg ? '−' : sign && n > 0 ? '+' : ''}${body}`
}
