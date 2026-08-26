import type { ReactNode } from 'react';

export function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
