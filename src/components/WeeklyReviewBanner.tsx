import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { localTzOffsetMin } from '../lib/period'
import type { ReviewDue } from '../types/review'
import { Notice } from './ui'

/**
 * Bannière du bilan du dimanche (lot 36) : « Votre bilan de la semaine est prêt ». Dans le flux normal de la page
 * (jamais fixe), comme les autres bannières de la coque ; jamais bloquante, aucune notification Windows. pulse-core décide :
 * le rappel est armé le dimanche à l'heure réglée (18:00 par défaut), une seule fois par semaine, seulement s'il y a eu un
 * trade clôturé ou une entrée de journal dans la semaine, et la bannière disparaît quand le bilan est terminé ou que
 * vous choisissez « Plus tard ». Verrouillé : aucune lecture (la commande répond `lock:locked`, la bannière reste absente).
 */
export function WeeklyReviewBanner() {
  const r = useT().review
  const location = useLocation()
  const [due, setDue] = useState<ReviewDue | null>(null)

  useEffect(() => {
    let live = true
    const check = () =>
      api
        .getReviewReminderPending(localTzOffsetMin())
        .then((d) => live && setDue(d))
        .catch(() => live && setDue(null))
    void check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [location.pathname])

  if (!due || location.pathname === '/review') return null
  const detail = r.banner.detail(due.closedTradeCount, due.journalDays)
  return (
    <div className="mb-5" data-testid="weekly-review-banner">
      <Notice
        level="warn"
        inline
        actions={
          <>
            <Link to={`/review?week=${due.periodKey}`} className="btn btn-primary btn-sm">{r.banner.open}</Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void api.dismissReviewReminder(localTzOffsetMin()).then(() => setDue(null)).catch(() => setDue(null))}
            >
              {r.banner.later}
            </button>
          </>
        }
      >
        <strong>{r.banner.title}</strong>
        {detail && <span className="ml-2 text-tx2">{detail}</span>}
      </Notice>
    </div>
  )
}
