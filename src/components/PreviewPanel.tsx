import { useT } from '../i18n'
import { formatDuration, formatMoney, formatNumber, formatR, formatSignedMoney } from '../lib/format'
import type { Preview } from '../types/trade'
import { Pnl } from './ui'

/** Aperçu en direct : tous les chiffres viennent de pulse-core (commande `preview_trade`). */
export function PreviewPanel({
  preview,
  currency,
  pending,
  error,
}: {
  preview: Preview | null
  currency: string
  pending: boolean
  error: string | null
}) {
  const t = useT()
  const p = t.form.preview
  const f = preview?.figures ?? null

  return (
    <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-live="polite" aria-label={p.title}>
      <p className="caption">{p.title}</p>
      {!preview ? (
        <p className="text-sm text-tx2">{error ? p.unavailable(error) : pending ? p.computing : p.empty}</p>
      ) : (
        <>
          {f ? (
            <div>
              <Pnl value={f.netPnl} currency={currency} className="text-[36px] font-semibold leading-tight tracking-tight" />
              <p className="mt-1 text-xs text-tx3">
                {p.netResult(currency)} · {formatR(f.rMultiple)}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[24px] font-semibold leading-tight">{p.openTrade}</p>
              <p className="mt-1 text-xs text-tx3">{p.openTradeHint}</p>
            </div>
          )}
          <div>
            {f && (
              <>
                <Row label={p.gross} value={formatSignedMoney(f.grossPnl, currency)} />
                <Row label={p.fees} value={formatMoney(f.fees, currency)} />
              </>
            )}
            <Row
              label={p.risk}
              value={
                preview.initialRisk
                  ? `${formatMoney(preview.initialRisk, currency)}${preview.riskPctOfCapital !== null ? ` · ${p.riskOfCapital(`${formatNumber(preview.riskPctOfCapital, 2)} %`)}` : ''}`
                  : '—'
              }
            />
            <Row label={p.plannedRr} value={formatNumber(preview.plannedRewardRisk, 2)} />
            <Row label={p.duration} value={formatDuration(preview.durationMs)} />
            <Row label={p.session} value={preview.session} />
          </div>
        </>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hairline-row">
      <span className="text-tx2">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
