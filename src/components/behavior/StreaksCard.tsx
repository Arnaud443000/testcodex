import { useT } from '../../i18n'
import { formatSignedMoney } from '../../lib/format'
import type { Streak, StreakReport } from '../../types/behavior'
import { Card, Note, toneOfDecimal } from './parts'

function StreakRow({ label, streak, currency, emptyText }: { label: string; streak: Streak | null; currency: string; emptyText: string }) {
  const t = useT().behavior.streaks
  return (
    <div className="hairline-row items-start">
      <span className="text-tx2">{label}</span>
      {streak === null ? (
        <span className="text-right text-tx3">{emptyText}</span>
      ) : (
        <span className="text-right">
          <b className={streak.outcome === 'win' ? 'text-gain' : 'text-loss'}>
            {streak.outcome === 'win' ? t.wins(streak.length) : t.losses(streak.length)}
          </b>
          <span className={`block text-xs tabular-nums ${toneOfDecimal(streak.netPnl)}`}>{formatSignedMoney(streak.netPnl, currency)}</span>
        </span>
      )}
    </div>
  )
}

export function StreaksCard({ report, currency }: { report: StreakReport; currency: string }) {
  const t = useT().behavior.streaks
  return (
    <Card title={t.title} span="xl:col-span-3">
      <StreakRow label={t.current} streak={report.current} currency={currency} emptyText={t.noCurrent} />
      <StreakRow label={t.longestWin} streak={report.longestWin} currency={currency} emptyText={t.none} />
      <StreakRow label={t.longestLoss} streak={report.longestLoss} currency={currency} emptyText={t.none} />
      <Note>{t.note}</Note>
    </Card>
  )
}
