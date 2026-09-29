import { useState } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { lockErrorText } from '../lib/lockView'
import { Notice } from './ui'

/**
 * Lot 22 : l'écriture du fichier chiffré a échoué (disque plein, droits…). Les données restent en
 * mémoire : bandeau critique, « Réessayer », ou fermer en acceptant de perdre ce qui n'est qu'en mémoire.
 */
export function PersistBanner() {
  const t = useT()
  const p = t.lock.persist
  const { persistFailed, clearPersistFailed, setStatus } = useLock()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!persistFailed) return null

  async function retry() {
    setBusy(true)
    try {
      const s = await api.retryPersist()
      setStatus(s)
      if (!s.persistFailed) {
        clearPersistFailed()
        setError(null)
      }
    } catch (e) {
      setError(lockErrorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  async function quit() {
    if (window.confirm(p.quitConfirm)) await api.quitDiscardingChanges()
  }

  return (
    <div className="mb-5" data-testid="persist-banner">
      <Notice
        level="bad"
        actions={
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void retry()}>{p.retry}</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void quit()}>{p.quit}</button>
          </>
        }
      >
        <div className="font-semibold">{p.title}</div>
        <p className="mt-1">{t.lock.errors.persistFailed}</p>
        {error && <p className="mt-1">{error}</p>}
      </Notice>
    </div>
  )
}
