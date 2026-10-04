/** Forme d'un battement d'ECG (onde P, complexe QRS, onde T), u = écart au pic R, en temps. */
export function ecgShape(u: number) {
  const gauss = (c: number, w: number, a: number) => a * Math.exp(-((u - c) ** 2) / (2 * w * w))
  return (
    gauss(-0.2, 0.035, 0.12) + // P
    gauss(-0.035, 0.012, -0.14) + // Q
    gauss(0, 0.014, 1) + // R
    gauss(0.04, 0.014, -0.32) + // S
    gauss(0.24, 0.05, 0.22) // T
  )
}

/** Valeur de l'ECG au temps `b` pour une liste de battements (pics R). */
export function ecgAt(b: number, beats: readonly number[]) {
  let v = 0
  for (const p of beats) if (Math.abs(b - p) < 0.5) v += ecgShape(b - p)
  return v
}

/** Chemin SVG d'une liste de points. */
export function pathOf(pts: [number, number][]) {
  if (pts.length === 0) return ''
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) d += `L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`
  return d
}

/** Chemin lissé (Catmull-Rom → Bézier). */
export function smoothPath(pts: [number, number][]) {
  if (pts.length < 3) return pathOf(pts)
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

/** Longueur d'une polyligne. */
export function polyLength(pts: [number, number][]) {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return l
}

/** Tronque une polyligne à une fraction de sa longueur (renvoie aussi la tête). */
export function partial(pts: [number, number][], t: number): { pts: [number, number][]; head: [number, number] } {
  if (t >= 1) return { pts, head: pts[pts.length - 1] }
  const total = polyLength(pts) * Math.max(0, t)
  const out: [number, number][] = [pts[0]]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (acc + seg >= total) {
      const k = seg === 0 ? 0 : (total - acc) / seg
      const p: [number, number] = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]
      out.push(p)
      return { pts: out, head: p }
    }
    acc += seg
    out.push(pts[i])
  }
  return { pts: out, head: pts[pts.length - 1] }
}
