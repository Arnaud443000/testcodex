import { useState } from 'react'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { formatRatioPercent, formatSignedMoney } from '../../lib/format'
import type { EmotionReport } from '../../types/behavior'
import type { Segment } from '../../types/stats'
import { Card, EmptyLine, Segmented, toneOfDecimal } from './parts'

export type Moment = 'before' | 'during' | 'after' | 'any'
const MOMENTS: Moment[] = ['before', 'during', 'after', 'any']

/** Barres divergentes autour d'un axe central (charte 6) : gain à droite, perte à gauche, valeur et réussite à droite. */
export function EmotionsCard({ report, currency, initialMoment = 'before' }: { report: EmotionReport; currency: string; initialMoment?: Moment }) {
  const t = useT().behavior.emotions
  const [moment, setMoment] = useState<Moment>(initialMoment)
  const rows: Segment[] = report[moment]
  // Échelle du dessin : le plus gros écart en valeur absolue occupe la demi-piste.
  const max = Math.max(...rows.map((s) => Math.abs(Number(s.summary.netPnl))), 0) || 1
  return (
    <Card
      title={t.title}
      span="xl:col-span-5"
      aside={
        <Segmented
          label={t.momentAria}
          value={moment}
          onChange={setMoment}
          options={MOMENTS.map((m) => ({ key: m, label: t.momentTabs[m] }))}
        />
      }
    >
      <p className="mb-3 text-[12.5px] text-tx3">{t.subtitle(t.moments[moment])}</p>
      {rows.length === 0 ? (
        <EmptyLine>{t.empty}</EmptyLine>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((s) => {
            const net = Number(s.summary.netPnl)
            const width = `${(Math.abs(net) / max) * 50}%`
            const name = s.key === 'none' ? t.none : s.label
            const money = formatSignedMoney(s.summary.netPnl, currency)
            return (
              <li
                key={s.key}
                className="grid grid-cols-[130px_1fr_auto] items-center gap-3 text-[13.5px]"
                aria-label={t.barLabel(name, money, s.summary.tradeCount)}
              >
                <Tooltip content={name}>
                  <span className="truncate text-tx2">{name}</span>
                </Tooltip>
                <div className="relative h-2.5 rounded-full bg-white/[.06]" aria-hidden="true">
                  {net !== 0 && (
                    <i
                      className={`absolute top-0 h-full rounded-full ${net > 0 ? 'bg-gain' : 'bg-loss'}`}
                      style={net > 0 ? { left: '50%', width } : { right: '50%', width }}
                    />
                  )}
                  <i className="absolute left-1/2 top-[-3px] h-[16px] w-px bg-white/25" />
                </div>
                <span className="whitespace-nowrap text-right tabular-nums">
                  <b className={toneOfDecimal(s.summary.netPnl)}>{money}</b>
                  <span className="text-tx3"> · {t.winRateShort(formatRatioPercent(s.summary.winRate, 0))}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
