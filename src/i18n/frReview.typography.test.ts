import { describe, expect, it } from 'vitest'
import { frReview } from './fr.review'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1], [0], [2], ['X']]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes du bilan hebdomadaire (lot 36)', () => {
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    const all = strings(frReview, 'review', [])
    expect(all.length).toBeGreaterThan(60)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(strings(frReview, 'review', []).filter(([, s]) => /\b(tu|ton|ta|tes)\b/i.test(s))).toEqual([])
  })
})

describe('ton du bilan (lot 36) : un constat, jamais un conseil, un reproche ni une cause', () => {
  const all = () => strings(frReview, 'review', [])
  it('n’écrit jamais « parce que », « à cause », ni de reproche', () => {
    expect(all().filter(([, s]) => /parce que|à cause|car vous|vous devez|il faut|il faudrait|vous auriez dû|échec|faute|mauvais(e)? (trader|discipline)/i.test(s))).toEqual([])
  })
  it('pose les trois questions demandées, telles quelles', () => {
    expect(Object.values(frReview.answers.questions)).toEqual([
      'Qu’est-ce qui s’est bien passé cette semaine ?',
      'Qu’est-ce que je referais autrement ?',
      'Quelle est ma priorité pour la semaine prochaine ?',
    ])
  })
  it('offre les quatre réponses de suivi', () => {
    expect([...Object.values(frReview.lastWeek.outcomes), frReview.lastWeek.unknown]).toEqual(['Tenue', 'En partie', 'Pas tenue', 'Je ne sais pas'])
  })
})
