import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { MistakeType, Trade, TradeSide, TradeType } from '../types/trade';
import { MISTAKE_TYPES } from '../types/trade';
import { tradesStore } from '../lib/tradesStore';
import { settingsStore } from '../lib/settingsStore';
import { computePnl } from '../lib/pnl';
import { EMOTIONS, MARKET_CONDITIONS, SESSIONS } from '../lib/tradeOptions';
import { Field, inputClass } from './Field';
import { FormSection } from './FormSection';

interface TradeFormState {
  asset: string;
  side: TradeSide;
  date: string;
  session: string;
  timeframe: string;
  tradeType: TradeType | '';
  entryTime: string;
  exitTime: string;
  entryPrice: string;
  exitPrice: string;
  size: string;
  stopLoss: string;
  takeProfit: string;
  fees: string;
  setup: string;
  marketCondition: string;
  thesis: string;
  confidenceLevel: string;
  emotionBefore: string;
  emotionAfter: string;
  followedPlan: boolean;
  executionQuality: string;
  starRating: string;
  postMortem: string;
  screenshot: string;
  mistakeTypes: MistakeType[];
  ruleCompliance: Record<string, boolean>;
}

const emptyForm: TradeFormState = {
  asset: '',
  side: 'long',
  date: '',
  session: SESSIONS[0],
  timeframe: '',
  tradeType: '',
  entryTime: '',
  exitTime: '',
  entryPrice: '',
  exitPrice: '',
  size: '',
  stopLoss: '',
  takeProfit: '',
  fees: '',
  setup: '',
  marketCondition: MARKET_CONDITIONS[0],
  thesis: '',
  confidenceLevel: '5',
  emotionBefore: EMOTIONS[0],
  emotionAfter: EMOTIONS[0],
  followedPlan: true,
  executionQuality: '3',
  starRating: '3',
  postMortem: '',
  screenshot: '',
  mistakeTypes: [],
  ruleCompliance: {},
};

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function TradeForm({ onSaved }: { onSaved?: (trade: Trade) => void }) {
  const rules = useMemo(() => settingsStore.get().rules, []);
  const [form, setForm] = useState<TradeFormState>(emptyForm);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  function set<K extends keyof TradeFormState>(key: K, value: TradeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedMessage(null);
    setPendingConfirm(false);
  }

  const brokenRules = rules.filter((rule) => !form.ruleCompliance[rule.id]);

  const pnl = useMemo(
    () =>
      computePnl(
        form.side,
        parseNumber(form.entryPrice),
        parseNumber(form.exitPrice),
        parseNumber(form.size),
        parseNumber(form.fees) ?? 0,
      ),
    [form.side, form.entryPrice, form.exitPrice, form.size, form.fees],
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // A trade breaking your own rules is exactly what this journal exists to
    // record, so saving is never blocked outright — but it takes a second,
    // deliberate click, so a rule can't be skipped absent-mindedly.
    if (brokenRules.length > 0 && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    const trade: Trade = {
      id: crypto.randomUUID(),
      asset: form.asset,
      side: form.side,
      entryPrice: parseNumber(form.entryPrice) ?? 0,
      exitPrice: parseNumber(form.exitPrice) ?? 0,
      size: parseNumber(form.size) ?? 0,
      stopLoss: parseNumber(form.stopLoss) ?? 0,
      takeProfit: parseNumber(form.takeProfit) ?? 0,
      fees: parseNumber(form.fees) ?? 0,
      date: form.date,
      session: form.session,
      setup: form.setup,
      timeframe: form.timeframe,
      marketCondition: form.marketCondition,
      confidenceLevel: parseNumber(form.confidenceLevel) ?? 5,
      emotionBefore: form.emotionBefore,
      emotionAfter: form.emotionAfter,
      followedPlan: form.followedPlan,
      thesis: form.thesis,
      postMortem: form.postMortem,
      executionQuality: parseNumber(form.executionQuality) ?? 3,
      starRating: parseNumber(form.starRating) ?? 3,
      screenshot: form.screenshot || undefined,
      closed: true,
      tradeType: form.tradeType || undefined,
      mistakeTypes: form.mistakeTypes.length > 0 ? form.mistakeTypes : undefined,
      entryTime: form.entryTime || undefined,
      exitTime: form.exitTime || undefined,
      ruleCompliance:
        rules.length > 0
          ? Object.fromEntries(
              rules.map((rule) => [rule.id, Boolean(form.ruleCompliance[rule.id])]),
            )
          : undefined,
    };

    tradesStore.create(trade);
    setForm(emptyForm);
    setSavedMessage(`Trade sur ${trade.asset || 'l’actif'} enregistré.`);
    onSaved?.(trade);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FormSection title="1. Infos de base">
        <Field label="Actif">
          <input
            className={inputClass}
            value={form.asset}
            onChange={(e) => set('asset', e.target.value)}
            placeholder="EURUSD, BTC, AAPL..."
            required
          />
        </Field>
        <Field label="Sens">
          <select
            className={inputClass}
            value={form.side}
            onChange={(e) => set('side', e.target.value as TradeSide)}
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
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
        <Field label="Session">
          <select
            className={inputClass}
            value={form.session}
            onChange={(e) => set('session', e.target.value)}
          >
            {SESSIONS.map((session) => (
              <option key={session} value={session}>
                {session}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timeframe">
          <input
            className={inputClass}
            value={form.timeframe}
            onChange={(e) => set('timeframe', e.target.value)}
            placeholder="M15, H1, D1..."
          />
        </Field>
        <Field label="Heure d'entrée">
          <input
            type="time"
            className={inputClass}
            value={form.entryTime}
            onChange={(e) => set('entryTime', e.target.value)}
          />
        </Field>
        <Field label="Heure de sortie">
          <input
            type="time"
            className={inputClass}
            value={form.exitTime}
            onChange={(e) => set('exitTime', e.target.value)}
          />
        </Field>
        <Field label="Type de trade">
          <select
            className={inputClass}
            value={form.tradeType}
            onChange={(e) => set('tradeType', e.target.value as TradeFormState['tradeType'])}
          >
            <option value="">Non tagué</option>
            <option value="system">Système</option>
            <option value="discretionary">Discrétionnaire</option>
          </select>
        </Field>
      </FormSection>

      <FormSection title="2. Prix et taille">
        <Field label="Prix d'entrée">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.entryPrice}
            onChange={(e) => set('entryPrice', e.target.value)}
            required
          />
        </Field>
        <Field label="Prix de sortie">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.exitPrice}
            onChange={(e) => set('exitPrice', e.target.value)}
            required
          />
        </Field>
        <Field label="Taille">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.size}
            onChange={(e) => set('size', e.target.value)}
            required
          />
        </Field>
        <Field label="Frais">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.fees}
            onChange={(e) => set('fees', e.target.value)}
          />
        </Field>
        <Field label="Stop loss">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.stopLoss}
            onChange={(e) => set('stopLoss', e.target.value)}
          />
        </Field>
        <Field label="Take profit">
          <input
            type="number"
            step="any"
            className={inputClass}
            value={form.takeProfit}
            onChange={(e) => set('takeProfit', e.target.value)}
          />
        </Field>

        <div className="sm:col-span-2 flex items-center gap-2 rounded-xl bg-background/60 px-4 py-3">
          <span className="text-sm text-cream/70">PnL</span>
          {pnl === null ? (
            <span className="text-sm text-cream/40">
              Renseigne entrée, sortie et taille
            </span>
          ) : (
            <span
              className={`text-lg font-semibold tabular-nums ${
                pnl >= 0 ? 'text-success' : 'text-danger'
              }`}
            >
              {pnl >= 0 ? '+' : ''}
              {pnl.toFixed(2)}
            </span>
          )}
        </div>
      </FormSection>

      <FormSection title="3. Contexte">
        <Field label="Setup">
          <input
            className={inputClass}
            value={form.setup}
            onChange={(e) => set('setup', e.target.value)}
            placeholder="Breakout, pullback..."
          />
        </Field>
        <Field label="Condition de marché">
          <select
            className={inputClass}
            value={form.marketCondition}
            onChange={(e) => set('marketCondition', e.target.value)}
          >
            {MARKET_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title='4. Le "pourquoi"'>
        <div className="sm:col-span-2">
          <Field label="Thèse d'entrée">
            <textarea
              className={inputClass}
              rows={3}
              value={form.thesis}
              onChange={(e) => set('thesis', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Confiance avant résultat (1-10)">
          <input
            type="number"
            min={1}
            max={10}
            className={inputClass}
            value={form.confidenceLevel}
            onChange={(e) => set('confidenceLevel', e.target.value)}
          />
        </Field>
        <Field label="Émotion avant">
          <select
            className={inputClass}
            value={form.emotionBefore}
            onChange={(e) => set('emotionBefore', e.target.value)}
          >
            {EMOTIONS.map((emotion) => (
              <option key={emotion} value={emotion}>
                {emotion}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Émotion après">
          <select
            className={inputClass}
            value={form.emotionAfter}
            onChange={(e) => set('emotionAfter', e.target.value)}
          >
            {EMOTIONS.map((emotion) => (
              <option key={emotion} value={emotion}>
                {emotion}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-cream/80">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/20 bg-surface accent-accent"
            checked={form.followedPlan}
            onChange={(e) => set('followedPlan', e.target.checked)}
          />
          Plan respecté
        </label>
      </FormSection>

      <FormSection title="5. Après coup">
        <Field label="Note d'exécution (1-5)">
          <input
            type="number"
            min={1}
            max={5}
            className={inputClass}
            value={form.executionQuality}
            onChange={(e) => set('executionQuality', e.target.value)}
          />
        </Field>
        <Field label="Notation étoiles (1-5)">
          <input
            type="number"
            min={1}
            max={5}
            className={inputClass}
            value={form.starRating}
            onChange={(e) => set('starRating', e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Post-mortem">
            <textarea
              className={inputClass}
              rows={3}
              value={form.postMortem}
              onChange={(e) => set('postMortem', e.target.value)}
            />
          </Field>
        </div>
        <div className="sm:col-span-2 flex flex-col gap-2">
          <span className="text-sm text-cream/70">Types d'erreur</span>
          <div className="flex flex-wrap gap-2">
            {MISTAKE_TYPES.map((mistake) => {
              const selected = form.mistakeTypes.includes(mistake);
              return (
                <button
                  key={mistake}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    set(
                      'mistakeTypes',
                      selected
                        ? form.mistakeTypes.filter((m) => m !== mistake)
                        : [...form.mistakeTypes, mistake],
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    selected
                      ? 'bg-gradient-to-r from-primary to-accent text-cream'
                      : 'bg-surface text-cream/60 hover:text-cream'
                  }`}
                >
                  {mistake}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label="Screenshot (optionnel)">
            <input
              type="file"
              accept="image/*"
              className="text-sm text-cream/70 file:mr-3 file:rounded-full file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-cream file:hover:bg-white/10"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => set('screenshot', reader.result as string);
                reader.readAsDataURL(file);
              }}
            />
          </Field>
          {form.screenshot && (
            <img
              src={form.screenshot}
              alt="Aperçu du screenshot"
              className="mt-3 max-h-40 rounded-xl border border-white/10"
            />
          )}
        </div>
      </FormSection>

      {rules.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cream/80">
            Checklist — mes règles
          </h2>
          <div className="flex flex-col gap-2">
            {rules.map((rule) => (
              <label
                key={rule.id}
                className="flex items-center gap-2 text-sm text-cream/80"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-surface accent-accent"
                  checked={Boolean(form.ruleCompliance[rule.id])}
                  onChange={(e) =>
                    set('ruleCompliance', {
                      ...form.ruleCompliance,
                      [rule.id]: e.target.checked,
                    })
                  }
                />
                {rule.label}
              </label>
            ))}
          </div>
          {brokenRules.length > 0 && (
            <p className="text-xs text-cream/50">
              {brokenRules.length} règle{brokenRules.length > 1 ? 's' : ''} non cochée
              {brokenRules.length > 1 ? 's' : ''} — le trade reste enregistrable, mais il sera
              marqué comme tel.
            </p>
          )}
        </section>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          className={`rounded-full px-6 py-3 text-sm font-semibold shadow-lg transition hover:brightness-110 ${
            pendingConfirm
              ? 'bg-danger text-cream shadow-danger/30'
              : 'bg-gradient-to-r from-primary to-accent text-cream shadow-primary/30'
          }`}
        >
          {pendingConfirm
            ? `Enregistrer quand même (${brokenRules.length} règle${
                brokenRules.length > 1 ? 's' : ''
              } non respectée${brokenRules.length > 1 ? 's' : ''})`
            : 'Enregistrer le trade'}
        </button>
        {savedMessage && (
          <span className="text-sm text-success">{savedMessage}</span>
        )}
      </div>
    </form>
  );
}
