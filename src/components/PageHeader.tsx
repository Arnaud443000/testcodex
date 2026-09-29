import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-tx2">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  )
}
