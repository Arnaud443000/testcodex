import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MissedTrade } from '../types/missedTrade';
import { missedTradesStore } from '../lib/missedTradesStore';
import { Field, inputClass } from './Field';
import { FormSection } from './FormSection';

interface MissedTradeFormState {
  asset: string;
  date: string;
  reason: string;
  outcome: string;
}

const emptyForm: MissedTradeFormState = {
  asset: '',
  date: '',
  reason: '',
  outcome: '',
};

export function MissedTradeForm({
  onSaved,
}: {
  onSaved?: (missedTrade: MissedTrade) => void;
}) {
  const [form, setForm] = useState<MissedTradeFormState>(emptyForm);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  function set<K extends keyof MissedTradeFormState>(
    key: K,
    value: MissedTradeFormState[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedMessage(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const missedTrade: MissedTrade = {
      id: crypto.randomUUID(),
      asset: form.asset,
      date: form.date,
      reason: form.reason,
      outcome: form.outcome,
    };

    missedTradesStore.create(missedTrade);
    setForm(emptyForm);
    setSavedMessage(`Setup manqué sur ${missedTrade.asset || 'l’actif'} noté.`);
    onSaved?.(missedTrade);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FormSection title="Setup vu, non tradé">
        <Field label="Actif">
          <input
            className={inputClass}
            value={form.asset}
            onChange={(e) => set('asset', e.target.value)}
            placeholder="EURUSD, BTC, AAPL..."
            required
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Raison du renoncement">
            <textarea
              className={inputClass}
              rows={2}
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="Peur, doute, hors règles..."
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Ce qui s'est passé ensuite">
            <textarea
              className={inputClass}
              rows={2}
              value={form.outcome}
              onChange={(e) => set('outcome', e.target.value)}
            />
          </Field>
        </div>
      </FormSection>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className="rounded-full bg-gradient-to-r from-primary to-accent px-6 py-3 text-sm font-semibold text-cream shadow-lg shadow-primary/30 transition hover:brightness-110"
        >
          Enregistrer
        </button>
        {savedMessage && (
          <span className="text-sm text-success">{savedMessage}</span>
        )}
      </div>
    </form>
  );
}
