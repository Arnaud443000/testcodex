import { fr, type Messages } from './fr'

/** Renvoie les textes de la langue courante (français pour l'instant). */
export function useT(): Messages {
  return fr
}

export type { Messages }
