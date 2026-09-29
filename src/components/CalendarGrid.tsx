import { useT } from '../i18n'
import { formatDayLong, heatTier } from '../lib/calendarFormat'
import { signOf } from '../lib/decimal'
import { formatSignedAmount, formatSignedMoney } from '../lib/format'
import type { Calendar, CalendarDay } from '../types/stats'

/** Heatmap mensuelle (charte 4.3) : lundi en premier, teinte gain/perte à 3 paliers, montant toujours écrit. */
export function CalendarGrid({
  calendar,
  selectedDay,
  onSelect,
  compact = false,
}: {
  calendar: Calendar
  selectedDay?: string | null
  onSelect?: (day: string) => void
  compact?: boolean
}) {
  const t = useT()
  const byDay = new Map<number, CalendarDay>(calendar.days.map((d) => [d.dayOfMonth, d]))
  const lead = calendar.firstWeekday - 1
  const height = compact ? 'h-[46px]' : 'h-[78px]'
  const cells = Array.from({ length: calendar.daysInMonth }, (_, i) => i + 1)
  const currency = calendar.currency ?? 'USD'
  return (
    <div className="grid grid-cols-7 gap-2" role="grid">
      {t.calendar.weekdaysShort.map((d, i) => (
        <div key={i} className="pb-1 text-center text-[11px] font-semibold text-tx3" role="columnheader">{d}</div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`lead-${i}`} className={height} aria-hidden="true" />
      ))}
      {cells.map((n) => {
        const r = byDay.get(n)
        const date = `${String(calendar.year).padStart(4, '0')}-${String(calendar.month).padStart(2, '0')}-${String(n).padStart(2, '0')}`
        if (!r) {
          return (
            <div key={n} className={`cal-cell ${height} opacity-50`} role="gridcell" aria-label={t.calendar.dayEmptyLabel(formatDayLong(date))}>
              {n}
            </div>
          )
        }
        const s = signOf(r.netPnl)
        const tier = heatTier(r.intensity)
        const tone = s > 0 ? `cal-g${tier}` : s < 0 ? `cal-l${tier}` : ''
        const label = t.calendar.dayLabel(formatDayLong(date), formatSignedMoney(r.netPnl, currency), r.tradeCount)
        const cls = `cal-cell ${height} ${tone} ${selectedDay === date ? 'cal-cell-selected' : ''}`
        const inner = (
          <>
            <span className={s === 0 ? '' : 'text-tx/80'}>{n}</span>
            <b>{formatSignedAmount(r.netPnl)}</b>
          </>
        )
        return onSelect ? (
          <button key={n} type="button" className={`${cls} block w-full`} role="gridcell" aria-label={label} aria-pressed={selectedDay === date} onClick={() => onSelect(date)}>
            {inner}
          </button>
        ) : (
          <div key={n} className={cls} role="gridcell" aria-label={label}>{inner}</div>
        )
      })}
    </div>
  )
}
