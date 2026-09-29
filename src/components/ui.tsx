import type { ReactNode } from 'react'
import { useT } from '../i18n'
import { formatSignedMoney } from '../lib/format'
import { signOf } from '../lib/decimal'
import type { Decimal } from '../types/money'
import type { Outcome } from '../types/trade'
import { Icon } from './Icon'

/** Libellé caption au-dessus d'un champ (charte 5.4). */
export function Field({
  label,
  htmlFor,
  error,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="caption">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-[#F5A198]">
          {error}
        </p>
      )}
    </div>
  )
}

/** Champ avec un suffixe (unité) à droite, en tx3. */
export function InputWithSuffix({ suffix, children }: { suffix?: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-tx3">{suffix}</span>}
    </div>
  )
}

/** Contrôle segmenté (Long/Short, Discrétionnaire/Système…). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  allowClear = false,
}: {
  value: T | null
  options: { value: T; label: string; tone?: 'gain' | 'loss' }[]
  onChange: (v: T | null) => void
  label: string
  allowClear?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="control flex h-[42px] gap-0.5 p-[3px]">
      {options.map((o) => {
        const on = value === o.value
        const style = on
          ? o.tone === 'gain'
            ? { background: 'rgba(95,203,158,.28)', color: '#9BE3C4' }
            : o.tone === 'loss'
              ? { background: 'rgba(240,119,107,.26)', color: '#F5A198' }
              : { background: 'var(--grad)', color: '#fff' }
          : undefined
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on && allowClear ? null : o.value)}
            className={`flex-1 rounded-[11px] px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet ${
              on ? '' : 'text-tx2 hover:text-tx'
            }`}
            style={style}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Choix parmi des tags (une seule valeur, ou plusieurs). */
export function ChipButton({
  on,
  onClick,
  children,
  bad = false,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  bad?: boolean
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`chip ${on ? (bad ? 'chip-bad' : 'chip-on') : ''}`}>
      {children}
    </button>
  )
}

/** Cinq segments de qualité (charte 5.5). */
export function QualityBar({ value, onChange, label }: { value: number | null; onChange?: (v: number | null) => void; label: string }) {
  const t = useT()
  return (
    <div role={onChange ? 'group' : 'img'} aria-label={onChange ? label : value ? t.form.segments(value) : label} className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== null && n <= value
        const bar = (
          <span
            className="block h-2 w-[30px] rounded-full"
            style={{ background: filled ? 'var(--grad)' : 'rgba(255,255,255,.12)' }}
          />
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            aria-label={t.form.segments(n)}
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className="py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
          >
            {bar}
          </button>
        ) : (
          <span key={n}>{bar}</span>
        )
      })}
    </div>
  )
}

/** Étoiles (charte 5.5) : #D9A85A. */
export function StarRating({ value, onChange, label }: { value: number | null; onChange?: (v: number | null) => void; label: string }) {
  const t = useT()
  return (
    <div role={onChange ? 'group' : 'img'} aria-label={onChange ? label : value ? t.form.star(value) : label} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== null && n <= value
        const star = (
          <span aria-hidden="true" className={`text-[18px] leading-none ${filled ? 'text-warn' : 'text-white/20'}`}>
            ★
          </span>
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            aria-label={t.form.star(n)}
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className="px-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </div>
  )
}

/** P&L exact : signe + / − toujours écrit, couleur en renfort seulement (charte 2.3). */
export function Pnl({ value, currency, className = '' }: { value: Decimal; currency: string; className?: string }) {
  const s = signOf(value)
  return (
    <span className={`${s > 0 ? 'text-gain' : s < 0 ? 'text-loss' : 'text-neutral'} ${className}`}>
      {formatSignedMoney(value, currency)}
    </span>
  )
}

/** Badge de résultat avec libellé (jamais la couleur seule). */
export function OutcomeBadge({ outcome }: { outcome: Outcome | 'open' }) {
  const t = useT()
  const cls = outcome === 'win' ? 'badge-gain' : outcome === 'loss' ? 'badge-loss' : outcome === 'open' ? 'badge-warn' : 'badge-neutral'
  return <span className={`badge ${cls}`}>{t.common.outcomes[outcome]}</span>
}

/** Bandeau (charte 5.6). */
export function Notice({ level, children, actions }: { level: 'ok' | 'warn' | 'bad'; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role={level === 'bad' ? 'alert' : 'status'} className={`nt nt-${level}`}>
      <span className="mt-px shrink-0">
        <Icon name={level === 'ok' ? 'check' : 'alert'} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div>{children}</div>
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

/** Carte à numéro (sections du formulaire). */
export function StepCard({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-[15px] font-semibold">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white"
          style={{ background: 'var(--grad)' }}
        >
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}
