import { noise1 } from '../lib/random'

/**
 * Courbe d'équité du film (3 mois, 182 trades) : PnL net cumulé de 0 à +12 480 €, avec un
 * drawdown max de −6,2 % vers la fin du deuxième mois. Valeurs normalisées 0 → 1.
 */
export function equityAt(t: number) {
  const trend = Math.pow(t, 1.15)
  const dip = -0.11 * Math.exp(-((t - 0.58) ** 2) / 0.004) // le drawdown
  const wobble = 0.035 * noise1(t * 22, 11) + 0.018 * noise1(t * 61, 12)
  return Math.max(0, Math.min(1.02, trend + dip + wobble * (0.4 + t)))
}

export function equityPoints(x0: number, x1: number, yBase: number, height: number, n = 140): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([x0 + (x1 - x0) * t, yBase - equityAt(t) * height])
  }
  return pts
}
