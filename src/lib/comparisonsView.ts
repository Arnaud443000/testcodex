import { formatNumber, formatPoints } from './format'
import type { Messages } from '../i18n'
import type { AccountComparison, AccountHint, RiskBenchmark, TradeRisk } from '../types/stats'

/**
 * Affichage des comparaisons du lot 17. Rien n'est calculé ici : on choisit des comptes, on écrit des
 * libellés à partir de valeurs déjà chiffrées par pulse-core, et on place des points à dessiner.
 */

/** Comptes cochés par défaut : tous les comptes actifs. */
export function defaultSelection(accountIds: number[]): number[] {
  return [...accountIds]
}

export function toggleSelection(selected: number[], id: number): number[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}

/** Texte d'une piste : toujours formulée comme une piste à vérifier. */
export function hintText(hint: AccountHint, comparison: Pick<AccountComparison, 'rows'>, t: Messages): string {
  const name = (id: number) => comparison.rows.find((r) => r.accountId === id)?.name ?? `#${id}`
  const s = t.comparisons.accounts
  if (hint.kind === 'fees') return s.hintFees(name(hint.accountId), name(hint.otherAccountId), formatPoints(hint.gap, 0).replace(/^\+/, ''), hint.sharedInstruments)
  return s.hintExecution(name(hint.accountId), name(hint.otherAccountId), `${formatNumber(hint.gap, 2)} R`, hint.sharedInstruments)
}

export interface RiskPoint {
  x: number
  y: number
  over: boolean
  tradeId: number
}

/** Coordonnées (0 à 1) des points du graphique de risque ; l'axe vertical va de 0 à 115 % du plus grand des deux (risque max, limite). */
export function riskChartPoints(points: TradeRisk[], limitFraction: number | null): { points: RiskPoint[]; top: number; limitY: number | null } {
  const values = points.flatMap((p) => (p.riskPct === null ? [] : [p.riskPct]))
  const top = Math.max(...values, limitFraction ?? 0, 0.001) * 1.15
  const n = points.length
  return {
    top,
    limitY: limitFraction === null ? null : limitFraction / top,
    points: points.flatMap((p, i) =>
      p.riskPct === null ? [] : [{ x: n <= 1 ? 0.5 : i / (n - 1), y: p.riskPct / top, over: p.withinLimit === false, tradeId: p.tradeId }],
    ),
  }
}

export function limitFraction(report: Pick<RiskBenchmark, 'limitPercent'>): number | null {
  return report.limitPercent === null ? null : Number(report.limitPercent) / 100
}

/** Le facteur « ×1,5 » d'un dépassement, sans unité. */
export function formatFactor(f: number): string {
  return formatNumber(f, 2)
}
