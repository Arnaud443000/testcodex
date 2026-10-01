import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { localTzOffsetMin } from '../lib/period'
import { REVIEW_CHANGED } from '../lib/reviewEvents'
import type { ReviewBanner as Banner } from '../types/analysis'
import { Notice } from './ui'

/**
 * Bannière de la revue du matin (lot 31) : « Revue du matin : N idées à revoir ». Dans le flux normal de la page (jamais fixe),
 * comme celle du rappel du journal. pulse-core décide (jour local changé depuis la dernière revue ET au moins une idée à revoir,
 * les idées reportées ne comptent pas) ; la lecture n'écrit rien. Elle se remet à jour à l'ouverture, à chaque changement de page,
 * au retour sur la fenêtre, chaque minute (passage de minuit) et dès qu'une idée est traitée. Aucune notification Windows.
 */
export function ReviewBanner() {
  const t = useT()
  const b = t.analysis.banner
  const location = useLocation()
  const [banner, setBanner] = useState<Banner | null>(null)

  const check = useCallback(() => api.getReviewBanner(localTzOffsetMin()).then(setBanner).catch(() => setBanner(null)), [])
  useEffect(() => {
    void check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    window.addEventListener(REVIEW_CHANGED, check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener(REVIEW_CHANGED, check)
    }
  }, [check, location.pathname])

  const onIdeas = location.pathname === '/analysis' && new URLSearchParams(location.search).get('tab') === 'ideas'
  if (!banner || onIdeas) return null
  return (
    <div className="mb-5">
      <Notice
        level="warn"
        inline
        actions={
          <>
            <Link to="/analysis?tab=ideas" className="btn btn-primary btn-sm">{b.open}</Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void api.dismissReviewBanner(localTzOffsetMin()).then(() => setBanner(null)).catch(() => setBanner(null))}
            >
              {b.later}
            </button>
          </>
        }
      >
        <strong>{b.title(banner.count)}</strong>
      </Notice>
    </div>
  )
}
