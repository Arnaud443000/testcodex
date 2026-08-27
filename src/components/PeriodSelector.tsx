import { PERIODS, type Period } from '../lib/stats';

export function PeriodSelector({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-surface p-1">
      {PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            value === period
              ? 'bg-gradient-to-r from-primary to-accent text-cream'
              : 'text-cream/60 hover:text-cream'
          }`}
        >
          {period}
        </button>
      ))}
    </div>
  );
}
