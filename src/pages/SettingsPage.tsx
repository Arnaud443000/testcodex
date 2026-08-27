import { useState } from 'react';
import type { FormEvent } from 'react';
import { settingsStore } from '../lib/settingsStore';
import { Field, inputClass } from '../components/Field';
import { FormSection } from '../components/FormSection';

export function SettingsPage() {
  const [settings, setSettings] = useState(() => settingsStore.get());
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    settingsStore.save(settings);
    setSaved(true);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-cream">Pulse — Réglages</h1>
        <p className="text-sm text-cream/60">
          Ces valeurs alimentent le score de discipline et les analyses de risque.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <FormSection title="Risque">
          <Field label="Capital de référence (€)">
            <input
              type="number"
              step="any"
              min={0}
              className={inputClass}
              value={settings.capital}
              onChange={(e) => {
                setSettings({ ...settings, capital: Number(e.target.value) });
                setSaved(false);
              }}
            />
          </Field>
          <Field label="Risque max par trade (% du capital)">
            <input
              type="number"
              step="any"
              min={0}
              className={inputClass}
              value={settings.maxRiskPercent}
              onChange={(e) => {
                setSettings({ ...settings, maxRiskPercent: Number(e.target.value) });
                setSaved(false);
              }}
            />
          </Field>
        </FormSection>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="rounded-full bg-gradient-to-r from-primary to-accent px-6 py-3 text-sm font-semibold text-cream shadow-lg shadow-primary/30 transition hover:brightness-110"
          >
            Enregistrer
          </button>
          {saved && <span className="text-sm text-success">Réglages enregistrés.</span>}
        </div>
      </form>
    </div>
  );
}
