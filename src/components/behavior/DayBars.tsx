import { useT } from '../../i18n'
import { formatDayShort, formatScore } from '../../lib/behaviorFormat'
import type { DayDiscipline } from '../../types/behavior'

/**
 * Score de discipline par jour, en barres (une par jour ayant des trades clôturés). La hauteur est le score /100 :
 * aucun calcul, seulement du dessin. Chaque barre est un bouton (clavier compris) ; un jour sans score s'affiche « — ».
 */
export function DayBars({
  days,
  threshold,
  selected,
  onSelect,
}: {
  days: DayDiscipline[]
  threshold: number
  selected: string | null
  onSelect: (day: string | null) => void
}) {
  const t = useT().disciplinePage
  const axisEvery = Math.max(1, Math.ceil(days.length / 8))
  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative" style={{ minWidth: Math.max(days.length * 16, 320) }}>
        <div className="relative flex h-[180px] items-end gap-1 border-b" style={{ borderColor: 'var(--hairline)' }}>
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed"
            style={{ bottom: `${threshold}%`, borderColor: 'rgba(167,157,242,.55)' }}
            aria-hidden="true"
          >
            <span className="absolute -top-4 right-0 text-[11px] text-tx3">{t.threshold(threshold)}</span>
          </div>
          {days.map((d) => {
            const active = d.day === selected
            const phrase = d.score === null ? t.dayNoScore : t.dayScoreOf(formatScore(d.score))
            return (
              <button
                key={d.day}
                type="button"
                aria-pressed={active}
                aria-label={t.dayBarLabel(d.day, phrase, d.tradeCount)}
                title={t.dayBarLabel(formatDayShort(d.day), phrase, d.tradeCount)}
                onClick={() => onSelect(active ? null : d.day)}
                className="group flex h-full min-w-[8px] flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                <span
                  className="block w-full rounded-t-[4px] transition group-hover:opacity-100"
                  style={{
                    height: d.score === null ? '3px' : `${Math.max(d.score, 1)}%`,
                    background: d.score === null ? 'rgba(255,255,255,.18)' : 'var(--grad)',
                    opacity: active ? 1 : 0.72,
                    boxShadow: active ? '0 0 0 2px rgba(245,242,236,.85)' : undefined,
                  }}
                />
              </button>
            )
          })}
        </div>
        <div className="mt-1.5 flex gap-1 text-[11px] tabular-nums text-tx3" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.day} className="min-w-[8px] flex-1 overflow-visible whitespace-nowrap text-center">
              {i % axisEvery === 0 ? formatDayShort(d.day) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
