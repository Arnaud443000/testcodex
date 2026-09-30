import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { usePause } from '../../lib/pause'
import { localTzOffsetMin } from '../../lib/period'
import type { PauseSuggestion } from '../../types/pause'
import { Notice } from '../ui'
import { PausePicker } from './PausePicker'

/**
 * Proposition de pause (réglage « après N pertes d'affilée », désactivé par défaut) : une phrase et un bouton.
 * Elle ne démarre JAMAIS une pause toute seule. « Pas maintenant » la masque jusqu'à une perte de plus.
 * Elle se relit à l'ouverture, à chaque changement de page, au retour sur la fenêtre et toutes les minutes.
 */
export function PauseSuggestionBanner() {
  const t = useT().pause
  const location = useLocation()
  const { current, changes } = usePause()
  const [suggestion, setSuggestion] = useState<PauseSuggestion | null>(null)
  const [later, setLater] = useState<number>(0) // nombre de pertes au moment où l'on a dit « pas maintenant »
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    let live = true
    const check = () =>
      api
        .getPauseSuggestion([], localTzOffsetMin())
        .then((s) => live && setSuggestion(s))
        .catch(() => live && setSuggestion(null))
    void check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [location.pathname, changes])

  if (current || !suggestion || suggestion.losses <= later) return null
  return (
    <div className="mb-5">
      <Notice
        level="warn"
        inline
        actions={
          !choosing && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChoosing(true)}>{t.suggestion.accept}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLater(suggestion.losses)}>{t.suggestion.later}</button>
            </>
          )
        }
      >
        <strong className="block">{t.suggestion.title(suggestion.losses)}</strong>
        {t.suggestion.text}
      </Notice>
      {choosing && (
        <section className="glass-card mt-4 p-5" aria-label={t.picker.title}>
          <PausePicker reason="lossStreak" focusOnOpen onDone={() => setChoosing(false)} onCancel={() => setChoosing(false)} />
        </section>
      )}
    </div>
  )
}
