import { useT } from '../../i18n'
import { importanceBars } from '../../lib/newsView'
import type { Importance } from '../../types/news'

/** Importance d'une news : le mot (« Forte ») et trois barres, jamais la couleur seule. */
export function ImportanceMark({ importance }: { importance: Importance }) {
  const t = useT().news
  const filled = importanceBars(importance)
  const label = t.importance[importance]
  const tone = importance === 'high' ? 'text-[#F0CE8E]' : importance === 'medium' ? 'text-tx' : 'text-tx2'
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-[12.5px] font-semibold ${tone}`} title={t.importanceLabel(label)}>
      <span aria-hidden="true" className="flex items-end gap-[2px]">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-[4px] rounded-[1px] ${i > filled ? 'bg-white/15' : importance === 'high' ? 'bg-warn' : 'bg-violet'}`}
            style={{ height: 4 + i * 3 }}
          />
        ))}
      </span>
      <span>{label}</span>
    </span>
  )
}

/** Code devise en pastille ; « Toutes » quand la source n'en donne pas. */
export function CurrencyTag({ currency }: { currency: string }) {
  const t = useT().news
  return (
    <span className="badge badge-neutral !px-2 tabular-nums" title={currency ? undefined : t.noCurrencyHint}>
      {currency || t.noCurrency}
    </span>
  )
}

export function SimulationBadge() {
  const t = useT().news
  return (
    <span className="badge badge-warn" title={t.simulationHint}>
      {t.simulation}
    </span>
  )
}
