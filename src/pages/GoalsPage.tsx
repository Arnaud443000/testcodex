import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Field } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { parseDecimalInput, signOf } from '../lib/decimal'
import { formatNumber } from '../lib/format'
import { currentMonth, formatActual, formatMonthName, formatTarget, shiftMonth } from '../lib/goalFormat'
import { dayKey } from '../lib/journalPeriod'
import { localTzOffsetMin } from '../lib/period'
import { GOAL_METRICS, type GoalMetric, type GoalProgress } from '../types/goals'

function GoalCard({ p, currency, onDelete }: { p: GoalProgress; currency: string; onDelete: () => Promise<void> }) {
  const t = useT()
  const g = t.goalsPage
  const [confirming, setConfirming] = useState(false)
  const ceiling = p.direction === 'at_most'
  const pct = p.fraction === null ? 0 : Math.min(100, p.fraction * 100)
  const label = g.metrics[p.goal.metric]
  const statusText = ceiling && g.statusCeiling[p.status] ? g.statusCeiling[p.status] : g.status[p.status]
  const badge = p.status === 'reached' ? 'badge-gain' : p.status === 'missed' || p.status === 'exceeded' ? 'badge-loss' : p.status === 'in_progress' ? 'badge-warn' : 'badge-neutral'
  const bad = p.status === 'exceeded' || p.status === 'missed'
  return (
    <li className="glass-card flex flex-col gap-3 px-6 py-5" aria-label={label}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{label}</h3>
          <p className="mt-0.5 max-w-[60ch] text-xs text-tx3">{g.metricHelp[p.goal.metric]}</p>
        </div>
        <span className={`badge ${badge}`}>{statusText}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
        <p className="text-sm text-tx2">
          {ceiling ? g.ceiling : g.target} : <strong className="text-[17px] text-tx tabular-nums">{formatTarget(p.goal.metric, p.goal.target, currency)}</strong>
        </p>
        <p className="text-sm text-tx2">
          {g.actual} : <strong className="text-[17px] text-tx tabular-nums">{formatActual(p, currency)}</strong>
        </p>
        <p className="text-xs text-tx3">{g.tradesCount(p.tradeCount)}</p>
      </div>
      <div
        role="progressbar"
        aria-label={g.progress(label, p.fraction === null ? '—' : `${formatNumber(p.fraction * 100, 0)} %`)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2 overflow-hidden rounded-full"
        style={{ background: 'rgba(255,255,255,.12)' }}
      >
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: bad ? '#F0776B' : 'var(--grad)' }} />
      </div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="text-tx3 tabular-nums">{p.fraction === null ? g.noValue : `${formatNumber(p.fraction * 100, 0)} %`}</span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-tx2">{g.deleteConfirm}</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void onDelete()}>{g.deleteYes}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>{g.cancel}</button>
          </span>
        ) : (
          <button type="button" className="btn-link !text-loss" onClick={() => setConfirming(true)}>{g.delete}</button>
        )}
      </div>
    </li>
  )
}

/** Objectifs mensuels (cahier 3.7.2) : tout est calculé par pulse-core, l'écran formate et dessine. */
export function GoalsPage() {
  const t = useT()
  const g = t.goalsPage
  const { accounts, loading, selectedId } = useAccounts()
  const [month, setMonth] = useState(currentMonth())
  const [progress, setProgress] = useState<GoalProgress[] | null>(null)
  const [previousCount, setPreviousCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [metric, setMetric] = useState<GoalMetric>('net_pnl')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const chosen = useMemo(() => (selectedId === null ? accounts : accounts.filter((a) => a.id === selectedId)), [accounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixed = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixed
  const currency = chosen[0]?.currency ?? 'USD'
  const previous = shiftMonth(month, -1)

  const load = useCallback(async () => {
    try {
      const [p, prev] = await Promise.all([
        api.getGoalProgress({ accountIds, month, tzOffsetMin: localTzOffsetMin(), today: dayKey() }),
        api.listGoals(previous),
      ])
      setProgress(p)
      setPreviousCount(prev.length)
      setError(null)
    } catch (e) {
      setError(g.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [accountIds, month, previous, g])

  useEffect(() => {
    if (!ready) return
    setProgress(null)
    void load()
  }, [ready, load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const value = parseDecimalInput(target)
    if (value === null || signOf(value) <= 0) return setFormError(g.errTarget)
    if (metric === 'win_rate' && Number(value) > 100) return setFormError(g.errWinRate)
    if (metric === 'execution_quality' && Number(value) > 5) return setFormError(g.errQuality)
    setBusy(true)
    try {
      await api.setGoal({ month, metric, target: value })
      setTarget('')
      await load()
    } catch (err) {
      setFormError(g.saveError(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<unknown>) {
    setFormError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setFormError(g.saveError(String(err instanceof Error ? err.message : err)))
    }
  }

  const header = <PageHeader title={t.pages.goals.title} subtitle={t.pages.goals.subtitle} />
  if (loading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {g.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={g.monthPrevious} onClick={() => setMonth(shiftMonth(month, -1))}>
          <Icon name="left" size={16} />
        </button>
        <p className="min-w-[180px] text-center text-[17px] font-semibold first-letter:uppercase">{formatMonthName(month)}</p>
        <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={g.monthNext} onClick={() => setMonth(shiftMonth(month, 1))}>
          <Icon name="right" size={16} />
        </button>
        {month !== currentMonth() && (
          <button type="button" className="btn-link" onClick={() => setMonth(currentMonth())}>{g.thisMonth}</button>
        )}
      </div>

      {mixed && <div className="nt nt-warn" role="status">{g.mixedCurrencies}</div>}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          {progress && progress.length === 0 && (
            <section className="glass-card">
              <EmptyState
                title={g.emptyTitle}
                action={
                  previousCount > 0 ? (
                    <button type="button" className="btn btn-secondary" onClick={() => void run(() => api.copyGoals(previous, month))}>
                      {g.copyFrom(formatMonthName(previous))}
                    </button>
                  ) : undefined
                }
              >
                {g.emptyText}
              </EmptyState>
            </section>
          )}
          {progress && progress.length > 0 && (
            <ul className="flex flex-col gap-4">
              {progress.map((p) => (
                <GoalCard key={p.goal.id} p={p} currency={p.currency ?? currency} onDelete={() => run(() => api.deleteGoal(p.goal.id))} />
              ))}
            </ul>
          )}
          <p className="text-xs text-tx3">{g.note}</p>
        </div>

        <form onSubmit={submit} className="glass-card flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="goal-form">
          <div>
            <h2 id="goal-form" className="text-[15px] font-semibold">{g.formTitle}</h2>
            <p className="mt-1 text-[13px] text-tx2">{g.formIntro}</p>
          </div>
          <Field label={g.metric} htmlFor="goal-metric">
            <select id="goal-metric" className="input" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              {GOAL_METRICS.map((m) => (
                <option key={m} value={m} className="bg-bg">{g.metrics[m]}</option>
              ))}
            </select>
            <p className="text-xs text-tx3">{g.metricHelp[metric]}</p>
          </Field>
          <Field label={`${g.targetLabel}${g.units[metric] ? ` (${g.units[metric] === 'devise du compte' ? currency : g.units[metric]})` : ''}`} htmlFor="goal-target">
            <input id="goal-target" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={metric === 'win_rate' ? '55' : metric === 'net_pnl' ? '500' : '1,5'} />
          </Field>
          {formError && <div className="nt nt-bad" role="alert">{formError}</div>}
          <button type="submit" className="btn btn-primary self-start" disabled={busy || !ready}>{g.add}</button>
        </form>
      </div>
    </div>
  )
}
