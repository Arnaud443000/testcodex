import { Icon } from '../Icon'
import { useT } from '../../i18n'
import { formatUsedPercent, gaugeWidth, levelIcon, levelLabel, levelTone } from '../../lib/propView'
import type { PropLevel } from '../../types/prop'

const BAR: Record<ReturnType<typeof levelTone>, string> = { ok: 'bg-gain', warn: 'bg-warn', bad: 'bg-loss', neutral: 'bg-neutral' }
const TEXT: Record<ReturnType<typeof levelTone>, string> = { ok: 'text-gain', warn: 'text-warn', bad: 'text-loss', neutral: 'text-tx2' }

/**
 * Jauge d'une règle prop firm (lot 33) : barre + pourcentage + montant restant, et le statut en TEXTE et en
 * icône (jamais la couleur seule). La largeur est bornée à 100 % ; le texte dit la vraie valeur.
 */
export function PropGauge({
  label,
  used,
  level,
  detail,
  consistency = false,
  compact = false,
}: {
  label: string
  used: number | null
  level: PropLevel | null
  /** « Reste 1 500,00 $ », « Dépassée de 500,00 $ »… */
  detail: string
  consistency?: boolean
  compact?: boolean
}) {
  const t = useT()
  const tone = levelTone(level)
  const status = levelLabel(t, level, consistency)
  const pct = formatUsedPercent(used)
  const bar = (
    <div
      role="progressbar"
      aria-label={t.prop.gaugeAria(label, t.prop.used(pct), status)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(gaugeWidth(used))}
      className={`${compact ? 'h-1.5' : 'h-2'} overflow-hidden rounded-full bg-white/10`}
    >
      <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${gaugeWidth(used)}%` }} />
    </div>
  )
  if (compact) {
    // Widget : le nom de la règle d'abord, puis la barre, puis le statut (texte + icône) et le reste.
    return (
      <div className="flex min-w-0 flex-col gap-1" data-level={level ?? 'none'}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[13px] font-semibold text-tx">{label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-tx">{t.prop.used(pct)}</span>
        </div>
        {bar}
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-tx2">
          <span className={`inline-flex items-center gap-1 font-semibold ${TEXT[tone]}`}>
            <Icon name={levelIcon(level)} size={13} />
            {status}
          </span>
          <span className="tabular-nums">{detail}</span>
        </p>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2" data-level={level ?? 'none'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${TEXT[tone]}`}>
          <Icon name={levelIcon(level)} size={16} />
          {status}
        </span>
        <span className="text-lg font-semibold tabular-nums text-tx">{t.prop.used(pct)}</span>
      </div>
      {bar}
      <p className="text-[13px] tabular-nums text-tx2">{detail}</p>
    </div>
  )
}
