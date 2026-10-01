// Lot 20 : affichage de l'IA, sans calcul. Le texte de l'IA est découpé en blocs affichés comme du
// texte (jamais interprété comme du HTML) ; les erreurs `ai:<code>` sont traduites par l'interface.

export type AnalysisBlock = { kind: 'heading' | 'bullet' | 'paragraph'; text: string }

/** Titres « ## », puces « - » / « * » / « • », paragraphes ; le gras Markdown est retiré, rien n'est interprété. */
export function parseAnalysis(text: string): AnalysisBlock[] {
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim()
  const blocks: AnalysisBlock[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (heading) blocks.push({ kind: 'heading', text: clean(heading[1]) })
    else if (bullet) blocks.push({ kind: 'bullet', text: clean(bullet[1]) })
    else blocks.push({ kind: 'paragraph', text: clean(line) })
  }
  return blocks.filter((b) => b.text)
}

/** Le code d'une erreur de l'IA (`ai:invalidKey` → `invalidKey`), sinon `null`. */
export function aiErrorCode(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error)
  return /\bai:([A-Za-z]+)\b/.exec(text)?.[1] ?? null
}

/** Taille lisible en français : « 850 ko », « 1,2 Mo ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000)).toLocaleString('fr-FR')} ko`
  return `${(bytes / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

/** Groupes de commentaires : le plus récent affiché, les autres repliés. */
export function splitNotes<T>(notes: T[]): { latest: T | null; older: T[] } {
  return { latest: notes[0] ?? null, older: notes.slice(1) }
}

/** Message français d'une erreur de l'IA (code `ai:…`), sinon le détail brut. */
export function aiErrorMessage(error: unknown, texts: { errors: Record<string, string>; unknownError: (d: string) => string }): string {
  const code = aiErrorCode(error)
  if (code && texts.errors[code]) return texts.errors[code]
  return texts.unknownError((error instanceof Error ? error.message : String(error)).replace(/^Error: /, ''))
}
