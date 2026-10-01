/**
 * Faux export PDF du navigateur (lot 23) — **SIMULATION** : aucun PDF n'est fabriqué, aucun fichier
 * n'est écrit. Il rejoue seulement les règles visibles de `pulse_core::export_pdf` (un compte,
 * période invalide refusée, fichier existant refusé sans confirmation) et compte les trades clôturés
 * de la période ; le vrai document est produit par pulse-core dans l'application.
 */
import type { Account } from '../types/account'
import type { PdfExport, PdfExportRequest } from '../types/pdf'

/** Trades par page dans la simulation (le vrai nombre dépend de la mise en page de pulse-core). */
const SIMULATED_ROWS_PER_PAGE = 38

export interface PdfMockDeps {
  accounts: () => Account[]
  /** Nombre de trades clôturés du compte dont la sortie est dans `[from, to)`. */
  closedTradeCount: (accountId: number, from: number | null, to: number | null) => number
}

export function createPdfMock(deps: PdfMockDeps) {
  /** « Fichiers » simulés : un chemin déjà utilisé existe. Disparaît au rechargement de la page. */
  const written = new Set<string>()
  return {
    exportPeriodPdf: async (req: PdfExportRequest, path: string, overwrite: boolean): Promise<PdfExport> => {
      const account = deps.accounts().find((a) => a.id === req.accountId)
      if (!account) throw new Error('not found: account')
      if (req.from !== null && req.to !== null && req.from >= req.to) throw new Error('invalid input: pdf:invalidPeriod')
      if (!overwrite && written.has(path)) throw new Error('invalid input: pdf:fileExists')
      written.add(path)
      const tradeCount = deps.closedTradeCount(req.accountId, req.from, req.to)
      return { tradeCount, pageCount: 1 + Math.floor(tradeCount / SIMULATED_ROWS_PER_PAGE) }
    },
  }
}
