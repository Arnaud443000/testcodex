import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { localTzOffsetMin } from '../lib/period'
import type { ReminderDue } from '../types/journal'
import { Notice } from './ui'

/**
 * Filet de sécurité du rappel natif : la notification Windows ne permet pas de compter sur le clic ;
 * quand le rappel du jour est parti et qu'il reste du travail, cette bannière mène au journal du jour.
 */
export function ReminderBanner() {
  const t = useT()
  const r = t.reminder
  const location = useLocation()
  const [due, setDue] = useState<ReminderDue | null>(null)
  const [dismissedDay, setDismissedDay] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const check = () =>
      api
        .getReminderPending(localTzOffsetMin())
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

  if (!due || dismissedDay === due.day || location.pathname === '/journal') return null
  return (
    <div className="mb-5">
      <Notice
        level="warn"
        inline
        actions={
          <>
            <Link to={`/journal?day=${due.day}`} className="btn btn-primary btn-sm">{r.bannerOpen}</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissedDay(due.day)}>{r.bannerDismiss}</button>
          </>
        }
      >
        <strong>{r.bannerTitle}</strong>{' '}
        {[due.journalMissing ? r.bannerJournal : null, due.incompleteCount > 0 ? r.bannerIncomplete(due.incompleteCount) : null].filter(Boolean).join(' ')}
      </Notice>
    </div>
  )
}
