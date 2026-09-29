import { createContext, useContext, type ReactNode } from 'react'
import { signOf } from '../../lib/decimal'
import type { Decimal } from '../../types/money'

/** Briques communes de la page Comportement. */

/** Classe de ton d'un montant ou d'un R : la couleur renforce toujours un signe écrit, elle ne le remplace pas. */
export function toneOfDecimal(value: Decimal | null): string {
  if (value === null) return 'text-tx2'
  const s = signOf(value)
  return s > 0 ? 'text-gain' : s < 0 ? 'text-loss' : 'text-neutral'
}

export function toneOfNumber(value: number | null): string {
  if (value === null) return 'text-tx2'
  return value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-neutral'
}

/** Vrai quand la carte est posée dans un widget du dashboard : elle remplit sa cellule au lieu de prendre des colonnes. */
export const EmbeddedCardContext = createContext(false)

export function Card({ title, span, children, aside }: { title: string; span: string; children: ReactNode; aside?: ReactNode }) {
  const embedded = useContext(EmbeddedCardContext)
  return (
    <section className={embedded ? 'glass-card flex h-full flex-col overflow-auto p-6' : `glass-card col-span-12 flex flex-col p-6 ${span}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="whitespace-nowrap text-base font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Petite ligne libellé / valeur séparée par un filet (charte 5.3). */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="hairline-row">
      <span className="text-tx2">
        {label}
        {hint && <span className="ml-2 text-xs text-tx3">{hint}</span>}
      </span>
      <b className="tabular-nums">{children}</b>
    </div>
  )
}

/** Bloc de comparaison (charte 5.3) : libellé en majuscules, grande valeur, précisions. */
export function CompareBlock({ label, value, tone, lines }: { label: string; value: string; tone: string; lines: string[] }) {
  return (
    <div className="rounded-inner border p-4" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
      <div className="caption">{label}</div>
      <div className={`mt-1.5 text-[26px] font-semibold leading-tight tabular-nums ${tone}`}>{value}</div>
      {lines.map((l) => (
        <div key={l} className="mt-0.5 text-[13px] text-tx2 tabular-nums">{l}</div>
      ))}
    </div>
  )
}

/** Contrôle segmenté (charte 5.5) : segment actif en dégradé de marque. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="control flex gap-0.5 !rounded-full p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${value === o.key ? 'text-white' : 'text-tx2 hover:text-tx'}`}
          style={value === o.key ? { background: 'var(--grad)' } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Texte discret sous un graphique ou une liste. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-tx3">{children}</p>
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm leading-relaxed text-tx2">{children}</p>
}
