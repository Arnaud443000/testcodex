import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { useAccounts } from '../../lib/accounts'
import { api } from '../../lib/api'
import { tradesHref } from '../../lib/idsFilter'
import { localTzOffsetMin } from '../../lib/period'
import { goalSentence, periodTitle, processTemplates, ratioText, statusLook, targetText, valueText } from '../../lib/processGoalsView'
import { boundaryOffsets, currentPeriodKey } from '../../lib/processPeriods'
import type { ProcessGoal, ProcessGoalProgress, ProcessPeriodKind, ProcessProgress, RequiredSetting } from '../../types/processGoals'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import { Segmented } from '../ui'
import { Tooltip } from '../ui/Tooltip'
import { ProcessGoalDialog } from './ProcessGoalDialog'

/** Statut d'un objectif : icône (forme) + texte ; la couleur ne fait que doubler le sens. */
export function ProcessStatusBadge({ p }: { p: ProcessGoalProgress }) {
  const t = useT().processGoals
  const look = statusLook(p.status)
  return (
    <Tooltip content={t.statusHelp[p.status]}>
      <span className={`badge badge-icon shrink-0 whitespace-nowrap ${look.badge}`} data-status={p.status}>
        <Icon name={look.icon} size={13} />
        {t.statuses[p.status]}
      </span>
    </Tooltip>
  )
}

function ProcessGoalCard({ p, kind, onEdit, onDelete }: { p: ProcessGoalProgress; kind: ProcessPeriodKind; onEdit: () => void; onDelete: () => Promise<void> }) {
  const t = useT().processGoals
  const [confirming, setConfirming] = useState(false)
  const label = t.metrics[p.goal.metric]
  const sentence = goalSentence(t, p.goal.metric, p.goal.target)
  const href = tradesHref(p.tradeIds)
  const ratio = ratioText(t, p)
  return (
    <li className="glass-card flex flex-col gap-3 px-6 py-5" aria-label={sentence} data-metric={p.goal.metric}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="caption">{label}</p>
          <h3 className="mt-0.5 text-[15px] font-semibold">{sentence}</h3>
          <p className="mt-0.5 max-w-[62ch] text-xs text-tx3">{t.help[p.goal.metric]}</p>
        </div>
        <ProcessStatusBadge p={p} />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
        <p className="text-sm text-tx2">
          {t.actual}{'\u00a0'}: <strong className="text-[17px] text-tx tabular-nums">{valueText(t, p)}</strong>
        </p>
        <p className="text-sm text-tx2">
          {p.direction === 'atMost' ? t.ceiling : t.floor}{'\u00a0'}: <strong className="text-[17px] text-tx tabular-nums">{targetText(t, p.goal.metric, p.goal.target)}</strong>
        </p>
        {p.goal.metric !== 'journal_days' && <p className="text-xs text-tx3">{t.tradeCount(p.tradeCount)}</p>}
      </div>
      {ratio && <p className="text-[13px] text-tx2 tabular-nums">{ratio}</p>}
      {p.status === 'noData' && <p className="text-[13px] text-tx2">{t.noData[p.goal.metric]}</p>}
      {p.requiredSetting && (
        <div className="nt nt-warn items-center justify-between" role="status">
          <span>{t.settingRequired[p.requiredSetting]}</span>
          <Link to="/settings#behavior-settings-title" className="btn btn-secondary btn-sm whitespace-nowrap">{t.openSettings}</Link>
        </div>
      )}
      {p.goal.metric === 'overtrading_days' && p.days.length > 0 && <p className="text-[13px] text-tx2 tabular-nums">{t.days(p.days.map(shortDay).join(', '))}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <span className="flex flex-wrap items-center gap-4">
          {p.streak > 0 && (
            <Tooltip content={t.streakHelp(kind)}>
              <span className="inline-flex items-center gap-1.5 font-semibold text-tx-accent" data-streak={p.streak}>
                <Icon name="star" size={14} />
                {t.streak(p.streak, kind)}
              </span>
            </Tooltip>
          )}
          {href && <Link to={href} className="btn-link">{t.seeTrades(p.tradeIds.length)}</Link>}
        </span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-tx2">{t.deleteConfirm}</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void onDelete()}>{t.deleteYes}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>{t.cancel}</button>
          </span>
        ) : (
          <span className="flex items-center gap-3">
            <button type="button" className="btn-link" aria-label={t.editLabel(sentence)} onClick={onEdit}>{t.edit}</button>
            <button type="button" className="btn-link !text-loss" aria-label={t.deleteLabel(sentence)} onClick={() => setConfirming(true)}>{t.delete}</button>
          </span>
        )}
      </div>
    </li>
  )
}

/** « 2026-09-15 » → « 15/09 ». */
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

/**
 * Vue « Comportement » de la page Objectifs (lot 34) : objectifs de processus par semaine ou par mois.
 * Valeurs, statuts et séries viennent de pulse-core ; la vue formate, navigue et enregistre.
 */
export function ProcessGoals({ initialKind = 'week' }: { initialKind?: ProcessPeriodKind }) {
  const t = useT().processGoals
  const { accounts, loading, selectedId } = useAccounts()
  const [kind, setKind] = useState<ProcessPeriodKind>(initialKind)
  const [key, setKey] = useState(() => currentPeriodKey(initialKind, Date.now(), localTzOffsetMin()))
  const [data, setData] = useState<ProcessProgress | null>(null)
  const [previousGoals, setPreviousGoals] = useState<ProcessGoal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ editing: ProcessGoal | null } | null>(null)

  const chosen = useMemo(() => (selectedId === null ? accounts : accounts.filter((a) => a.id === selectedId)), [accounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixed = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0 && !mixed
  const current = currentPeriodKey(kind, Date.now(), localTzOffsetMin())
  const title = periodTitle(t, kind, key)
  const titleText = title.range ? `${title.title}, ${title.range}` : title.title

  const load = useCallback(async () => {
    const tz = localTzOffsetMin()
    try {
      const progress = await api.getProcessGoalProgress({
        accountIds, periodKind: kind, periodKey: key, nowMs: Date.now(), tzOffsetMin: tz, boundaryOffsets: boundaryOffsets(kind, key, tz),
      })
      setData(progress)
      setPreviousGoals(await api.listProcessGoals(kind, progress.period.previousKey))
      setError(null)
    } catch (e) {
      setError(t.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [accountIds, kind, key, t])

  useEffect(() => {
    if (!ready) return
    setData(null)
    void load()
  }, [ready, load])

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setActionError(t.saveError(String(err instanceof Error ? err.message : err)))
    }
  }

  const switchKind = (k: ProcessPeriodKind) => {
    setKind(k)
    setKey(currentPeriodKey(k, Date.now(), localTzOffsetMin()))
  }
  const missingSettings: RequiredSetting[] = data
    ? [...(data.maxTradesPerDay === null ? ['maxTradesPerDay' as const] : []), ...(data.maxRiskPercent === null ? ['maxRiskPercent' as const] : [])]
    : []
  const state = data?.period.state
  const stateText = state ? (kind === 'week' ? t.periodState[state] : t.periodStateMonth[state]) : null

  return (
    <div className="flex flex-col gap-5" data-testid="process-goals">
      <p className="max-w-[80ch] text-sm text-tx2">{t.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-[220px]">
          <Segmented<ProcessPeriodKind> label={t.kindLabel} value={kind} onChange={(v) => v && switchKind(v)} options={[{ value: 'week', label: t.kinds.week }, { value: 'month', label: t.kinds.month }]} />
        </div>
        <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={t.previous[kind]} onClick={() => data && setKey(data.period.previousKey)} disabled={!data}>
          <Icon name="left" size={16} />
        </button>
        <div className="min-w-[230px] text-center" aria-live="polite">
          <p className="text-[17px] font-semibold">{title.title}</p>
          {title.range && <p className="text-xs text-tx3">{title.range}</p>}
        </div>
        <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={t.next[kind]} onClick={() => data && setKey(data.period.nextKey)} disabled={!data}>
          <Icon name="right" size={16} />
        </button>
        {stateText && <span className="badge badge-neutral">{stateText}</span>}
        {key !== current && (
          <button type="button" className="btn-link" onClick={() => setKey(current)}>{t.backToCurrent[kind]}</button>
        )}
        <span className="flex-1" />
        {data && data.goals.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ editing: null })}>
            <Icon name="plus" size={18} /> {t.add}
          </button>
        )}
      </div>

      {mixed && <div className="nt nt-warn" role="status">{t.mixedCurrencies}</div>}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      {actionError && <div className="nt nt-bad" role="alert">{actionError}</div>}
      {ready && !data && !error && <p className="text-sm text-tx3">{t.loading}</p>}

      {data && data.goals.length === 0 && (
        <section className="glass-card" aria-label={titleText}>
          <EmptyState icon="goals" title={key === current ? t.empty.title[kind] : t.empty.titleOther[kind]}>
            {t.empty.text}
          </EmptyState>
          <div className="flex flex-col gap-3 px-6 pb-8">
            <h3 className="caption text-center">{t.empty.templatesTitle}</h3>
            <ul className="mx-auto grid w-full max-w-[860px] grid-cols-3 gap-3">
              {processTemplates(kind).map((tpl) => {
                const sentence = goalSentence(t, tpl.metric, tpl.target)
                return (
                  <li key={tpl.metric} className="flex flex-col justify-between gap-3 rounded-inner p-4" style={{ background: 'var(--control)', border: '1px solid var(--glass-border)' }}>
                    <div>
                      <p className="text-sm font-semibold">{sentence}</p>
                      <p className="mt-1 text-xs text-tx3">{t.help[tpl.metric]}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm self-start"
                      aria-label={t.empty.createLabel(sentence)}
                      onClick={() => void run(() => api.setProcessGoal({ periodKind: kind, periodKey: key, metric: tpl.metric, target: tpl.target }))}
                    >
                      <Icon name="plus" size={16} /> {t.empty.create}
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap justify-center gap-3">
              {previousGoals.length > 0 && (
                <button type="button" className="btn btn-secondary" onClick={() => void run(() => api.copyProcessGoals(kind, key))}>
                  {t.copy(t.copyLabel[kind])}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ editing: null })}>{t.empty.custom}</button>
            </div>
          </div>
        </section>
      )}

      {data && data.goals.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-4" aria-label={titleText}>
            {data.goals.map((p) => (
              <ProcessGoalCard
                key={p.goal.id}
                p={p}
                kind={kind}
                onEdit={() => setDialog({ editing: p.goal })}
                onDelete={() => run(() => api.deleteProcessGoal(p.goal.id))}
              />
            ))}
          </ul>
          {previousGoals.some((g) => !data.goals.some((x) => x.goal.metric === g.metric)) && (
            <button type="button" className="btn-link self-start" onClick={() => void run(() => api.copyProcessGoals(kind, key))}>
              {t.copy(t.copyLabel[kind])}
            </button>
          )}
        </>
      )}
      <p className="max-w-[90ch] text-xs text-tx3">{t.closedNote}</p>

      {dialog && (
        <ProcessGoalDialog
          kind={kind}
          periodKey={key}
          periodLabel={titleText}
          editing={dialog.editing}
          existing={data?.goals.map((g) => g.goal.metric) ?? []}
          missingSettings={missingSettings}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
