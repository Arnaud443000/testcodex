import { Icon } from '../Icon'
import { Pnl } from '../ui'
import { roundDecimal } from '../../lib/decimal'
import type { Decimal } from '../../types/money'
import { useT } from '../../i18n'
import type { SortDir } from '../../lib/analysesView'

/** Petites briques communes aux quatre analyses. */

/** En-tête de colonne triable (même rendu que la liste des trades). */
export function SortTh<K extends string>({
  sortKey,
  label,
  active,
  dir,
  onSort,
  align,
  hint,
}: {
  sortKey: K
  label: string
  active: K
  dir: SortDir
  onSort: (key: K) => void
  align?: 'right'
  hint?: string
}) {
  const t = useT().analyses.assets
  const on = active === sortKey
  return (
    <th scope="col" aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={`caption px-3 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        title={hint ?? t.sortBy(label)}
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet ${on ? 'text-tx' : ''}`}
      >
        {label}
        {on && <Icon name={dir === 'asc' ? 'sortUp' : 'sortDown'} size={14} />}
      </button>
    </th>
  )
}

/** En-tête de colonne sans tri. */
export function Th({ label, align }: { label: string; align?: 'right' }) {
  return (
    <th scope="col" className={`caption px-3 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}
    </th>
  )
}

/** Avertissement d'échantillon faible : un texte, jamais la seule couleur. */
export function LowSampleBadge() {
  const t = useT().analyses
  return (
    <span className="badge badge-warn whitespace-nowrap" title={t.lowSampleHint}>
      {t.lowSample}
    </span>
  )
}

/** Titre de section d'une analyse (carte en verre). */
export function Section({ title, subtitle, aside, children }: { title: string; subtitle?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="glass-card flex flex-col p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-relaxed text-tx3">{subtitle}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** P&L agrégé : arrondi au centime pour la lisibilité (affichage seulement), signe + / − toujours écrit. */
export function PnlRounded({ value, currency }: { value: Decimal; currency: string }) {
  return <Pnl value={roundDecimal(value, 2)} currency={currency} />
}
