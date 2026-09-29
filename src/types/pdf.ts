/** Export PDF d'un bilan de période (lot 23, 3.7.3). */

export interface PdfExportRequest {
  /** Un seul compte : le bilan n'est jamais consolidé. */
  accountId: number
  /** Bornes `[from, to)` en ms UTC ; `null` = pas de borne. */
  from: number | null
  to: number | null
  /** Le nom du compte n'est écrit dans le document que si vrai. */
  includeAccountName: boolean
  /** Décalage UTC de l'utilisateur en minutes (dates locales du document). */
  tzOffsetMin: number
}

export interface PdfExport {
  /** Trades clôturés listés dans le document. */
  tradeCount: number
  pageCount: number
}
