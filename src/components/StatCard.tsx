import { Sparkline } from './Sparkline';

export function StatCard({
  label,
  value,
  delta,
  tone = 'accent',
  trend,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: 'success' | 'danger' | 'accent';
  trend?: number[];
}) {
  const deltaTone =
    tone === 'accent'
      ? 'text-cream/50'
      : tone === 'success'
        ? 'text-success'
        : 'text-danger';

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-surface p-5">
      <span className="text-xs uppercase tracking-wide text-cream/50">{label}</span>
      <span
        className={`text-2xl font-semibold tabular-nums ${
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-cream'
        }`}
      >
        {value}
      </span>
      {delta && <span className={`text-xs ${deltaTone}`}>{delta}</span>}
      {trend && <Sparkline data={trend} tone={tone} />}
    </div>
  );
}
