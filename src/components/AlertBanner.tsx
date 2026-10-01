import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useAccounts } from '../lib/accounts'
import { alertMessage } from '../lib/alertFormat'
import { useAlertRules } from '../lib/alertRules'
import { localTzOffsetMin } from '../lib/period'
import type { Alert } from '../types/alerts'
import { AlertRules } from './AlertRules'
import { PausePicker } from './pause/PausePicker'
import { usePause } from '../lib/pause'
import { pauseReasonForAlert } from '../lib/pauseView'
import { Notice } from './ui'

/** Alertes affichées d'emblée ; les suivantes sont repliées. */
const FIRST = 2

/**
 * Garde-fous actifs (cahier 3.6), dans la coque, au même style que la bannière du rappel du journal.
 * Tout vient de pulse-core (`get_active_alerts`) : la bannière formate et permet de masquer une alerte
 * (elle ne revient pas ; une aggravation crée une nouvelle alerte). Vérifiée à l'ouverture, à chaque
 * changement de page (donc après l'enregistrement d'un trade), au retour sur la fenêtre et toutes les minutes.
 */
export function AlertBanner() {
  const t = useT()
  const a = t.alerts
  const location = useLocation()
  const { allAccounts } = useAccounts()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { current: pauseRunning } = usePause()
  const [pausingFor, setPausingFor] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const check = () =>
      api
        .getActiveAlerts([], localTzOffsetMin())
        .then((list) => live && setAlerts(list))
        .catch(() => live && setAlerts([]))
    void check()
    const timer = setInterval(check, 60_000)
    window.addEventListener('focus', check)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [location.pathname])

  const rulesOf = useAlertRules(alerts)

  const dismiss = useCallback(
    async (ids: string[]) => {
      setError(null)
      try {
        for (const id of ids) await api.dismissAlert(id)
        setAlerts((list) => list.filter((x) => !ids.includes(x.id)))
      } catch (e) {
        setError(a.dismissError(String(e)))
      }
    },
    [a],
  )

  if (alerts.length === 0) return null
  const critical = alerts.some((x) => x.severity === 'critical')
  const severalAccounts = new Set(alerts.map((x) => x.accountId)).size > 1 || allAccounts.filter((x) => !x.archived).length > 1
  const shown = expanded ? alerts : alerts.slice(0, FIRST)
  const hidden = alerts.length - shown.length
  const pausing = alerts.find((x) => x.id === pausingFor)

  return (
    <div className="mb-5">
      <Notice
        level={critical ? 'bad' : 'warn'}
        inline
        actions={
          <>
            {hidden > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(true)}>{a.showMore(hidden)}</button>
            )}
            {expanded && alerts.length > FIRST && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(false)}>{a.showLess}</button>
            )}
            {alerts.length > 1 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void dismiss(alerts.map((x) => x.id))}>{a.dismissAll}</button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <strong>{a.bannerTitle(alerts.length)}</strong>
          {location.pathname !== '/alerts' && (
            <Link to="/alerts" className="btn-link !text-[13px]">{t.alertHistory.bannerLink}</Link>
          )}
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {shown.map((x) => {
            const account = allAccounts.find((acc) => acc.id === x.accountId)
            const tradePath = x.tradeId !== null ? `/trades/${x.tradeId}` : null
            return (
              <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide">{a.severity[x.severity]}</span>
                <div className="min-w-0 flex-1">
                  {severalAccounts && account ? `${a.onAccount(account.name)} · ` : ''}
                  {alertMessage(t, x)}
                  <AlertRules texts={rulesOf(x)} />
                </div>
                <span className="flex gap-2">
                  {tradePath && location.pathname !== tradePath && (
                    <Link to={tradePath} className="btn btn-secondary btn-sm">{a.viewTrade}</Link>
                  )}
                  {pauseReasonForAlert(x) !== null && !pauseRunning && (
                    <button type="button" className="btn btn-secondary btn-sm" aria-expanded={pausingFor === x.id} onClick={() => setPausingFor(x.id)}>{t.pause.alert.button}</button>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void dismiss([x.id])}>{a.dismiss}</button>
                </span>
              </li>
            )
          })}
        </ul>
        {error && <p className="mt-2">{error}</p>}
      </Notice>
      {/* Lot 35 : le choix d'une pause est une carte à part, sous la bannière (dans le flux), jamais dans une ligne d'alerte. */}
      {pausing && !pauseRunning && (
        <section className="glass-card mt-4 p-5" aria-label={t.pause.picker.title}>
          <PausePicker reason={pauseReasonForAlert(pausing)} focusOnOpen onDone={() => setPausingFor(null)} onCancel={() => setPausingFor(null)} />
        </section>
      )}
    </div>
  )
}
