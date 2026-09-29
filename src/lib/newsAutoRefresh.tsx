import { useEffect } from 'react'
import { api } from './api'

/**
 * Lot 25 : à l'ouverture de Pulse (après le déverrouillage), une seule demande d'actualisation automatique.
 * C'est pulse-core qui décide : rien si le calendrier est désactivé, sans flux en ligne, ou déjà essayé
 * aujourd'hui (jour de Paris). Une erreur est enregistrée et affichée dans le calendrier, jamais ici.
 */
export function NewsAutoRefresh() {
  useEffect(() => {
    api.refreshNews(false).catch(() => undefined)
  }, [])
  return null
}
