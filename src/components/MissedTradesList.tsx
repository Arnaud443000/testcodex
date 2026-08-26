import { useState } from 'react';
import type { MissedTrade } from '../types/missedTrade';
import { MissedTradeForm } from './MissedTradeForm';

export function MissedTradesList({
  missedTrades,
  onChanged,
}: {
  missedTrades: MissedTrade[];
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-cream/60">
          {missedTrades.length} setup{missedTrades.length > 1 ? 's' : ''} manqué
          {missedTrades.length > 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-sm font-medium text-accent hover:text-cream"
        >
          {showForm ? 'Fermer le formulaire' : '+ Nouveau setup manqué'}
        </button>
      </div>

      {showForm && (
        <MissedTradeForm
          onSaved={() => {
            onChanged();
            setShowForm(false);
          }}
        />
      )}

      {missedTrades.length === 0 ? (
        <p className="rounded-xl bg-background/60 px-4 py-6 text-center text-sm text-cream/50">
          Aucun setup manqué enregistré.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-cream/50">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Actif</th>
                <th className="pb-2 pr-4">Raison</th>
                <th className="pb-2">Ce qui s'est passé ensuite</th>
              </tr>
            </thead>
            <tbody>
              {missedTrades.map((mt) => (
                <tr key={mt.id} className="border-t border-white/10">
                  <td className="py-2 pr-4 text-cream/80">{mt.date}</td>
                  <td className="py-2 pr-4 font-medium text-cream">{mt.asset}</td>
                  <td className="py-2 pr-4 text-cream/70">{mt.reason || '—'}</td>
                  <td className="py-2 text-cream/70">{mt.outcome || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
