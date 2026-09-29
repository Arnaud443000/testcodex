import { addAt } from './gridLayout'
import { GRID_COLUMNS, type WidgetDefinition, type WidgetInstance } from '../types/dashboardLayout'

/** Opérations sur le brouillon d'un dashboard en cours de modification (géométrie et réglages, aucune statistique). */

let counter = 0
/** Identifiant d'une nouvelle occurrence de widget (unique dans un dashboard, 1 à 40 caractères). */
export function newUid(kind: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  let uid: string
  do {
    counter += 1
    uid = `${kind.slice(0, 20)}-${Date.now().toString(36)}${counter.toString(36)}`
  } while (used.has(uid))
  return uid
}

/** Ajoute un widget à sa taille par défaut, à la première place libre. */
export function addWidget(items: WidgetInstance[], def: WidgetDefinition): WidgetInstance[] {
  const instance: Omit<WidgetInstance, 'x' | 'y'> = {
    uid: newUid(def.kind, items.map((i) => i.uid)),
    kind: def.kind,
    w: def.defaultW,
    h: def.defaultH,
    period: null,
    accountId: null,
    mode: def.modes[0] ?? null,
  }
  return addAt(items, instance, GRID_COLUMNS)
}

export const removeWidget = (items: WidgetInstance[], uid: string): WidgetInstance[] => items.filter((i) => i.uid !== uid)

/** Change les réglages propres d'un widget (3.8.8) sans toucher à sa place. */
export function patchWidget(items: WidgetInstance[], uid: string, patch: Partial<Pick<WidgetInstance, 'period' | 'accountId' | 'mode'>>): WidgetInstance[] {
  return items.map((i) => (i.uid === uid ? { ...i, ...patch } : i))
}

const canon = (items: WidgetInstance[]) =>
  JSON.stringify(
    [...items]
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
      .map((i) => [i.uid, i.kind, i.x, i.y, i.w, i.h, i.period, i.accountId, i.mode]),
  )

/** Deux dispositions identiques (l'ordre de la liste ne compte pas) : sert à détecter des modifications non enregistrées. */
export const sameLayout = (a: WidgetInstance[], b: WidgetInstance[]): boolean => canon(a) === canon(b)

/** Combien d'occurrences de chaque widget la disposition contient. */
export function countByKind(items: WidgetInstance[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) out[i.kind] = (out[i.kind] ?? 0) + 1
  return out
}

