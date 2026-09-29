import { useEffect, useState } from 'react'

/**
 * Chargement des données des widgets. Plusieurs widgets lisent le même rapport (cinq indicateurs clés, le
 * résultat net, le capital et les barres par jour partagent `get_dashboard`) : une même requête n'est
 * envoyée qu'une fois par affichage du dashboard. Le cache est vidé quand la page s'ouvre.
 */
const cache = new Map<string, Promise<unknown>>()

export function clearWidgetCache(): void {
  cache.clear()
}

export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = load().catch((e) => {
    cache.delete(key) // une erreur n'est pas mémorisée
    throw e
  })
  cache.set(key, p)
  return p
}

export interface Loaded<T> {
  data: T | null
  error: string | null
}

/** `key === null` : rien à charger (le widget attend, par exemple, qu'un état vide soit levé). */
export function useCached<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { key: string | null }>({ key: null, data: null, error: null })
  useEffect(() => {
    if (key === null) return
    let live = true
    cached(key, load).then(
      (data) => live && setState({ key, data, error: null }),
      (e) => live && setState({ key, data: null, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
    // `load` change à chaque rendu : la clé identifie entièrement la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // Une donnée d'une autre clé (période changée) n'est jamais montrée comme si elle était à jour.
  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: null }
}
