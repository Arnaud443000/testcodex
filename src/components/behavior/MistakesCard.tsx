import { useState } from 'react'
import { Tooltip } from '../ui/Tooltip'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { signOf } from '../../lib/decimal'
import { formatRatioPercent } from '../../lib/format'
import { formatLoss } from '../../lib/behaviorFormat'
import { mistakeLink } from '../../lib/mistakeFilter'
import type { MistakeReport } from '../../types/behavior'
import { FitList } from '../ui/fit'
import { Card, EmptyLine, Note, Segmented } from './parts'

type Sort = 'count' | 'cost'

export function MistakesCard({ report, currency }: { report: MistakeReport; currency: string }) {
  const t = useT().behavior.mistakes
  const [sort, setSort] = useState<Sort>('cost')
  const rows = (sort === 'count' ? report.byCount : report.byCost).slice(0, 8)
  return (
    <Card
      title={t.title}
      span="xl:col-span-4"
      aside={
        <Segmented
          label={t.sortAria}
          value={sort}
          onChange={setSort}
          options={[
            { key: 'cost', label: t.byCost },
            { key: 'count', label: t.byCount },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyLine>{t.empty}</EmptyLine>
      ) : (
        <>
          <FitList moreTo="/behavior">
            {rows.map((m) => (
              <li key={`${m.source}-${m.id}`} className="flex items-center gap-3 border-b py-3 last:border-b-0" style={{ borderColor: 'var(--hairline)' }}>
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-sm font-semibold tabular-nums text-[#F5A198]"
                  style={{ background: 'rgba(240,119,107,.14)' }}
                  aria-label={t.detail(m.tradeCount, formatRatioPercent(m.share, 0))}
                >
                  {m.tradeCount}
                </span>
                <span className="min-w-0 flex-1">
                  <Tooltip content={m.source === 'rule' ? t.ruleBroken(m.label) : m.label}>
                    <span className="block break-words text-sm font-medium leading-snug">
                      {m.source === 'rule' ? t.ruleBroken(m.label) : m.label}
                    </span>
                  </Tooltip>
                  <span className="block text-xs text-tx3 tabular-nums">
                    {t.detail(m.tradeCount, formatRatioPercent(m.share, 0))}
                    {' · '}
                    <Link
                      to={mistakeLink({ source: m.source === 'rule' ? 'rule' : 'tag', id: m.id })}
                      className="btn-link"
                      aria-label={t.seeTradesAria(m.source === 'rule' ? t.ruleBroken(m.label) : m.label)}
                    >
                      {t.seeTrades}
                    </Link>
                  </span>
                </span>
                <b className={`whitespace-nowrap tabular-nums ${signOf(m.cost) > 0 ? 'text-loss' : 'text-neutral'}`}>{formatLoss(m.cost, currency)}</b>
              </li>
            ))}
          </FitList>
          <Note>{t.summary(report.tradesWithMistake, report.tradeCount)}</Note>
        </>
      )}
    </Card>
  )
}
