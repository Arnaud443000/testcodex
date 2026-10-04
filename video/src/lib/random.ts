/** Hasard déterministe (même image = même rendu, condition d'un rendu Remotion). */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }
}

export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Bruit 1D lisse, dans [-1, 1]. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = hash(i + seed * 57.3) * 2 - 1
  const b = hash(i + 1 + seed * 57.3) * 2 - 1
  return a + (b - a) * u
}
