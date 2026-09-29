import type { Decimal } from '../types/money'
import type { ComponentKey, TradeDiscipline } from '../types/behavior'
import type { PlanFollowed } from '../types/trade'

/**
 * Lecture du score de discipline d'un trade : pour chaque composante, ce que pulse-core a retenu (ou pourquoi
 * elle est exclue). Aucun calcul : on ne fait que choisir quoi dire à partir des champs déjà calculés.
 */

/** Ce qui explique la valeur d'une composante ; le texte français est fabriqué par l'interface (`fr.ts`). */
export type ComponentDetail =
  | { kind: 'plan'; plan: PlanFollowed | null }
  | { kind: 'rules'; checked: number; respected: number }
  | { kind: 'checklist'; total: number; checked: number }
  | { kind: 'stopLoss'; present: boolean }
  | { kind: 'risk'; riskPct: number | null; limit: Decimal | null; hasStopLoss: boolean }
  | { kind: 'behavior'; revenge: TradeDiscipline['revenge']; overtrading: boolean; dayRank: number }

/** `full` = valeur maximale ; `weak` = points perdus ; `excluded` = sans donnée, jamais comptée comme 0. */
export type ComponentStatus = 'full' | 'weak' | 'excluded'

export interface ComponentRow {
  key: ComponentKey
  weight: number
  /** De 0 à 1 ; null si la composante est exclue. */
  value: number | null
  status: ComponentStatus
  detail: ComponentDetail
}

function detailOf(key: ComponentKey, t: TradeDiscipline): ComponentDetail {
  switch (key) {
    case 'plan':
      return { kind: 'plan', plan: t.planFollowed }
    case 'rules':
      return { kind: 'rules', checked: t.rulesChecked, respected: t.rulesRespected }
    case 'checklist':
      return { kind: 'checklist', total: t.checklistTotal, checked: t.checklistChecked }
    case 'stopLoss':
      return { kind: 'stopLoss', present: t.hasStopLoss }
    case 'risk':
      return { kind: 'risk', riskPct: t.riskPct, limit: t.maxRiskPercent, hasStopLoss: t.hasStopLoss }
    case 'behavior':
      return { kind: 'behavior', revenge: t.revenge, overtrading: t.overtrading, dayRank: t.dayRank }
  }
}

/** Composantes dans l'ordre des poids décroissants (celui de pulse-core). */
export function componentRows(t: TradeDiscipline): ComponentRow[] {
  return t.components.map((c) => ({
    key: c.key,
    weight: c.weight,
    value: c.value,
    status: c.value === null ? 'excluded' : c.value >= 1 ? 'full' : 'weak',
    detail: detailOf(c.key, t),
  }))
}

/** Composantes qui font baisser le score, dans l'ordre des poids ; vide si rien ne pèse. */
export const weakRows = (rows: ComponentRow[]): ComponentRow[] => rows.filter((r) => r.status === 'weak')

/** Composantes exclues du score. */
export const excludedRows = (rows: ComponentRow[]): ComponentRow[] => rows.filter((r) => r.status === 'excluded')
