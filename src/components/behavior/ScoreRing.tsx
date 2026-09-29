import { useT } from '../../i18n'
import { formatMoney, formatSignedMoney } from '../../lib/format'
import { formatScore } from '../../lib/behaviorFormat'
import type { Quadrants } from '../../types/behavior'
import { Note, toneOfDecimal } from './parts'

const R = 90
const CIRC = 2 * Math.PI * R

/** Anneau de score (charte 6) : trait arrondi en dégradé bleu → violet, valeur au centre, « / 100 ». */
export function Ring({ score, size = 220, label }: { score: number | null; size?: number; label?: string }) {
  const t = useT().behavior.discipline
  const shown = formatScore(score)
  const fraction = score === null ? 0 : Math.min(Math.max(score, 0), 100) / 100
  const big = size >= 180
  return (
    <div className="relative mx-auto" style={{ height: size, width: size }} role="img" aria-label={label ?? (score === null ? t.ringEmptyLabel : t.ringLabel(shown))}>
      <svg viewBox="0 0 220 220" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-grad-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4A5FD9" />
            <stop offset="1" stopColor="#8B7FE8" />
          </linearGradient>
        </defs>
        <circle cx="110" cy="110" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="17" />
        {fraction > 0 && (
          <circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke={`url(#ring-grad-${size})`}
            strokeWidth="17"
            strokeLinecap="round"
            strokeDasharray={`${fraction * CIRC} ${CIRC}`}
            transform="rotate(-90 110 110)"
            style={{ filter: 'drop-shadow(0 0 8px rgba(139,127,232,.6))' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <div className={`${big ? 'text-[52px]' : 'text-[34px]'} font-semibold leading-none tabular-nums`}>{shown}</div>
        <div className={`mt-1 ${big ? 'text-[13px]' : 'text-xs'} text-tx3`}>{t.outOf}</div>
      </div>
    </div>
  )
}

/** Les quatre cases gagnant / perdant × bien / mal exécuté (3.2.9), avec le nombre et le P&L net de chacune. */
export function QuadrantsGrid({ quadrants: q, currency }: { quadrants: Quadrants; currency: string }) {
  const t = useT().behavior.discipline
  const cells = [
    { label: t.wellWins, q: q.wellExecutedWins },
    { label: t.poorWins, q: q.poorlyExecutedWins },
    { label: t.wellLosses, q: q.wellExecutedLosses },
    { label: t.poorLosses, q: q.poorlyExecutedLosses },
  ]
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cells.map(({ label, q: quad }) => (
          <div key={label} className="rounded-sm border px-3 py-2 text-xs" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
            <div className="text-tx2">{label}</div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2 tabular-nums">
              <b className="text-sm">{quad.count}</b>
              <span className={toneOfDecimal(quad.netPnl)}>{quad.count === 0 ? formatMoney(quad.netPnl, currency) : formatSignedMoney(quad.netPnl, currency)}</span>
            </div>
          </div>
        ))}
      </div>
      <Note>{t.threshold(q.threshold)}</Note>
    </div>
  )
}
