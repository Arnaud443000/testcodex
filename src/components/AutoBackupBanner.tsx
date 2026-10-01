import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { backupErrorText, bannerFor } from '../lib/backupAutoView'
import { localTzOffsetMin } from '../lib/period'
import type { AutoBackupStatus } from '../types/backupAuto'
import { Notice } from './ui'

/**
 * Lot 32 : bannière de la coque, dans le flux normal de la page (jamais fixe), sur le modèle de celle du
 * rappel. « Votre dernière sauvegarde réussie date de N jours » quand pulse-core le décide (au-delà de
 * 2 × la fréquence), sinon, une seule fois, l'invitation « Protégez votre historique ». Rien n'est activé ici.
 */
export function AutoBackupBanner() {
  const t = useT()
  const b = t.backupAuto.banner
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<AutoBackupStatus | null>(null)
  const [dismissedStale, setDismissedStale] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    let off: (() => void) | undefined
    const check = () =>
      api
        .getAutoBackupStatus(localTzOffsetMin())
        .then((s) => live && setStatus(s))
        .catch(() => live && setStatus(null))
    void check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    void api.onAutoBackupEvent(() => void check()).then((f) => (live ? (off = f) : f()))
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      off?.()
    }
  }, [location.pathname])

  const banner = bannerFor(status, { onSettings: location.pathname === '/settings', dismissedStale })
  if (!banner) return null

  async function answer(accept: boolean) {
    setBusy(true)
    try {
      await api.answerAutoBackupInvite(accept)
      setStatus((s) => (s ? { ...s, invite: false } : s))
      if (accept) navigate('/settings#sauvegarde')
    } finally {
      setBusy(false)
    }
  }

  if (banner.kind === 'invite') {
    return (
      <div className="mb-5">
        <Notice
          level="ok"
          inline
          actions={
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void answer(true)}>{b.activate}</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void answer(false)}>{b.later}</button>
            </>
          }
        >
          <strong>{b.inviteTitle}</strong> {b.invite}
        </Notice>
      </div>
    )
  }

  return (
    <div className="mb-5">
      <Notice
        level="warn"
        inline
        actions={
          <>
            <Link to="/settings#sauvegarde" className="btn btn-primary btn-sm">{b.settings}</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissedStale(true)}>{b.dismiss}</button>
          </>
        }
      >
        <strong>{banner.days === null ? b.neverTitle : b.staleTitle(banner.days)}</strong>
        {banner.cause && <> {b.cause(backupErrorText(t, banner.cause))}</>}
      </Notice>
    </div>
  )
}
