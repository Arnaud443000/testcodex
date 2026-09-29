import { useState } from 'react'
import { useT } from '../../i18n'
import { formatRatioPercent } from '../../lib/format'
import type { Hesitation, PatternReport } from '../../types/behavior'
import { Card, EmptyLine, Note, Segmented } from './parts'

type Kind = 'setup' | 'session'

/** Trades pris contre trades manqués, par setup et par session. Les largeurs des barres sont des parts de la plus grande ligne. */
export function HesitationCard({ report }: { report: PatternReport }) {
  const t = useT().behavior.hesitation
  const [kind, setKind] = useState<Kind>('setup')
  const rows: Hesitation[] = report.hesitation.filter((h) => h.kind === kind)
  const widest = Math.max(1, ...rows.map((h) => h.taken + h.missed))
  return (
    <Card
      title={t.title}
      span="xl:col-span-6"
      aside={
        <Segmented
          label={t.byAria}
          value={kind}
          onChange={setKind}
          options={[
            { key: 'setup', label: t.setup },
            { key: 'session', label: t.session },
          ]}
        />
      }
    >
      <p className="mb-3 text-[13px] text-tx2">{t.subtitle}</p>
      {report.missedTradeCount === 0 ? (
        <EmptyLine>{t.empty}</EmptyLine>
      ) : rows.length === 0 ? (
        <EmptyLine>{t.emptyGroup}</EmptyLine>
      ) : (
        <>
          <ul>
            {rows.map((h) => (
              <li key={h.tagId} className="border-b py-3 last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words font-medium">{h.name}</span>
                  <span className="shrink-0 tabular-nums text-tx2">
                    {t.taken(h.taken)} · {t.missed(h.missed)}
                    <b className="ml-2 text-tx">{h.missedShare === null ? '—' : t.missedShare(formatRatioPercent(h.missedShare, 0))}</b>
                  </span>
                </div>
                <div
                  className="mt-1.5 flex h-2 overflow-hidden rounded-full"
                  style={{ background: 'rgba(255,255,255,.06)', width: `${((h.taken + h.missed) / widest) * 100}%`, minWidth: 24 }}
                  role="img"
                  aria-label={t.barLabel(h.name, h.taken, h.missed)}
                >
                  <span style={{ flex: h.taken, background: 'var(--grad)' }} />
                  <span style={{ flex: h.missed, background: 'repeating-linear-gradient(45deg, rgba(217,168,90,.85) 0 4px, rgba(217,168,90,.45) 4px 8px)' }} />
                </div>
              </li>
            ))}
          </ul>
          <Note>{t.total(report.missedTradeCount)} {t.note}</Note>
        </>
      )}
    </Card>
  )
}
