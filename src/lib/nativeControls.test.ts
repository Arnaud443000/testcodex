import { describe, expect, it } from 'vitest'

/**
 * Garde-fou du lot 29 : l'interface n'utilise plus d'éléments natifs qui prennent l'aspect du système.
 * - `<select>` → `components/ui/Select.tsx`
 * - `title="…"` sur un élément DOM ou un `Link` → `components/ui/Tooltip.tsx` (la prop `title` d'un composant maison, comme
 *   `PageHeader` ou `Card`, n'est pas concernée)
 * - `<input type="checkbox">` → `components/ui/Checkbox.tsx`
 */

/** Tous les fichiers .tsx de src/, lus tels quels (Vite : pas besoin des types de Node). */
const SOURCES = import.meta.glob<string>('../**/*.tsx', { query: '?raw', import: 'default', eager: true })

/** Balises JSX d'un fichier : nom + texte des attributs, sans le contenu des `{…}` ni des chaînes. */
function tags(raw: string): { name: string; attrs: string; line: number }[] {
  // Les commentaires (qui citent `<select>` pour expliquer le composant) sont remplacés par des blancs, lignes conservées.
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|\s)\/\/.*$/gm, blank)
  const out: { name: string; attrs: string; line: number }[] = []
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length
    let depth = 0
    let attrs = ''
    let quote: string | null = null
    for (; i < source.length; i += 1) {
      const c = source[i]
      if (quote) {
        if (c === quote && source[i - 1] !== '\\') quote = null
        if (depth === 0 && quote === null) attrs += '""'
        continue
      }
      if (c === '"' || c === "'" || (c === '`' && depth > 0)) {
        quote = c
        continue
      }
      if (c === '{') {
        depth += 1
        continue
      }
      if (c === '}') {
        depth -= 1
        if (depth === 0) attrs += '{}'
        continue
      }
      if (depth > 0) continue
      if (c === '>') break
      attrs += c
    }
    out.push({ name: m[1], attrs, line: source.slice(0, m.index).split('\n').length })
  }
  return out
}

const DOM = (name: string) => /^[a-z]/.test(name) || name === 'Link' || name === 'NavLink'

function offenders(kind: 'select' | 'title' | 'checkbox'): string[] {
  const found: string[] = []
  for (const [path, text] of Object.entries(SOURCES)) {
    const rel = path.replace('../', '')
    if (rel === 'components/ui/Checkbox.tsx' || rel === 'components/ui/Tooltip.tsx') continue
    for (const t of tags(text)) {
      const bad =
        kind === 'select'
          ? t.name === 'select'
          : kind === 'title'
            ? DOM(t.name) && /(^|\s)title=/.test(t.attrs) && t.name !== 'svg'
            : t.name === 'input' && /type=""/.test(t.attrs) && /type="checkbox"/.test(text.split('\n').slice(t.line - 1, t.line + 6).join('\n'))
      if (bad) found.push(`${rel}:${t.line} <${t.name}>`)
    }
  }
  return found
}

describe('éléments natifs', () => {
  it('aucun <select> natif : utiliser components/ui/Select', () => {
    expect(offenders('select')).toEqual([])
  })
  it('aucun title= natif sur un élément : utiliser components/ui/Tooltip', () => {
    expect(offenders('title')).toEqual([])
  })
})
