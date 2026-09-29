import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { roundDecimal } from '../lib/decimal'
import { formatNumber, formatR, formatRatioPercent, formatSignedMoneyRounded } from '../lib/format'
import { periodWindow } from '../lib/journalPeriod'
import { usePeriod } from '../lib/period'
import type { ConfidenceReport, Quadrant, QualityReport } from '../types/journal'
import { Pnl } from './ui'

/** Une case du tableau résultat × exécution : le sens est écrit, la couleur ne fait que renforcer. */
function Cell({ q, currency }: { q: Quadrant; currency: string }) {
  const t = useT()
  const s = t.journalPage.insights.quality
  const outcome = q.outcome === 'win' ? s.wins : s.losses
  const grade = q.grade === 'good' ? s.good : s.poor
  // Les cas « gagnant mal exécuté » et « perdant bien exécuté » sont ceux qui apprennent quelque chose : mis en avant.
  const surprising = (q.outcome === 'win') !== (q.grade === 'good')
  return (
    <div
      role="group"
      aria-label={s.cellLabel(outcome, grade, q.tradeCount, formatSignedMoneyRounded(q.netPnl, currency))}
      className="flex flex-col gap-1.5 rounded-inner border px-[18px] py-4"
      style={{ borderColor: surprising && q.tradeCount > 0 ? 'rgba(217,168,90,.5)' : 'var(--hairline)', background: 'rgba(255,255,255,.04)' }}
    >
      <p className="caption">{grade}</p>
      <p className="text-[26px] font-semibold leading-none tabular-nums">{q.tradeCount}</p>
      <p className="text-xs text-tx3">{s.trades(q.tradeCount)}</p>
      <p className="text-sm font-semibold tabular-nums">
        <Pnl value={q.netPnl} currency={currency} />
      </p>
    </div>
  )
}

export function InsightsPanel() {
  const t = useT()
  const i = t.journalPage.insights
  const { accounts, selectedId } = useAccounts()
  const { period } = usePeriod()
  const [quality, setQuality] = useState<QualityReport | null>(null)
  const [confidence, setConfidence] = useState<ConfidenceReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : accounts.filter((a) => a.id === selectedId)), [accounts, selectedId])
  const mixed = chosen.some((a) => a.currency !== chosen[0].currency)
  const query = useMemo(() => ({ accountIds: selectedId === null ? [] : [selectedId], ...periodWindow(period) }), [selectedId, period])

  useEffect(() => {
    if (mixed) return
    let live = true
    setError(null)
    Promise.all([api.getQualityReport(query), api.getConfidenceReport(query)])
      .then(([q, c]) => {
        if (!live) return
        setQuality(q)
        setConfidence(c)
      })
      .catch((e) => live && setError(i.loadError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [query, mixed, i])

  if (mixed) return <div className="nt nt-warn" role="status">{i.mixedCurrencies}</div>
  if (error) return <div className="nt nt-bad" role="alert">{error}</div>
  if (!quality || !confidence) return null

  const currency = quality.currency ?? chosen[0]?.currency ?? 'USD'
  const cells = (outcome: 'win' | 'loss') => quality.quadrants.filter((q) => q.outcome === outcome)
  const c = i.confidence

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-tx2">{i.periodNote(t.topbar.periods[period])}</p>

      <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="quality-title">
        <div>
          <h2 id="quality-title" className="text-[15px] font-semibold">{i.quality.title}</h2>
          <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{i.quality.intro}</p>
        </div>
        {quality.scoredCount === 0 ? (
          <EmptyState title={i.quality.emptyTitle}>{i.quality.emptyText}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-[120px_1fr_1fr] items-stretch gap-3">
              {(['win', 'loss'] as const).map((outcome) => (
                <div key={outcome} className="contents">
                  <p className="caption flex items-center">{outcome === 'win' ? i.quality.wins : i.quality.losses}</p>
                  {cells(outcome)
                    .sort((a) => (a.grade === 'good' ? -1 : 1))
                    .map((q) => (
                      <Cell key={`${q.outcome}-${q.grade}`} q={q} currency={currency} />
                    ))}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-sm text-tx2">
              {quality.averageStars !== null && quality.averageScore !== null && (
                <span>
                  {i.quality.average} : <strong className="text-tx">{i.quality.averageValue(formatNumber(quality.averageStars, 1), formatNumber(quality.averageScore, 0))}</strong>
                </span>
              )}
              <span>{i.quality.scored(quality.scoredCount, quality.tradeCount)}</span>
              {quality.breakevenCount > 0 && <span>{i.quality.breakeven(quality.breakevenCount)}</span>}
            </div>
            <p className="text-xs text-tx3">{i.quality.rule}</p>
          </>
        )}
      </section>

      <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="conf-title">
        <div>
          <h2 id="conf-title" className="text-[15px] font-semibold">{c.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-tx2">{c.intro}</p>
        </div>
        {confidence.ratedTradeCount === 0 ? (
          <EmptyState title={c.emptyTitle}>{c.emptyText}</EmptyState>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {[c.colGroup, c.colTrades, c.colWinRate, c.colAvgPnl, c.colAvgR].map((h, n) => (
                    <th key={h} className={`caption pb-2 font-semibold ${n > 0 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {confidence.buckets.map((b) => (
                  <tr key={b.bucket} className="border-t tabular-nums" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="py-2.5">
                      <span className="font-medium">{c.group[b.bucket]}</span>
                      <span className="ml-2 text-xs text-tx3">{c.range(b.min, b.max)}</span>
                    </td>
                    <td className="text-right">{b.tradeCount}</td>
                    <td className="text-right">{formatRatioPercent(b.winRate)}</td>
                    <td className="text-right">{b.avgNetPnl === null ? '—' : <Pnl value={roundDecimal(b.avgNetPnl, 2)} currency={currency} />}</td>
                    <td className="text-right">{formatR(b.avgR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="nt" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.04)' }}>
              <div>
                <p className="font-semibold">{c.verdictTitle}</p>
                <p className="mt-1 leading-relaxed text-tx2">
                  {confidence.verdict === 'not_enough_data' ? c.notEnoughData(confidence.correlationPairs) : c.verdict[confidence.verdict]}
                </p>
                {confidence.correlation !== null && (
                  <p className="mt-2 text-xs text-tx3">
                    {c.correlation(formatNumber(confidence.correlation, 2), confidence.correlationPairs)} — {c.correlationNote}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5 border-t pt-4 text-sm" style={{ borderColor: 'var(--hairline)' }}>
          <h3 className="text-[14px] font-semibold">{c.missedTitle}</h3>
          {confidence.missed.missedCount === 0 ? (
            <p className="text-tx3">{c.missedNone}</p>
          ) : (
            <>
              <p className="text-tx2">{c.missedCount(confidence.missed.missedCount)}</p>
              {confidence.missed.missedAvgConviction !== null && (
                <p className="text-tx2">{c.avgMissed} : <strong className="text-tx">{formatNumber(confidence.missed.missedAvgConviction, 1)} / 10</strong></p>
              )}
              {confidence.missed.takenAvgConviction !== null && (
                <p className="text-tx2">{c.avgTaken} : <strong className="text-tx">{formatNumber(confidence.missed.takenAvgConviction, 1)} / 10</strong></p>
              )}
              {confidence.missed.missedHighConviction > 0 && <p className="text-warn">{c.missedHigh(confidence.missed.missedHighConviction)}</p>}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
