import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { formatDateTime, formatDuration, formatNumber, formatR, formatRatioPercent, formatSignedMoney } from '../../lib/format'
import { usePause } from '../../lib/pause'
import { localTzOffsetMin, periodRange, usePeriod } from '../../lib/period'
import type { PauseReport, PauseRow } from '../../types/pause'
import type { PeriodKey } from '../../types/stats'
import { Tooltip } from '../ui/Tooltip'
import { PauseStartPanel } from '../pause/PauseStartPanel'
import { Card, EmptyLine, Note, toneOfDecimal } from './parts'

/** Rapport de la période + dernières pauses ; se recharge quand une pause démarre ou se termine. */
export function usePauseData(accountIds: number[], period: PeriodKey, listLimit = 0) {
  const { changes } = usePause()
  const [data, setData] = useState<{ report: PauseReport; rows: PauseRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = accountIds.join(',')
  useEffect(() => {
    let cancelled = false
    const query = { accountIds, ...periodRange(period, Date.now(), localTzOffsetMin()) }
    Promise.all([api.getPauseReport(query), listLimit > 0 ? api.listPauses(accountIds, listLimit) : Promise.resolve([] as PauseRow[])])
      .then(([report, rows]) => {
        if (cancelled) return
        setData({ report, rows })
        setError(null)
      })
      .catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, period, listLimit, changes])
  return { data, error }
}

/**
 * Encadré « Pauses » de la page Comportement : combien de trades ont été pris pendant une pause (heure d'ENTRÉE dans la
 * pause), et une comparaison prudente avec les autres, chiffrée seulement avec 5 trades par groupe. Tout vient de
 * pulse-core ; on formule « en même temps », jamais une cause, jamais un ordre.
 */
export function PausesCard({ accountIds, currency }: { accountIds: number[]; currency: string }) {
  const p = useT().pause.card
  const { period } = usePeriod()
  const { data, error } = usePauseData(accountIds, period, 8)
  if (error) return <Card title={p.title} span="xl:col-span-6"><div className="nt nt-bad" role="alert">{p.loadError(error)}</div></Card>
  if (!data) return <Card title={p.title} span="xl:col-span-6"><EmptyLine>…</EmptyLine></Card>
  const { report, rows } = data
  return (
    <Card title={p.title} span="xl:col-span-6" aside={<span className="text-xs text-tx3">{p.pauseCount(report.pauseCount)}</span>}>
      <p className="mb-3 text-[13px] text-tx2">{p.subtitle}</p>
      {rows.length === 0 && report.pauseCount === 0 ? (
        <>
          <EmptyLine>{p.empty}</EmptyLine>
          <PauseStartPanel label={p.startButton} />
        </>
      ) : (
        <>
          <p className="text-sm">
            <b className="tabular-nums">{p.duringCount(report.during.summary.tradeCount, report.tradeCount)}</b>
            {report.shareDuring !== null && report.during.summary.tradeCount > 0 && <span className="text-tx2"> · {p.share(formatRatioPercent(report.shareDuring, 0))}</span>}
          </p>
          {report.during.summary.tradeCount === 0 && <p className="mt-1 text-[13px] text-tx2">{p.none}</p>}
          {report.during.summary.tradeCount > 0 && <Comparison report={report} currency={currency} />}
          <Note>{p.afterTheFact}</Note>
          <h4 className="mb-1 mt-4 text-sm font-semibold">{p.listTitle}</h4>
          {rows.length === 0 ? <EmptyLine>{p.listEmpty}</EmptyLine> : <PauseList rows={rows} />}
        </>
      )}
    </Card>
  )
}

function Comparison({ report, currency }: { report: PauseReport; currency: string }) {
  const p = useT().pause.card
  if (report.sampleTooSmall) {
    return <p className="mt-2 text-[13px] text-tx2">{p.notEnough(report.minTradeCount, report.during.summary.tradeCount, report.others.summary.tradeCount)}</p>
  }
  const d = report.during.summary
  const o = report.others.summary
  return (
    <div className="mt-3">
      <div className="caption mb-1">{p.compareTitle}</div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 text-sm">
        <span />
        <span className="caption text-right">{p.during}</span>
        <span className="caption text-right">{p.others}</span>
        <span className="hairline-row col-span-3 !grid grid-cols-subgrid">
          <span className="text-tx2">{p.avgPnl}</span>
          <b className={`text-right tabular-nums ${toneOfDecimal(d.avgNetPnl)}`}>{d.avgNetPnl === null ? '—' : formatSignedMoney(d.avgNetPnl, currency)}</b>
          <b className={`text-right tabular-nums ${toneOfDecimal(o.avgNetPnl)}`}>{o.avgNetPnl === null ? '—' : formatSignedMoney(o.avgNetPnl, currency)}</b>
        </span>
        <span className="hairline-row col-span-3 !grid grid-cols-subgrid">
          <span className="text-tx2">{p.expectancy}</span>
          <b className="text-right tabular-nums">{formatR(report.expectancyR.present)}</b>
          <b className="text-right tabular-nums">{formatR(report.expectancyR.absent)}</b>
        </span>
        <span className="hairline-row col-span-3 !grid grid-cols-subgrid">
          <span className="text-tx2">{p.discipline}</span>
          <b className="text-right tabular-nums">{formatNumber(report.discipline.present, 0)}</b>
          <b className="text-right tabular-nums">{formatNumber(report.discipline.absent, 0)}</b>
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-[13px] text-tx2">
        {([
          [p.expectancy, report.expectancyR.verdict],
          [p.discipline, report.discipline.verdict],
        ] as const).map(([what, verdict]) => (
          <li key={what}>{verdict === 'notEnoughData' ? `${what} : ${p.verdict.notEnoughData}.` : p.verdictLine(what, p.verdict[verdict])}</li>
        ))}
      </ul>
    </div>
  )
}

function PauseList({ rows }: { rows: PauseRow[] }) {
  const p = useT().pause.card
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="caption">
            <th className="py-1.5 pr-3 font-medium">{p.columns.date}</th>
            <th className="py-1.5 pr-3 font-medium">{p.columns.planned}</th>
            <th className="py-1.5 pr-3 font-medium">{p.columns.actual}</th>
            <th className="py-1.5 pr-3 font-medium">{p.columns.reason}</th>
            <th className="py-1.5 text-right font-medium">{p.columns.trades}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pause.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
              <td className="py-1.5 pr-3 tabular-nums">{formatDateTime(r.pause.startedAt)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{formatDuration(r.plannedMs)}</td>
              <td className="py-1.5 pr-3 tabular-nums">
                {formatDuration(r.actualMs)} <span className="text-xs text-tx3">({p.status[r.status]})</span>
              </td>
              <td className="py-1.5 pr-3">{r.pause.reason ? <ReasonText reason={r.pause.reason} note={r.pause.note} /> : r.pause.note ? <Tooltip content={r.pause.note}><span className="block max-w-[28ch] truncate">{r.pause.note}</span></Tooltip> : p.noReason}</td>
              <td className="py-1.5 text-right tabular-nums">{r.tradeCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReasonText({ reason, note }: { reason: string; note: string | null }) {
  const t = useT().pause.picker
  return (
    <span>
      {t.reasons[reason] ?? reason}
      {note && <span className="block max-w-[28ch] truncate text-xs text-tx3">{note}</span>}
    </span>
  )
}

/** Petit repère de la page Discipline : les trades pris pendant une pause sur la période, avec un lien vers Comportement. */
export function PauseHint({ accountIds }: { accountIds: number[] }) {
  const h = useT().pause.hint
  const { period } = usePeriod()
  const { data } = usePauseData(accountIds, period)
  const n = data?.report.during.summary.tradeCount ?? 0
  if (n === 0) return null
  return (
    <p className="col-span-12 text-[13px] text-tx2" data-testid="pause-hint">
      {h.some(n)} <Link to="/behavior" className="btn-link">{h.link}</Link>
    </p>
  )
}
