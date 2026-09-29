/** Contenu d'une sauvegarde (renvoyé par pulse-core::backup). */
export interface BackupInfo {
  /** Dossier de la sauvegarde. */
  path: string
  schemaVersion: number
  accounts: number
  trades: number
  screenshots: number
}

export interface RestoreResult {
  info: BackupInfo
  /** Copie de la base telle qu'elle était juste avant la restauration. */
  safetyCopy: string
}
