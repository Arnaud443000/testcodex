import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ConsistencyCard, DailyLossCard, MaxLossCard, ProfitTargetCard, TradingDaysCard } from '../components/prop/PropCards'
import { PropRulesEditor } from '../components/prop/PropRulesEditor'
import { Notice, Pnl } from '../components/ui'
import { Checkbox } from '../components/ui/Checkbox'
import { Select } from '../components/ui/Select'
import { Tooltip } from '../components/ui/Tooltip'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatMoney } from '../lib/format'
import { dayKey } from '../lib/journalPeriod'
import { pickPropAccount } from '../lib/propForm'
import { formatCountdown, formatDayKey, propErrorText } from '../lib/propView'
import type { PropStatus } from '../types/prop'

/** Compte prop choisi sur cette page, gardé sur ce PC (préférence d'affichage, jamais une donnée de trading). */
const MEMORY_KEY = 'pulse.prop.account'
function remembered(): number | null {
  try {
    const v = Number(localStorage.getItem(MEMORY_KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function remember(id: number) {
  try {
    localStorage.setItem(MEMORY_KEY, String(id))
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

/**
 * Lot 33 : suivi d'un compte prop firm. Tout vient de `get_prop_status` (pulse-core, trades clôturés seulement) ;
 * l'interface formate et dessine. La règle d'or est écrite en permanence au-dessus des jauges.
 */
export function PropPage() {
  const t = useT()
  const p = t.prop
  const { accounts, loading, selectedId } = useAccounts()
  const propAccounts = useMemo(() => accounts.filter((a) => a.kind === 'prop'), [accounts])
  const [accountId, setAccountId] = useState<number | null>(null)
  /** `undefined` = en chargement ; `null` = aucune règle. */
  const [status, setStatus] = useState<PropStatus | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ids = propAccounts.map((a) => a.id)
    if (accountId === null || !ids.includes(accountId)) setAccountId(pickPropAccount(ids, selectedId, remembered()))
  }, [propAccounts, selectedId, accountId])

  // Relu chaque minute : compte à rebours de la remise à zéro et changement de jour de trading.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback(async (id: number) => {
    try {
      const s = await api.getPropStatus(id)
      setStatus(s)
      setError(null)
    } catch (err) {
      setError(propErrorText(t, err))
    }
  }, [t])

  useEffect(() => {
    if (accountId === null) return
    void load(accountId)
  }, [accountId, tick, load])

  const account = propAccounts.find((a) => a.id === accountId) ?? null

  if (loading) return <p className="text-sm text-tx3">{p.loading}</p>

  if (propAccounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={p.title} subtitle={p.subtitle} />
        <EmptyState icon="shield" title={p.empty.noAccountTitle} action={<Link to="/settings#comptes" className="btn btn-primary">{p.empty.noAccountAction}</Link>}>
          {p.empty.noAccount}
        </EmptyState>
      </div>
    )
  }

  const chooser = propAccounts.length > 0 && (
    <div className="flex items-center gap-2">
      <label htmlFor="prop-account" className="caption whitespace-nowrap">{p.accountLabel}</label>
      <Select
        id="prop-account"
        value={accountId === null ? '' : String(accountId)}
        className="min-w-[200px] !w-auto"
        options={propAccounts.map((a) => ({ value: String(a.id), label: `${a.name} (${a.currency})` }))}
        onChange={(v) => {
          const id = Number(v)
          setStatus(undefined)
          setAccountId(id)
          remember(id)
        }}
      />
    </div>
  )

  const golden = (
    <Notice level="warn">
      <p className="font-semibold">{p.golden.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed">{p.golden.text}</p>
      {status && (status.openTradeCount > 0 || status.cashFlowCount > 0 || status.beforeStartCount > 0) && (
        <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5 text-[13px]" data-testid="prop-ignored">
          {status.openTradeCount > 0 && <li>{p.openTrades(status.openTradeCount)}</li>}
          {status.cashFlowCount > 0 && <li>{p.cashFlows(status.cashFlowCount)}</li>}
          {status.beforeStartCount > 0 && <li>{p.beforeStart(status.beforeStartCount)}</li>}
        </ul>
      )}
    </Notice>
  )

  const onSaved = () => {
    setEditing(false)
    setStatus(undefined)
    if (accountId !== null) void load(accountId)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {chooser}
            {status && (
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                <Icon name="edit" size={16} />
                {p.summary.edit}
              </button>
            )}
          </div>
        }
      />

      {golden}

      {error && <Notice level="bad">{p.loadError(error)}</Notice>}

      {status === undefined && !error && <p className="text-sm text-tx3">{p.loading}</p>}

      {status === null && account && (
        <EmptyState icon="shield" title={p.empty.noRulesTitle} action={<button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>{p.empty.noRulesAction}</button>}>
          {p.empty.noRules}
        </EmptyState>
      )}

      {status && (
        <>
          <section className="glass-card flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4" aria-label={p.summary.balance}>
            {status.rules.phaseLabel && <span className="badge badge-neutral">{status.rules.phaseLabel}</span>}
            <div className="flex flex-col">
              <span className="caption">{p.summary.balance}</span>
              <span className="text-xl font-semibold tabular-nums">{formatMoney(status.balance, status.currency)}</span>
            </div>
            <div className="flex flex-col">
              <span className="caption">{p.summary.netPnl}</span>
              <Pnl value={status.netPnl} currency={status.currency} className="text-xl font-semibold tabular-nums" />
            </div>
            <div className="flex flex-col">
              <span className="caption">{p.summary.initial}</span>
              <span className="text-[15px] tabular-nums text-tx2">{formatMoney(status.initialCapital, status.currency)}</span>
            </div>
            <div className="flex flex-col gap-0.5 text-[13px] text-tx2">
              <span>{p.summary.started(formatDayKey(status.rules.startedOn))}</span>
              <span>{p.summary.closedTrades(status.closedTradeCount)}</span>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-tx2" data-testid="prop-day">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={16} />
              {p.day.current(formatDayKey(status.tradingDay.startsParisDay), status.tradingDay.startsParisTime)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-tx">
              <Icon name="reset" size={16} />
              {p.day.reset(formatCountdown(status.nextReset.inMs), formatDayKey(status.nextReset.parisDay), status.nextReset.parisTime)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            <DailyLossCard s={status} onEdit={() => setEditing(true)} />
            <MaxLossCard s={status} onEdit={() => setEditing(true)} />
            <ProfitTargetCard s={status} onEdit={() => setEditing(true)} />
            <TradingDaysCard s={status} />
            <ConsistencyCard s={status} onEdit={() => setEditing(true)} />
          </div>

          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={status.alertsEnabled}
              label={p.summary.alerts}
              testId="prop-alerts"
              onChange={(v) => {
                void api.setPropAlerts(v).then(() => {
                  if (accountId !== null) void load(accountId)
                })
              }}
            />
            <Tooltip content={p.summary.alertsHelp} focusable>
              <span className="grid h-[18px] w-[18px] cursor-help place-items-center text-tx3" role="img" aria-label={p.editor.help(p.summary.alerts)}>
                <Icon name="info" size={15} />
              </span>
            </Tooltip>
          </div>
        </>
      )}

      {editing && account && (
        <PropRulesEditor account={account} rules={status?.rules ?? null} today={dayKey(new Date())} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}
    </div>
  )
}
