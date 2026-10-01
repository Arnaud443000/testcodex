/** État du verrouillage par mot de passe (lot 22), renvoyé par pulse-core::lock::status. Aucun secret. */
export interface LockStatus {
  /** La base est chiffrée sur le disque. */
  enabled: boolean
  /** Chiffrée et pas encore déverrouillée : rien ne peut être lu. */
  locked: boolean
  /** Millisecondes avant le prochain essai autorisé (0 = tout de suite). */
  retryAfterMs: number
  failures: number
  /** Minutes sans activité avant le verrouillage automatique ; null = jamais. Connu seulement déverrouillé. */
  idleMinutes: number | null
  /** La dernière écriture du fichier chiffré a échoué : les modifications récentes ne sont qu'en mémoire. */
  persistFailed: boolean
  /** Code `lock:inconsistentFiles` quand deux bases ont été trouvées au démarrage. */
  warning: string | null
  /** Copies de sécurité en clair du dossier « backups » (proposées au chiffrement à l'activation). */
  plainCopies: string[]
  minPasswordChars: number
}
