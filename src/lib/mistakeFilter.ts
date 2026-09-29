import type { MistakeFilter } from '../types/trade'

/** Filtre par erreur dans l'adresse de la liste des trades : « /trades?mistake=tag:12 » ou « rule:3 ». */

export const MISTAKE_PARAM = 'mistake'

export function mistakeLink(m: MistakeFilter): string {
  return `/trades?${MISTAKE_PARAM}=${m.source}:${m.id}`
}

/** Lit le paramètre ; toute valeur mal formée est ignorée (pas de filtre) plutôt que de casser la page. */
export function parseMistakeParam(value: string | null): MistakeFilter | null {
  const m = /^(tag|rule):(\d{1,15})$/.exec(value ?? '')
  return m ? { source: m[1] as MistakeFilter['source'], id: Number(m[2]) } : null
}
