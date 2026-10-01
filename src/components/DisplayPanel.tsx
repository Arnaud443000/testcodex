import { useT } from '../i18n'
import { EFFECTS_PREFERENCES, useEffects, type EffectsPreference } from '../lib/effects'
import { Segmented } from './ui'

/** Paramètres > Affichage : réglage « Réduire les effets » (charte 7). Le choix est gardé localement. */
export function DisplayPanel() {
  const d = useT().settings.display
  const { preference, mode, setPreference } = useEffects()
  return (
    <section className="glass-card p-6" aria-labelledby="display-title" id="affichage">
      <h2 id="display-title" className="mb-1 text-base font-semibold">{d.title}</h2>
      <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-tx2">{d.intro}</p>
      <div className="flex flex-wrap items-center gap-4">
        <span id="effects-label" className="caption">{d.label}</span>
        <div className="w-full max-w-[460px]">
          <Segmented<EffectsPreference>
            value={preference}
            label={d.label}
            onChange={(v) => v && setPreference(v)}
            options={EFFECTS_PREFERENCES.map((value) => ({ value, label: d.options[value] }))}
          />
        </div>
      </div>
      <p className="mt-3 text-[13px] text-tx2" role="status" data-testid="effects-state">{d.state[mode]}</p>
      <p className="mt-1 text-[13px] text-tx3">{d.autoHint} {d.stored}</p>
    </section>
  )
}
