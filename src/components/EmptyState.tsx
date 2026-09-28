import type { ReactNode } from 'react'

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-[46ch] text-sm leading-relaxed text-tx2">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
