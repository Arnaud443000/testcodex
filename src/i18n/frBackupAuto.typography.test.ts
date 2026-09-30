import { describe, expect, it } from 'vitest'
import { frBackupAuto } from './fr.backupAuto'

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === 'string') out.push([path, value])
  else if (typeof value === 'function') {
    for (const args of [[1], [0], [2], ['X'], ['X', 1, 2]]) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${path}()`, out)
      } catch {
        /* fonction qui attend un autre type d'argument */
      }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out)
  return out
}

describe('typographie des textes de la sauvegarde automatique (lot 32)', () => {
  it('espace insécable avant : ; ? ! % » et après «, jamais une espace ordinaire', () => {
    const all = strings(frBackupAuto, 'backupAuto', [])
    expect(all.length).toBeGreaterThan(50)
    expect(all.filter(([, s]) => / [:;?!%»]|« /.test(s))).toEqual([])
  })
  it('vouvoie (aucun « tu », « ton », « ta »)', () => {
    expect(strings(frBackupAuto, 'backupAuto', []).filter(([, s]) => /\b(tu|ton|ta|tes)\b/i.test(s))).toEqual([])
  })
  it('un texte pour chaque code d’erreur de pulse-core', () => {
    const codes = ['noFolder', 'notAbsolute', 'folderNotFound', 'notAFolder', 'insideDataFolder', 'notWritable', 'diskFull', 'fileInUse',
      'verifyFailed', 'alreadyExists', 'busy', 'locked', 'interrupted', 'invalidKeep', 'pruneFailed', 'io']
    expect(codes.filter((c) => !frBackupAuto.errors[c])).toEqual([])
  })
  it('le texte demandé pour le même lecteur', () => {
    expect(frBackupAuto.sameDrive).toContain('Pour vous protéger d’une panne de disque, choisissez un autre lecteur ou un dossier synchronisé')
  })
})
