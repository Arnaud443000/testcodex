import { Link } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { formatRatioPercent } from '../../lib/format'
import type { DisciplineReport } from '../../types/behavior'
import { Card, Note } from './parts'
import { Ring } from './ScoreRing'

/** Résumé du score sur la page Comportement : le détail (jours, cases, poids) vit sur la page Discipline. */
export function DisciplineCard({ report }: { report: DisciplineReport }) {
  const t = useT().behavior.discipline
  return (
    <Card title={t.title} span="xl:col-span-4">
      <Ring score={report.score} />
      {report.sampleTooSmall ? (
        <div className="nt nt-warn mt-3" role="status">
          <b aria-hidden="true">i</b>
          <span>
            <b>{t.tooSmallTitle}.</b> {t.tooSmall(report.scoredTradeCount, report.minTradeCount)}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-center text-xs text-tx3">{t.basedOn(report.scoredTradeCount)}</p>
      )}

      <div className="mt-4">
        {report.components.map((c) => (
          <div key={c.key} className="hairline-row">
            <span className="text-tx2">{t.components[c.key]}</span>
            {c.average === null ? (
              <Tooltip content={t.componentEmpty}>
                <span className="text-tx3">—</span>
              </Tooltip>
            ) : (
              <b className="tabular-nums">{formatRatioPercent(c.average, 0)}</b>
            )}
          </div>
        ))}
      </div>
      {report.settings.maxRiskPercent === null && <Note>{t.riskNoLimit}</Note>}
      <Link to="/discipline" className="btn btn-secondary mt-4 self-start">{t.seeDetail}</Link>
    </Card>
  )
}
