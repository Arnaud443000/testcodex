import type { ReactNode } from 'react'

/** `inline` : les actions se rangent juste à côté du titre (barre compacte) au lieu d'être repoussées à droite. */
export function PageHeader({ title, subtitle, actions, inline = false }: { title: string; subtitle?: string; actions?: ReactNode; inline?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 ${inline ? '' : 'justify-between'}`}>
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-tx2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}
