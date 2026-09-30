import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { Tooltip } from '../ui/Tooltip'
import { Pnl } from '../ui'
import { useT } from '../../i18n'
import { formatMoney, formatRatioPercent } from '../../lib/format'
import { formatPercentValue } from '../../lib/behaviorFormat'
import { formatDayKey, formatUsedPercent, gaugeWidth, remainingText } from '../../lib/propView'
import type { PropStatus } from '../../types/prop'
import { PropGauge } from './PropGauge'

/**
 * Les cinq cartes du suivi prop firm (lot 33). Aucun calcul : tout vient de `get_prop_status` (pulse-core).
 * Montants arrondis au centime à l'affichage seulement (`formatMoney`, sur la chaîne décimale).
 */

function Card({ title, help, children, testId }: { title: string; help: string; children: ReactNode; testId: string }) {
  const t = useT()
  return (
    <section className="glass-card flex min-w-0 flex-col gap-4 p-5" data-testid={testId} aria-label={title}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        {title}
        <Tooltip content={help} focusable>
          <span className="grid h-[18px] w-[18px] cursor-help place-items-center text-tx3" role="img" aria-label={t.prop.editor.help(title)}>
            <Icon name="info" size={16} />
          </span>
        </Tooltip>
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className="text-tx3">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-tx">{children}</dd>
    </div>
  )
}

function NotSet({ onEdit }: { onEdit: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-1 flex-col items-start gap-2">
      <p className="text-sm text-tx3">{t.prop.notSet}</p>
      <button type="button" className="btn-link" onClick={onEdit}>{t.prop.notSetAction}</button>
    </div>
  )
}

export function DailyLossCard({ s, onEdit }: { s: PropStatus; onEdit: () => void }) {
  const t = useT()
  const c = t.prop.cards.dailyLoss
  const d = s.dailyLoss
  return (
    <Card title={c.title} help={t.prop.editor.dailyLossHelp} testId="prop-daily">
      {!d ? (
        <NotSet onEdit={onEdit} />
      ) : (
        <>
          <PropGauge label={c.title} used={d.used} level={d.level} detail={d.limit === null ? c.noLimit : remainingText(t, d.remaining, s.currency)} />
          <dl className="flex flex-col gap-1.5">
            <Row label={c.loss}>{formatMoney(d.loss, s.currency)}</Row>
            <Row label={c.limit}>{d.limit === null ? '—' : formatMoney(d.limit, s.currency)}</Row>
          </dl>
          <p className="text-xs text-tx3">
            {d.rule.mode === 'amount'
              ? c.amount
              : d.reference === 'initialBalance'
                ? c.refInitial(formatPercentValue(d.rule.value))
                : c.refDayStart(formatPercentValue(d.rule.value))}
            {' · '}
            {c.trades(d.tradeCount)}
          </p>
        </>
      )}
    </Card>
  )
}

export function MaxLossCard({ s, onEdit }: { s: PropStatus; onEdit: () => void }) {
  const t = useT()
  const c = t.prop.cards.maxLoss
  const m = s.maxLoss
  return (
    <Card title={c.title} help={t.prop.editor.maxLossKindHelp} testId="prop-max">
      {!m ? (
        <NotSet onEdit={onEdit} />
      ) : (
        <>
          <PropGauge label={c.title} used={m.used} level={m.level} detail={m.limit === null ? c.noLimit : remainingText(t, m.remaining, s.currency)} />
          <dl className="flex flex-col gap-1.5">
            <Row label={c.balance}>{formatMoney(s.balance, s.currency)}</Row>
            <Row label={c.floor}>{m.floor === null ? '—' : formatMoney(m.floor, s.currency)}</Row>
            {m.kind === 'trailing' && <Row label={c.peak}>{formatMoney(m.peak, s.currency)}</Row>}
            <Row label={c.limit}>
              {m.limit === null ? '—' : formatMoney(m.limit, s.currency)}
              {m.rule.mode === 'percent' && <span className="ml-1 text-xs font-normal text-tx3">({formatPercentValue(m.rule.value)})</span>}
            </Row>
          </dl>
          <p className="text-xs text-tx3">
            {m.kind === 'static' ? c.static : c.trailing}
            {m.kind === 'trailing' && m.locksAtInitial && <> · {m.floorLocked ? c.locked : c.lockNote}</>}
          </p>
        </>
      )}
    </Card>
  )
}

export function ProfitTargetCard({ s, onEdit }: { s: PropStatus; onEdit: () => void }) {
  const t = useT()
  const c = t.prop.cards.profitTarget
  const p = s.profitTarget
  const icon = p?.reached ? 'check' : 'goals'
  return (
    <Card title={c.title} help={t.prop.editor.profitTargetHelp} testId="prop-target">
      {!p ? (
        <NotSet onEdit={onEdit} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${p.reached ? 'text-gain' : 'text-tx-accent'}`}>
              <Icon name={icon} size={16} />
              {p.reached === null ? t.prop.undefinedLevel : p.reached ? c.reached : c.inProgress}
            </span>
            <span className="text-lg font-semibold tabular-nums">{c.progress(formatUsedPercent(p.progress))}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t.prop.gaugeAria(c.title, c.progress(formatUsedPercent(p.progress)), p.reached ? c.reached : c.inProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(gaugeWidth(p.progress))}
            className="h-2 overflow-hidden rounded-full bg-white/10"
          >
            <div className="h-full rounded-full" style={{ width: `${gaugeWidth(p.progress)}%`, background: 'var(--grad)' }} />
          </div>
          <dl className="flex flex-col gap-1.5">
            <Row label={c.gain}>
              <Pnl value={p.gain} currency={s.currency} />
            </Row>
            <Row label={c.target}>{p.target === null ? '—' : formatMoney(p.target, s.currency)}</Row>
          </dl>
          <p className="text-xs text-tx3">{p.target === null ? c.noTarget : p.reached ? c.reached : c.left(formatMoney(p.remaining ?? '0', s.currency))}</p>
        </>
      )}
    </Card>
  )
}

export function TradingDaysCard({ s }: { s: PropStatus }) {
  const t = useT()
  const c = t.prop.cards.tradingDays
  const d = s.tradingDays
  return (
    <Card title={c.title} help={t.prop.editor.minTradingDaysHelp} testId="prop-days">
      <p className="text-[28px] font-semibold tabular-nums leading-none">
        {d.count}
        {d.minimum !== null && <span className="text-lg text-tx3"> / {d.minimum}</span>}
      </p>
      <p className="text-[13px] text-tx2">{c.count(d.count)}</p>
      {d.minimum === null ? (
        <p className="text-xs text-tx3">{c.noMinimum}</p>
      ) : (
        <p className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${d.done ? 'text-gain' : 'text-tx-accent'}`}>
          <Icon name={d.done ? 'check' : 'calendar'} size={16} />
          {d.done ? c.done : c.missing(d.missing ?? 0)}
          <span className="font-normal text-tx3">· {c.minimum(d.minimum)}</span>
        </p>
      )}
    </Card>
  )
}

export function ConsistencyCard({ s, onEdit }: { s: PropStatus; onEdit: () => void }) {
  const t = useT()
  const c = t.prop.cards.consistency
  const k = s.consistency
  return (
    <Card title={c.title} help={t.prop.editor.consistencyHelp} testId="prop-consistency">
      {!k ? (
        <NotSet onEdit={onEdit} />
      ) : (
        <>
          <PropGauge
            label={c.title}
            used={k.used}
            level={k.level}
            consistency
            detail={k.share === null ? c.noProfit : c.share(formatRatioPercent(k.share))}
          />
          <dl className="flex flex-col gap-1.5">
            <Row label={c.total}>
              <Pnl value={k.totalProfit} currency={s.currency} />
            </Row>
            <Row label={c.best}>{k.bestDay ? <Pnl value={k.bestDay.netPnl} currency={s.currency} /> : '—'}</Row>
          </dl>
          {k.bestDay && <p className="text-xs text-tx3">{c.bestDay(formatDayKey(k.bestDay.day.startsParisDay), k.bestDay.day.startsParisTime)}</p>}
          <p className="text-xs text-tx3">
            {c.cap(formatPercentValue(k.maxBestDayPercent))}
            {k.bestDayAllowed !== null && <> · {c.allowed(formatMoney(k.bestDayAllowed, s.currency))}</>}
          </p>
          <p className="text-xs text-tx3">{c.equality}</p>
        </>
      )}
    </Card>
  )
}
