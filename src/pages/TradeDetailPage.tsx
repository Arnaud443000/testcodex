import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { TradeDisciplineCard } from '../components/TradeDisciplineCard'
import { TradeCardDialog } from '../components/TradeCardDialog'
import { ScreenshotAiCard } from '../components/ScreenshotAiCard'
import { ExecutionScoreLine } from '../components/ExecutionScoreLine'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { OutcomeBadge, Pnl, QualityBar, StarRating } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { signOf } from '../lib/decimal'
import { formatDateTime, formatDuration, formatMoney, formatNumber, formatR, formatSignedMoney } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import { isIncomplete, tagOfKind } from '../lib/tradeList'
import type { TradeView } from '../types/trade'

export function TradeDetailPage() {
  const t = useT()
  const d = t.detail
  const navigate = useNavigate()
  const id = Number(useParams().id)
  const ref = useReferenceData()
  const [trade, setTrade] = useState<TradeView | null>(null)
  const [neighbours, setNeighbours] = useState<{ prev: number | null; next: number | null }>({ prev: null, next: null })
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [cardOpen, setCardOpen] = useState(false)

  useEffect(() => {
    let live = true
    setTrade(null)
    setMissing(false)
    setError(null)
    setConfirmDelete(false)
    api
      .getTrade(id)
      .then(async (tr) => {
        if (!live) return
        setTrade(tr)
        // Précédent / suivant : dans l'ordre chronologique des trades du même compte.
        const all = await api.listTrades({ accountIds: [tr.accountId] })
        if (!live) return
        const i = all.findIndex((x) => x.id === tr.id)
        setNeighbours({ prev: all[i + 1]?.id ?? null, next: i > 0 ? all[i - 1].id : null })
      })
      .catch((e) => {
        if (!live) return
        if (String(e).includes('not found')) setMissing(true)
        else setError(String(e))
      })
    return () => {
      live = false
    }
  }, [id])

  useEffect(() => {
    let live = true
    setScreenshot(null)
    if (trade?.screenshotPath) {
      api
        .readScreenshot(trade.screenshotPath)
        .then((u) => live && setScreenshot(u))
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [trade?.screenshotPath])

  const tagName = (tagId: number) => ref.allTags.find((g) => g.id === tagId)?.name ?? '—'
  const emotionsByMoment = useMemo(
    () => (['before', 'during', 'after'] as const).map((m) => trade?.emotions.filter((e) => e.moment === m) ?? []),
    [trade],
  )

  if (missing || !Number.isFinite(id)) {
    return (
      <section className="glass-card">
        <EmptyState title={d.notFoundTitle} action={<Link to="/trades" className="btn btn-primary">{d.backToList}</Link>}>
          {d.notFoundText}
        </EmptyState>
      </section>
    )
  }
  if (error) return <div className="nt nt-bad" role="alert">{d.loadError(error)}</div>
  if (!trade) return <PageHeader title={t.pages.trades.title} />

  const f = trade.figures
  const setup = tagOfKind(trade, ref.allTags, 'setup')
  const market = tagOfKind(trade, ref.allTags, 'market_condition')
  const session = tagOfKind(trade, ref.allTags, 'session')
  const timeframe = tagOfKind(trade, ref.allTags, 'timeframe')
  const mistakes = trade.tagIds.filter((x) => ref.allTags.find((g) => g.id === x)?.kind === 'mistake')
  const ruleTotal = trade.ruleChecks.length
  const ruleOk = trade.ruleChecks.filter((c) => c.respected).length
  const checkTotal = trade.checklist.length
  const checkDone = trade.checklist.filter((c) => c.checked).length
  const oc = trade.opportunityCost

  const remove = async () => {
    try {
      await api.deleteTrade(trade.id)
      navigate('/trades')
    } catch (e) {
      setDeleteError(String(e).replace(/^Error: /, ''))
    }
  }

  const NavBtn = ({ to, children }: { to: number | null; children: ReactNode }) =>
    to === null ? (
      <span className="btn btn-secondary pointer-events-none opacity-40" aria-disabled="true">{children}</span>
    ) : (
      <Link to={`/trades/${to}`} className="btn btn-secondary">{children}</Link>
    )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={d.title(trade.id)}
        subtitle={d.subtitle}
        actions={
          <>
            <NavBtn to={neighbours.prev}>‹ {d.previous}</NavBtn>
            <NavBtn to={neighbours.next}>{d.next} ›</NavBtn>
            <button type="button" className="btn btn-secondary" onClick={() => setCardOpen(true)} title={t.tradeCard.openHint}>{t.tradeCard.open}</button>
            <Link to={`/trades/${trade.id}/edit`} className="btn btn-secondary">{d.edit}</Link>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>{d.delete}</button>
          </>
        }
      />

      {cardOpen && <TradeCardDialog trade={trade} setupName={setup?.name ?? null} screenshotUrl={screenshot} onClose={() => setCardOpen(false)} />}

      {confirmDelete && (
        <div className="nt nt-bad flex-col" role="alertdialog" aria-labelledby="del-title">
          <strong id="del-title">{d.confirmDeleteTitle}</strong>
          <p>{d.confirmDeleteText}</p>
          {deleteError && <p>{d.deleteError(deleteError)}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()}>{d.confirmDelete}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</button>
          </div>
        </div>
      )}

      {isIncomplete(trade) && (
        <div className="nt nt-warn items-center justify-between" role="status">
          <span><strong>{d.incompleteTitle}</strong> — {d.incompleteText}</span>
          <Link to={`/trades/${trade.id}/edit`} className="btn btn-secondary btn-sm">{d.complete}</Link>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="shot-title">
            <h2 id="shot-title" className="text-[15px] font-semibold">{d.screenshotTitle}</h2>
            {screenshot ? (
              <img src={screenshot} alt={d.screenshotTitle} className="mx-auto max-h-[520px] max-w-full rounded-inner object-contain" />
            ) : trade.screenshotPath ? (
              <p className="py-10 text-center text-sm text-tx2">{t.common.loading}</p>
            ) : (
              <EmptyState title={d.screenshotEmpty} action={<Link to={`/trades/${trade.id}/edit`} className="btn btn-secondary">{d.addScreenshot}</Link>}>
                {d.screenshotEmptyText}
              </EmptyState>
            )}
          </section>

          <ScreenshotAiCard tradeId={trade.id} hasScreenshot={!!trade.screenshotPath} />

          <div className="grid gap-5 md:grid-cols-2">
            <TextCard title={d.thesis} text={trade.thesis} empty={d.thesisEmpty} action={<Link to={`/trades/${trade.id}/edit`} className="btn-link">{d.writeIt}</Link>} />
            <TextCard title={d.postMortem} text={trade.postMortem} empty={d.postMortemEmpty} action={<Link to={`/trades/${trade.id}/edit`} className="btn-link">{d.writeIt}</Link>} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <Tile label={d.stop} value={`${trade.plannedSl ?? '—'} / ${trade.actualSl ?? '—'}`} sub={trade.plannedSl ? (trade.actualSl ? undefined : d.notHit) : d.noPlan} />
            <Tile label={d.target} value={`${trade.plannedTp ?? '—'} / ${trade.actualTp ?? '—'}`} sub={trade.plannedTp ? (trade.actualTp ? undefined : d.notHit) : d.noPlan} />
            <Tile
              label={d.rr}
              value={`${formatNumber(f?.plannedRewardRisk ?? null, 1)} / ${formatR(f?.rMultiple ?? null)}`}
            />
            <Tile
              label={d.opportunity}
              value={oc === null ? '—' : `≈ ${formatSignedMoney(oc, trade.currency)}`}
              sub={
                oc === null
                  ? d.priceAfterExitEmpty
                  : `${signOf(oc) > 0 ? d.leftOnTable : signOf(oc) < 0 ? d.goodExit : ''}${trade.priceAfterExit ? ` · ${d.priceAfterExit(trade.priceAfterExit)}` : ''}`.replace(/^ · /, '')
              }
              warn={oc !== null && signOf(oc) > 0}
            />
          </div>

          <TradeDisciplineCard tradeId={trade.id} />
        </div>

        <aside className="flex flex-col gap-5">
          <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-label={trade.symbol}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold leading-tight">
                  {trade.symbol}{' '}
                  <span className={`text-xs font-bold uppercase tracking-wide ${trade.direction === 'long' ? 'text-gain' : 'text-loss'}`}>{t.common.directions[trade.direction]}</span>
                </h2>
                <p className="mt-1 text-xs text-tx3">
                  {formatDateTime(trade.entryTime)}
                  {trade.exitTime != null && ` → ${formatDateTime(trade.exitTime)}`}
                  {session && ` · ${session.name}`}
                  {timeframe && ` · ${timeframe.name}`}
                </p>
              </div>
              <OutcomeBadge outcome={f?.outcome ?? 'open'} />
            </div>

            {f ? (
              <div>
                <Pnl value={f.netPnl} currency={trade.currency} className="text-[40px] font-semibold leading-tight tracking-tight" />
                <p className="mt-1 text-sm text-tx2">
                  {f.rMultiple !== null ? formatR(f.rMultiple) : '—'} · {d.net(formatMoney(f.fees, trade.currency))}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[24px] font-semibold">{d.openTitle}</p>
                <p className="mt-1 text-sm text-tx2">{d.openText}</p>
              </div>
            )}

            <div>
              <div className="hairline-row"><span className="text-tx2">{d.rows.entryExit}</span><span className="font-semibold">{trade.entryPrice} → {trade.exitPrice ?? '—'}</span></div>
              <div className="hairline-row"><span className="text-tx2">{d.rows.stopTarget}</span><span className="font-semibold">{trade.plannedSl ?? '—'} / {trade.plannedTp ?? '—'}</span></div>
              <div className="hairline-row">
                <span className="text-tx2">{d.rows.sizeRisk}</span>
                <span className="font-semibold">{trade.size}{trade.initialRisk ? ` · ${formatMoney(trade.initialRisk, trade.currency)}` : ''}</span>
              </div>
              <div className="hairline-row"><span className="text-tx2">{d.rows.context}</span><span className="font-semibold">{[setup?.name, market?.name].filter(Boolean).join(' · ') || '—'}</span></div>
              <div className="hairline-row"><span className="text-tx2">{d.rows.account}</span><span className="font-semibold">{trade.accountName}</span></div>
              <div className="hairline-row"><span className="text-tx2">{t.form.preview.duration}</span><span className="font-semibold">{formatDuration(trade.durationMs)}</span></div>
            </div>
          </section>

          <section className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="process-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="process-title" className="text-[15px] font-semibold">{d.process}</h2>
              {trade.planFollowed && (
                <span className={`badge ${trade.planFollowed === 'yes' ? 'badge-gain' : trade.planFollowed === 'no' ? 'badge-loss' : 'badge-warn'}`}>
                  {t.common.planFollowed[trade.planFollowed]}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="caption">{d.execution}</span>
                {trade.executionQuality ? <QualityBar label={d.execution} value={trade.executionQuality} /> : <span className="text-sm text-tx3">{t.common.unset}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="caption">{d.rating}</span>
                {trade.rating ? <StarRating label={d.rating} value={trade.rating} /> : <span className="text-sm text-tx3">{t.common.unset}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="caption">{d.emotions}</span>
              {trade.emotions.length === 0 ? (
                <span className="text-sm text-tx3">{d.noEmotions}</span>
              ) : (
                <ol className="flex flex-wrap items-center gap-2">
                  {emotionsByMoment.map((list, i) =>
                    list.length === 0 ? null : (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        {i > 0 && emotionsByMoment.slice(0, i).some((l) => l.length > 0) && <span aria-hidden="true" className="text-tx3">→</span>}
                        {list.map((e) => (
                          <span key={`${e.moment}-${e.tagId}`} className="chip chip-on chip-static" title={t.common.moments[e.moment]}>
                            <span className="mr-1.5 text-[11px] uppercase text-tx2">{t.common.moments[e.moment]}</span>
                            {tagName(e.tagId)}
                          </span>
                        ))}
                      </li>
                    ),
                  )}
                </ol>
              )}
            </div>
            <ExecutionScoreLine tradeId={trade.id} />
            <div className="flex flex-col gap-1 text-sm">
              <span>{checkTotal > 0 ? d.checklist(checkDone, checkTotal) : <span className="text-tx3">{d.noChecklist}</span>}</span>
              <span>{ruleTotal > 0 ? d.rules(ruleOk, ruleTotal) : <span className="text-tx3">{d.noRules}</span>}</span>
              {trade.ruleChecks.filter((c) => !c.respected).map((c) => (
                <span key={c.ruleId} className="text-[#F5A198]">✕ {ref.allRules.find((r) => r.id === c.ruleId)?.text ?? '—'}</span>
              ))}
            </div>
            {mistakes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="caption">{d.mistakes}</span>
                <div className="flex flex-wrap gap-2">
                  {mistakes.map((m) => (
                    <span key={m} className="chip chip-bad chip-static">{tagName(m)}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-tx2">
              {trade.conviction && <span>{d.conviction} : <strong className="text-tx">{trade.conviction} / 10</strong></span>}
              {trade.executionType && <span>{d.executionType} : <strong className="text-tx">{t.common.executionTypes[trade.executionType]}</strong></span>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function TextCard({ title, text, empty, action }: { title: string; text: string; empty: string; action: ReactNode }) {
  return (
    <section className="rounded-inner border px-[22px] py-[18px]" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.04)' }}>
      <h2 className="caption mb-2.5">{title}</h2>
      {text.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-[1.6]">{text}</p>
      ) : (
        <p className="flex items-center justify-between gap-3 text-sm text-tx3">
          {empty} {action}
        </p>
      )}
    </section>
  )
}

function Tile({ label, value, sub, warn = false }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-inner border px-[18px] py-4" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.04)' }}>
      <p className="caption">{label}</p>
      <p className="mt-2 text-[22px] font-semibold leading-tight">{value}</p>
      {sub && <p className={`mt-1 text-xs ${warn ? 'text-warn' : 'text-tx3'}`}>{sub}</p>}
    </div>
  )
}
