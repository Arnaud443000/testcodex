import { Link } from 'react-router-dom'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { formatFeeRounded, formatProfitFactor } from '../../lib/analysesView'
import { hintText } from '../../lib/comparisonsView'
import { formatNumber, formatR, formatRatioPercent } from '../../lib/format'
import type { Account } from '../../types/account'
import type { AccountComparison, AccountRow } from '../../types/stats'
import { EmptyState } from '../EmptyState'
import { LowSampleBadge, PnlRounded, Section } from '../analyses/parts'
import { ChipButton, Notice } from '../ui'

type Metric = { key: keyof ReturnType<typeof useT>['comparisons']['accounts']['rows']; money: boolean; hint?: 'avgR' | 'feesShare' | 'feesPerTrade'; cell: (r: AccountRow) => React.ReactNode }

/** Comparaison entre comptes / brokers (3.7.6) : un compte par colonne, un indicateur par ligne. */
export function AccountsPanel({
  candidates,
  selected,
  onToggle,
  comparison,
}: {
  candidates: Account[]
  selected: number[]
  onToggle: (id: number) => void
  comparison: AccountComparison | null
}) {
  const t = useT()
  const s = t.comparisons.accounts

  const picker = (
    <Section title={s.pickerLabel} subtitle={s.pickerHint}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={s.pickerLabel}>
        {candidates.map((a) => (
          <ChipButton key={a.id} on={selected.includes(a.id)} onClick={() => onToggle(a.id)}>
            {a.name} · {a.currency}
          </ChipButton>
        ))}
      </div>
    </Section>
  )

  if (candidates.length < 2) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
        <section className="glass-card">
          <EmptyState title={s.onlyOneAccountTitle} action={<Link to="/settings" className="btn btn-primary">{s.settings}</Link>}>
            {s.onlyOneAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (selected.length < 2) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
        {picker}
        <section className="glass-card">
          <EmptyState title={s.needTwoTitle}>{s.needTwoText}</EmptyState>
        </section>
      </div>
    )
  }
  if (!comparison) return <p className="px-1 text-sm text-tx2">{t.common.loading}</p>

  const { rows, mixedCurrencies } = comparison
  const metrics: Metric[] = [
    { key: 'trades', money: false, cell: (r) => r.summary.tradeCount },
    { key: 'winRate', money: false, cell: (r) => formatRatioPercent(r.summary.winRate, 0) },
    { key: 'avgR', money: false, hint: 'avgR', cell: (r) => formatR(r.summary.expectancyR, 2) },
    { key: 'profitFactor', money: false, cell: (r) => formatProfitFactor(r.summary) },
    { key: 'maxDrawdownPct', money: false, cell: (r) => formatRatioPercent(r.summary.maxDrawdownPct, 1) },
    { key: 'feesShare', money: false, hint: 'feesShare', cell: (r) => formatRatioPercent(r.feesShareOfGross, 1) },
    { key: 'expectancyMoney', money: true, cell: (r) => (r.summary.avgNetPnl === null ? '—' : <PnlRounded value={r.summary.avgNetPnl} currency={r.currency} />) },
    { key: 'maxDrawdown', money: true, cell: (r) => formatFeeRounded(r.summary.maxDrawdown, r.currency) },
    { key: 'feesPerTrade', money: true, hint: 'feesPerTrade', cell: (r) => (r.feesPerTrade === null ? '—' : formatFeeRounded(r.feesPerTrade, r.currency)) },
    { key: 'netPnl', money: true, cell: (r) => <span className="font-semibold"><PnlRounded value={r.summary.netPnl} currency={r.currency} /></span> },
  ]
  const comparable = rows.filter((r) => !r.lowSample).length >= 2

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[90ch] text-sm leading-relaxed text-tx2">{s.intro}</p>
      {picker}
      {mixedCurrencies && <Notice level="warn">{s.mixedWarning(comparison.currencies)}</Notice>}
      <Section title={s.metricsTitle} subtitle={s.metricsHint}>
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 260 + rows.length * 170 }}>
            <thead>
              <tr>
                <th scope="col" className="caption px-3 py-3 text-left font-semibold">
                  <span className="sr-only">{s.metricsTitle}</span>
                </th>
                {rows.map((r) => (
                  <th key={r.accountId} scope="col" className="px-3 py-3 text-right align-bottom">
                    <div className="text-[15px] font-semibold">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs font-normal text-tx3">
                      {r.broker && <span>{r.broker}</span>}
                      <span className="badge badge-neutral">{r.currency}</span>
                      {r.lowSample && <LowSampleBadge />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const grey = m.money && mixedCurrencies
                return (
                  <tr key={m.key} className="h-[48px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                    <Tooltip content={m.hint ? s.rowHints[m.hint] : undefined}>
                      <th scope="row" className="px-3 text-left font-medium text-tx2">
                        {s.rows[m.key]}
                        {grey && <span className="ml-2 text-xs font-normal text-warn">{s.moneyRow}</span>}
                      </th>
                    </Tooltip>
                    {rows.map((r) => (
                      <td key={r.accountId} className={`px-3 text-right tabular-nums ${grey ? 'text-tx3' : ''}`}>
                        {r.summary.tradeCount === 0 && m.key !== 'trades' ? '—' : m.cell(r)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.some((r) => r.summary.tradeCount === 0) && <p className="mt-3 text-xs text-tx3">{s.noTrades} : {rows.filter((r) => r.summary.tradeCount === 0).map((r) => r.name).join(', ')}.</p>}
      </Section>
      <Section title={s.hintsTitle} subtitle={s.hintsCaution}>
        {comparison.hints.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {comparison.hints.map((h) => (
              <li key={`${h.kind}-${h.accountId}-${h.otherAccountId}`} className="flex gap-3 rounded-md border p-4 text-sm leading-relaxed text-tx2" style={{ borderColor: 'var(--hairline)' }}>
                <span className="badge badge-warn h-fit shrink-0">{s.hintKind[h.kind]}</span>
                <span>{hintText(h, comparison, t)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[80ch] text-sm leading-relaxed text-tx2">{comparable ? s.noHints : s.hintsNeed(comparison.minSample)}</p>
        )}
        <p className="mt-3 text-xs text-tx3">{s.thresholds(formatNumber(comparison.feesGapThreshold * 100, 0), formatNumber(comparison.rGapThreshold, 2))}</p>
      </Section>
    </div>
  )
}
