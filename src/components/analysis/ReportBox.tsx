import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { comparisonLines, formatRate } from '../../lib/analysisView'
import { useAccounts } from '../../lib/accounts'
import { localTzOffsetMin, periodRange, usePeriod } from '../../lib/period'
import type { AnalysisReport } from '../../types/analysis'
import { Notice } from '../ui'

/**
 * « Est-ce que j'analyse bien ? » : un constat prudent (jamais « parce que »), calculé par pulse-core sur la période et le
 * compte de la barre du haut. Sous 5 idées clôturées, ou 5 trades par côté, il le dit au lieu de donner un chiffre.
 */
export function ReportBox() {
  const t = useT()
  const r = t.analysis.report
  const { selectedId } = useAccounts()
  const { period } = usePeriod()
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const query = { accountIds: selectedId === null ? [] : [selectedId], ...periodRange(period, Date.now(), localTzOffsetMin()) }
    api
      .getAnalysisReport(query)
      .then((x) => live && (setReport(x), setError(null)))
      .catch((e) => live && setError(r.loadError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [selectedId, period, r])

  if (error) return <Notice level="bad">{error}</Notice>
  if (!report) return null
  const i = report.ideas
  const c = report.comparison
  const lines = comparisonLines(c)
  const enough = c.linked.tradeCount >= c.minTradeCount && c.unlinked.tradeCount >= c.minTradeCount
  const decided = i.worked + i.invalidated
  return (
    <section aria-labelledby="report-title" className="glass-card flex flex-col gap-4 p-5">
      <div>
        <h2 id="report-title" className="text-base font-semibold">{r.title}</h2>
        <p className="mt-0.5 max-w-[80ch] text-[13px] text-tx3">{r.intro}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{r.ideasTitle}</h3>
          {i.closedCount === 0 ? (
            <p className="text-sm text-tx2">{r.noClosed}</p>
          ) : (
            <>
              <p className="text-sm text-tx2">{r.outcomes(i.worked, i.invalidated, i.noFollowUp)}</p>
              <p className="text-sm">
                {r.rate}{' '}:{' '}
                <strong className="tabular-nums">
                  {i.successRate !== null ? r.rateValue(formatRate(i.successRate), decided) : decided === 0 && i.closedCount >= 5 ? r.rateNoDecided : r.rateWait(i.closedCount, 5)}
                </strong>
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">{r.tradesTitle}</h3>
          <p className="text-sm text-tx2">{r.sides(c.linked.tradeCount, c.unlinked.tradeCount)}</p>
          {!enough ? (
            <p className="text-sm text-tx2">{r.wait(c.minTradeCount)}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {lines.map((l) => {
                const metric = l.metric === 'discipline' ? r.discipline : r.expectancy
                const text =
                  l.verdict === 'notEnoughData'
                    ? r.verdict.notEnoughData(metric)
                    : l.verdict === 'similar'
                      ? r.verdict.similar(metric)
                      : r.verdict[l.verdict](metric, l.gap ?? '—')
                return (
                  <li key={l.metric}>
                    {text}
                    {l.values && <span className="ml-1 tabular-nums text-tx3">({r.versus(l.values[0], l.values[1])})</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      <p className="text-[12.5px] text-tx3">{r.caution}</p>
    </section>
  )
}
