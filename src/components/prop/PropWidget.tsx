import { Link } from 'react-router-dom'
import { Icon } from '../Icon'
import { FitCard, FitList } from '../ui/fit'
import { useT } from '../../i18n'
import { formatMoney } from '../../lib/format'
import { formatCountdown, formatUsedPercent, remainingText } from '../../lib/propView'
import type { PropStatus } from '../../types/prop'
import { PropGauge } from './PropGauge'

/**
 * Carte du widget « Prop firm » (lot 33) : deux ou trois jauges compactes, la règle d'or en une ligne (toujours
 * visible, jamais masquée par le resserrement) et la remise à zéro. Sans barre de défilement : `FitCard` se
 * resserre puis `FitList` raccourcit la liste avec un lien vers la page.
 */
export function PropWidgetCard({ title, accountName, status }: { title: string; accountName: string; status: PropStatus }) {
  const t = useT()
  const p = t.prop
  const s = status
  const rows = [
    s.dailyLoss && (
      <li key="daily">
        <PropGauge compact label={p.cards.dailyLoss.title} used={s.dailyLoss.used} level={s.dailyLoss.level} detail={remainingText(t, s.dailyLoss.remaining, s.currency)} />
      </li>
    ),
    s.maxLoss && (
      <li key="max">
        <PropGauge compact label={p.cards.maxLoss.title} used={s.maxLoss.used} level={s.maxLoss.level} detail={remainingText(t, s.maxLoss.remaining, s.currency)} />
      </li>
    ),
    s.profitTarget && (
      <li key="target" className="flex flex-col gap-0.5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-tx">
          <Icon name={s.profitTarget.reached ? 'check' : 'goals'} size={14} />
          {p.cards.profitTarget.title}
        </span>
        <span className="tabular-nums text-tx2">
          {p.cards.profitTarget.progress(formatUsedPercent(s.profitTarget.progress))}
          {s.profitTarget.remaining !== null && !s.profitTarget.reached && <> · {p.cards.profitTarget.left(formatMoney(s.profitTarget.remaining, s.currency))}</>}
        </span>
      </li>
    ),
  ].filter(Boolean)
  return (
    <FitCard testId="prop-widget">
      <h3 className="mb-1 flex items-baseline gap-2 whitespace-nowrap text-base font-semibold">
        {title}
        <span className="truncate text-xs font-normal text-tx3">{accountName}</span>
      </h3>
      <p className="mb-3 inline-flex items-start gap-1.5 text-xs text-warn">
        <span className="mt-px shrink-0">
          <Icon name="alert" size={13} />
        </span>
        {p.golden.short}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-tx2">{p.notSet}</p>
      ) : (
        <FitList moreTo="/prop" className="flex flex-col gap-3">
          {rows}
        </FitList>
      )}
      <p className="fit-optional mt-3 text-xs text-tx3">{p.day.resetShort(formatCountdown(s.nextReset.inMs), s.nextReset.parisTime)}</p>
      <Link to="/prop" className="btn-link fit-optional self-start text-xs">{p.widget.open}</Link>
    </FitCard>
  )
}
