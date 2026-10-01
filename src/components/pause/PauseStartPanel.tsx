import { useState } from 'react'
import { usePause } from '../../lib/pause'
import { PausePicker } from './PausePicker'

/** Bouton qui déplie le choix d'une pause dans le flux (cartes, pages) ; rien si une pause court déjà. */
export function PauseStartPanel({ label }: { label: string }) {
  const { current } = usePause()
  const [open, setOpen] = useState(false)
  if (current) return null
  return open ? (
    <div className="mt-3">
      <PausePicker focusOnOpen onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  ) : (
    <button type="button" className="btn btn-secondary btn-sm mt-3 self-start" onClick={() => setOpen(true)}>{label}</button>
  )
}
