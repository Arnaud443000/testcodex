import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * État vide unique de l'application : une icône, un titre, une phrase qui dit quoi faire, et si possible l'action.
 * (lot 26 : l'icône est en tête partout, pour que les écrans vides se ressemblent.)
 */
export function EmptyState({ title, children, action, icon = 'library' }: { title: string; children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full text-tx-accent" style={{ background: 'var(--control)', border: '1px solid var(--glass-border)' }} aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-[46ch] text-sm leading-relaxed text-tx2">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
