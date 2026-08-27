import type { AlertsResult } from '../lib/alerts';

export function AlertsPanel({ result }: { result: AlertsResult }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">
          Alertes actives
        </h2>
        <span className="text-xs text-cream/40">Journée du {result.day}</span>
      </div>

      {result.tradesToday === 0 ? (
        <p className="text-sm text-cream/40">
          Aucun trade aujourd'hui — les garde-fous de séance sont inactifs.
        </p>
      ) : result.alerts.length === 0 ? (
        <p className="text-sm text-success">
          Aucune alerte sur les {result.tradesToday} trade
          {result.tradesToday > 1 ? 's' : ''} du jour. Tes garde-fous sont respectés.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.alerts.map((alert) => (
            <li
              key={alert.kind}
              className={`flex flex-col gap-1 rounded-xl border px-4 py-3 ${
                alert.severity === 'danger'
                  ? 'border-danger/40 bg-danger/10'
                  : 'border-accent/40 bg-accent/10'
              }`}
            >
              <span
                className={`text-sm font-semibold ${
                  alert.severity === 'danger' ? 'text-danger' : 'text-accent'
                }`}
              >
                {alert.title}
              </span>
              <span className="text-xs text-cream/70">{alert.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
