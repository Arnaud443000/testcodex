import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PersonalRule } from '../types/settings';
import { settingsStore } from '../lib/settingsStore';
import { Field, inputClass } from '../components/Field';
import { FormSection } from '../components/FormSection';
import { AccountsManager } from '../components/AccountsManager';

export function SettingsPage() {
  const [settings, setSettings] = useState(() => settingsStore.get());
  const [newRule, setNewRule] = useState('');
  const [saved, setSaved] = useState(false);

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function addRule() {
    const label = newRule.trim();
    if (!label) return;
    const rule: PersonalRule = { id: crypto.randomUUID(), label };
    update('rules', [...settings.rules, rule]);
    setNewRule('');
  }

  function removeRule(id: string) {
    update(
      'rules',
      settings.rules.filter((rule) => rule.id !== id),
    );
  }

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
          Ces valeurs alimentent le score de discipline et les alertes de séance.
        </p>
      </header>

      <AccountsManager />

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <FormSection title="Risque">
          <Field label="Capital de référence (€)">
            <input
              type="number"
              step="any"
              min={0}
              className={inputClass}
              value={settings.capital}
              onChange={(e) => update('capital', Number(e.target.value))}
            />
          </Field>
          <Field label="Risque max par trade (% du capital)">
            <input
              type="number"
              step="any"
              min={0}
              className={inputClass}
              value={settings.maxRiskPercent}
              onChange={(e) => update('maxRiskPercent', Number(e.target.value))}
            />
          </Field>
        </FormSection>

        <FormSection title="Seuils d'alerte">
          <Field label="Pertes d'affilée avant alerte overtrading">
            <input
              type="number"
              min={1}
              step={1}
              className={inputClass}
              value={settings.maxConsecutiveLosses}
              onChange={(e) => update('maxConsecutiveLosses', Number(e.target.value))}
            />
          </Field>
          <Field label={'Perte journalière max avant alerte "stop pour aujourd\'hui" (%)'}>
            <input
              type="number"
              step="any"
              min={0}
              className={inputClass}
              value={settings.maxDailyLossPercent}
              onChange={(e) => update('maxDailyLossPercent', Number(e.target.value))}
            />
          </Field>
        </FormSection>

        <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">
            Règles personnelles
          </h2>

          {settings.rules.length === 0 ? (
            <p className="text-sm text-cream/40">
              Aucune règle définie. Ajoute-en une pour la retrouver en checklist avant chaque
              trade.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {settings.rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-background/60 px-4 py-2"
                >
                  <span className="text-sm text-cream">{rule.label}</span>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    aria-label={`Supprimer la règle ${rule.label}`}
                    className="rounded-full bg-danger/15 px-3 py-1 text-xs font-semibold text-danger transition hover:bg-danger/25"
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRule();
                }
              }}
              placeholder="Ex : jamais trader après 15h"
              aria-label="Nouvelle règle"
            />
            <button
              type="button"
              onClick={addRule}
              className="rounded-full bg-cream px-4 py-2 text-sm font-semibold text-background transition hover:brightness-95"
            >
              Ajouter
            </button>
          </div>
        </section>

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
