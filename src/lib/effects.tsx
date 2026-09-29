import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Réglage « Réduire les effets » (charte 7) : flous d'arrière-plan, halos, ombres lourdes, transitions.
 * - `auto` (défaut) : suit la préférence du système (`prefers-reduced-motion` ou `prefers-reduced-transparency`) ;
 * - `reduced` : toujours réduit ; `full` : toujours les effets complets.
 * Mémorisé localement (localStorage), jamais envoyé nulle part. Le résultat est écrit sur `<html data-effects>`
 * (`reduced` | `full`) : tout le CSS de secours part de cet attribut.
 */
export type EffectsPreference = 'auto' | 'reduced' | 'full'
export type EffectsMode = 'reduced' | 'full'

export const EFFECTS_STORAGE_KEY = 'pulse.effects'
export const EFFECTS_PREFERENCES: EffectsPreference[] = ['auto', 'reduced', 'full']

export function parsePreference(raw: string | null | undefined): EffectsPreference {
  return raw === 'reduced' || raw === 'full' || raw === 'auto' ? raw : 'auto'
}

export function resolveEffects(preference: EffectsPreference, systemPrefersReduced: boolean): EffectsMode {
  if (preference === 'reduced') return 'reduced'
  if (preference === 'full') return 'full'
  return systemPrefersReduced ? 'reduced' : 'full'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const safeStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // stockage refusé : on retombe sur « auto », l'application reste utilisable
  }
}

export function readPreference(storage: StorageLike | null = safeStorage()): EffectsPreference {
  try {
    return parsePreference(storage?.getItem(EFFECTS_STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

export function writePreference(preference: EffectsPreference, storage: StorageLike | null = safeStorage()): void {
  try {
    storage?.setItem(EFFECTS_STORAGE_KEY, preference)
  } catch {
    /* non mémorisé : sans conséquence */
  }
}

const QUERIES = ['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)']
const systemQueries = (): MediaQueryList[] =>
  typeof window === 'undefined' || !window.matchMedia ? [] : QUERIES.map((q) => window.matchMedia(q))
const systemPrefersReduced = () => systemQueries().some((q) => q.matches)

/** À appeler avant le premier affichage (main.tsx) : évite un éclair d'effets complets au démarrage. */
export function applyEffects(mode: EffectsMode, root: HTMLElement = document.documentElement): void {
  root.dataset.effects = mode
}
export function initEffects(): void {
  if (typeof document === 'undefined') return
  applyEffects(resolveEffects(readPreference(), systemPrefersReduced()))
}

interface EffectsValue {
  preference: EffectsPreference
  mode: EffectsMode
  setPreference: (p: EffectsPreference) => void
}
const Ctx = createContext<EffectsValue>({ preference: 'auto', mode: 'full', setPreference: () => {} })
export const useEffects = () => useContext(Ctx)

export function EffectsProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<EffectsPreference>(() => readPreference())
  const [system, setSystem] = useState<boolean>(() => systemPrefersReduced())
  useEffect(() => {
    const queries = systemQueries()
    const onChange = () => setSystem(queries.some((q) => q.matches))
    queries.forEach((q) => q.addEventListener?.('change', onChange))
    return () => queries.forEach((q) => q.removeEventListener?.('change', onChange))
  }, [])
  const mode = resolveEffects(preference, system)
  useEffect(() => applyEffects(mode), [mode])
  const setPreference = useCallback((p: EffectsPreference) => {
    writePreference(p)
    setPref(p)
  }, [])
  const value = useMemo(() => ({ preference, mode, setPreference }), [preference, mode, setPreference])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
