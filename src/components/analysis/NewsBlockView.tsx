import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import type { NewsBlock } from '../../types/analysis'
import { Icon } from '../Icon'

/** Annonces fortes du jour (lecture seule, lues dans le calendrier déjà stocké) : le dire clairement quand il n'y en a pas. */
export function NewsBlockView({ block }: { block: NewsBlock }) {
  const n = useT().analysis.news
  if (block.state === 'off') {
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-inner border px-4 py-3" style={{ borderColor: 'var(--hairline)', background: 'var(--control)' }}>
        <span className="mt-0.5 text-tx3"><Icon name="calendar" size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{n.off}</p>
          <p className="text-[13px] text-tx2">{n.offHint}</p>
          <Link className="btn-link" to="/settings#news">{n.offLink}</Link>
        </div>
      </div>
    )
  }
  if (block.state === 'none') {
    return (
      <div className="flex items-start gap-3 rounded-inner border px-4 py-3" style={{ borderColor: 'var(--hairline)', background: 'var(--control)' }}>
        <span className="mt-0.5 text-tx3"><Icon name="check" size={18} /></span>
        <div>
          <p className="text-sm font-semibold">{n.none}</p>
          <p className="text-[13px] text-tx2">{n.noneHint}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-inner border px-4 py-3" style={{ borderColor: 'var(--hairline)', background: 'var(--control)' }}>
      <p className="caption mb-1.5">{n.heading}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {block.events.map((e) => (
          <li key={e.id} className="tabular-nums">
            {e.parisTime ? n.event(e.title, e.currency, e.parisTime) : n.eventNoTime(e.title, e.currency)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-tx3">{n.readOnly}</p>
    </div>
  )
}
