import type { AlertKind, AlertRecord } from '../types/alerts'

/** Types d'alerte proposés en filtre, dans l'ordre du cahier (3.6.1 à 3.6.6). */
export const ALERT_KINDS: AlertKind[] = [
  'consecutiveLosses',
  'tradesPerDay',
  'tradesPerWindow',
  'dailyLoss',
  'weeklyLoss',
  'revenge',
  'outsideHours',
  'unusualSession',
  'noStopLoss',
]

export interface HistoryFilter {
  /** Bornes `[from, to)` en ms UTC (`null` = sans borne), sur la première apparition de l'alerte. */
  from: number | null
  to: number | null
  kind: AlertKind | null
}

/** Filtre d'affichage de l'historique (aucun calcul métier : les alertes viennent de pulse-core). */
export function filterHistory(records: AlertRecord[], f: HistoryFilter): AlertRecord[] {
  return records.filter(
    (r) => (f.from === null || r.firstSeenAt >= f.from) && (f.to === null || r.firstSeenAt < f.to) && (f.kind === null || r.kind === f.kind),
  )
}
