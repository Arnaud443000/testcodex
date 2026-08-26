import type { ReactNode } from 'react';

export const inputClass =
  'rounded-xl border border-white/10 bg-surface px-3 py-2 text-cream placeholder:text-cream/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40';

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-cream/70">{label}</span>
      {children}
    </label>
  );
}
