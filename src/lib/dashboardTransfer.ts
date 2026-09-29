import type { ImportErrorCode } from '../types/dashboardLayout'

/** Petites fonctions pures autour de l'export / import d'une configuration de dashboard (3.8.7). */

/** Nom de fichier proposé à l'export : sans accents ni caractères interdits sous Windows, extension `.json`. */
export function configFileName(dashboardName: string): string {
  const slug = dashboardName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `pulse-dashboard-${slug || 'export'}.json`
}

export interface ImportError {
  code: ImportErrorCode
  /** Version du fichier (`too_new`) ou détail technique de pulse-core, s'il y en a un. */
  detail: string | null
}

/**
 * Lit l'erreur d'un import refusé : `... dashboard_import:<code>[:détail]`. `null` pour toute autre erreur
 * (fichier introuvable, disque…), que l'interface présente alors comme une erreur de lecture.
 */
export function parseImportError(message: string): ImportError | null {
  const m = /dashboard_import:([a-z_]+)(?::(.*))?$/s.exec(message)
  if (!m) return null
  const known: ImportErrorCode[] = ['empty', 'corrupt', 'not_a_dashboard', 'too_new', 'too_large', 'invalid']
  const code = known.find((c) => c === m[1])
  return code ? { code, detail: m[2] ?? null } : null
}
