// Lot 32 : sauvegarde automatique planifiée (miroir de pulse-core/src/backup_auto.rs).
import type { BackupInfo } from './data'

export type BackupFrequency = 'daily' | 'weekly'

export interface AutoBackupSettings {
  enabled: boolean
  /** Chemin absolu du dossier de destination, choisi par la boîte de dialogue native. */
  folder: string | null
  frequency: BackupFrequency
  /** Nombre de sauvegardes automatiques gardées (1 à 60). */
  keep: number
}

export interface FolderCheck {
  path: string
  /** Le dossier semble être sur le même lecteur que les données : avertir, sans refuser. */
  sameDrive: boolean
}

export interface AutoBackupStatus {
  settings: AutoBackupSettings
  lastSuccessAt: number | null
  lastAttemptAt: number | null
  /** Code du dernier échec (`diskFull`…), ou `pruneFailed` après une réussite. */
  lastError: string | null
  lastFailed: boolean
  /** Activée : premier instant de la prochaine sauvegarde (elle part au contrôle suivant, toutes les 30 min). */
  nextDueAt: number | null
  daysSinceSuccess: number | null
  /** Bannière « dernière sauvegarde ancienne » (au-delà de 2 × la fréquence, ou jamais réussie après un échec). */
  stale: boolean
  /** Bannière d'invitation « Protégez votre historique ». */
  invite: boolean
  /** Verrou actif : les sauvegardes sont chiffrées. */
  encrypted: boolean
  checkIntervalMs: number
}

export interface AutoBackupEntry {
  name: string
  path: string
  /** Date et heure locales écrites dans le nom : `AAAA-MM-JJ HH:MM`. */
  at: string
  sizeBytes: number
  encrypted: boolean
  /** Ne contient qu'une base et des captures (coup d'œil rapide, pas une relecture complète). */
  complete: boolean
}

export interface AutoBackupDone {
  info: BackupInfo
  name: string
  pruned: string[]
  pruneError: string | null
}

export interface AutoBackupSaved {
  status: AutoBackupStatus
  folderCheck: FolderCheck | null
}
