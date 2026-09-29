import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { alertMessage } from '../lib/alertFormat'
import { ALERT_KINDS, filterHistory } from '../lib/alertHistory'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { localTzOffsetMin, periodRange, usePeriod } from '../lib/period'
import type { AlertKind, AlertRecord } from '../types/alerts'

/** Nombre d'alertes chargées d'un coup (les plus récentes). */
const LIMIT = 500

/**
 * Historique des alertes (cahier 3.6) : le journal des alertes déclenchées, masquées ou non. Compte et période
 * viennent de la barre du haut (comme les autres pages) ; le type se choisit ici. Tout vient de pulse-core.
 */
export function AlertHistoryPage() {
  const t = useT()
  const h = t.alertHistory
  const { accounts, allAccounts, loading: accountsLoading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const [records, setRecords] = useState<AlertRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<AlertKind | null>(null)

  useEffect(() => {
    let live = true
    setRecords(null)
    api
      .getAlertHistory(selectedId === null ? [] : [selectedId], LIMIT)
      .then((r) => live && (setRecords(r), setError(null)))
      .catch((e) => live && setError(String(e instanceof Error ? e.message : e)))
    return () => {
      live = false
    }
  }, [selectedId])

  const shown = useMemo(() => {
    if (!records) return []
    return filterHistory(records, { ...periodRange(period, Date.now(), localTzOffsetMin()), kind })
  }, [records, period, kind])

  const account = selectedId === null ? h.allAccounts : (allAccounts.find((a) => a.id === selectedId)?.name ?? h.allAccounts)
  const showAccount = accounts.length > 1 && selectedId === null
  const header = (
    <PageHeader
      title={h.title}
      subtitle={h.subtitle(t.behavior.periodLabels[period], account)}
      actions={<Link to="/settings#alertes" className="btn btn-secondary">{h.settingsLink}</Link>}
    />
  )

  if (accountsLoading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={h.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{h.createAccount}</Link>}>
            {h.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="nt nt-bad" role="alert">{h.loadError(error)}</div>
      </div>
    )
  }

  const filtered = kind !== null || (records !== null && shown.length !== records.length)
  return (
    <div className="flex flex-col gap-5">
      {header}
      <section className="glass-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="caption">{h.typeFilter}</span>
            <span className="relative">
              <select className="input !h-[38px] min-w-[220px]" value={kind ?? ''} onChange={(e) => setKind((e.target.value || null) as AlertKind | null)}>
                <option value="" className="bg-bg">{h.allTypes}</option>
                {ALERT_KINDS.map((k) => (
                  <option key={k} value={k} className="bg-bg">{h.kinds[k]}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tx3"><Icon name="chevron" size={16} /></span>
            </span>
          </label>
          {kind !== null && (
            <button type="button" className="btn-link pb-2" onClick={() => setKind(null)}>{h.resetFilters}</button>
          )}
          {records && <span className="ml-auto pb-2 text-sm text-tx2" data-testid="history-count">{h.count(shown.length, records.length)}</span>}
        </div>
        {records && records.length >= LIMIT && <p className="mt-3 text-xs text-tx3">{h.truncated(LIMIT)}</p>}
      </section>

      {records && shown.length === 0 && (
        <section className="glass-card">
          <EmptyState title={filtered ? h.emptyFilteredTitle : h.emptyTitle}>{filtered ? h.emptyFilteredText : h.emptyText}</EmptyState>
        </section>
      )}

      {shown.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="history-list">
          {shown.map((r) => {
            const acc = allAccounts.find((a) => a.id === r.accountId)
            return (
              <li key={r.alertId} className="glass-card flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4">
                <div className="flex w-[150px] shrink-0 flex-col gap-1.5">
                  <span className={`badge ${r.severity === 'critical' ? 'badge-loss' : 'badge-warn'} w-fit`}>{t.alerts.severity[r.severity]}</span>
                  <span className="text-xs tabular-nums text-tx2">{formatDateTime(r.firstSeenAt)}</span>
                </div>
                <div className="min-w-[280px] flex-1">
                  <div className="text-sm font-semibold">
                    {h.kinds[r.kind]}
                    {showAccount && acc && <span className="ml-2 text-xs font-normal text-tx3">{t.alerts.onAccount(acc.name)}</span>}
                  </div>
                  <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{alertMessage(t, r.alert)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-xs text-tx3">{r.dismissedAt === null ? h.notDismissed : h.dismissedOn(formatDateTime(r.dismissedAt))}</span>
                  {r.tradeId !== null && <Link to={`/trades/${r.tradeId}`} className="btn btn-secondary btn-sm">{h.viewTrade}</Link>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
