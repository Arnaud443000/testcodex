/** Courbes maison (jamais linéaires). Toutes prennent t ∈ [0, 1]. */
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

export const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const expoIn = (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10))
export const quintOut = (t: number) => 1 - Math.pow(1 - t, 5)
export const quintInOut = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2)
export const cubicInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const sineInOut = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
/** Sortie avec dépassement réglable (≈ 6 % pour s = 1.2). */
export const backOut = (s = 1.2) => (t: number) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
/** Petite anticipation puis départ rapide. */
export const anticipate = (t: number) => {
  const s = 1.4
  return t * t * ((s + 1) * t - s)
}
/** Courbe « signature » du film : départ franc, arrivée très douce (Apple-like). */
export const signature = (t: number) => {
  // Bézier (0.16, 1, 0.3, 1) approchée par un mélange expo/quint.
  return 0.55 * expoOut(t) + 0.45 * quintOut(t)
}
