import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { api } from '../lib/api'
import {
  ALERT_DEFAULTS,
  DEFAULT_ALERT_FORM,
  formFromSettings,
  parseAlertForm,
  setEnabled,
  setValue,
  type AlertField,
  type AlertForm,
  type AlertFormErrors,
  type AlertKey,
} from '../lib/alertSettingsForm'
import { Switch } from './ui'

/**
 * Paramètres > Alertes (cahier 3.6.7) : tous les seuils, groupés par alerte. Les seuils communs avec le
 * score de discipline (trades par jour, définition de la revanche) passent par `set_behavior_settings`, les
 * autres par `set_alert_settings` ; pulse-core revalide tout et fait foi.
 */
export function AlertSettingsPanel() {
  const t = useT()
  const s = t.alertSettings
  const [form, setForm] = useState<AlertForm | null>(null)
  const [behavior, setBehavior] = useState<Awaited<ReturnType<typeof api.getBehaviorSettings>> | null>(null)
  const [errors, setErrors] = useState<AlertFormErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.getAlertSettings(), api.getBehaviorSettings()])
      .then(([alerts, b]) => {
        setBehavior(b)
        setForm(formFromSettings(alerts, b))
      })
      .catch((e) => setError(s.loadError(String(e instanceof Error ? e.message : e))))
  }, [s])

  const touch = (next: AlertForm, field?: AlertField) => {
    setForm(next)
    if (field) setErrors((e) => ({ ...e, [field]: undefined }))
    setMessage(null)
  }
  const toggle = (key: AlertKey, on: boolean) => {
    if (!form) return
    touch(setEnabled(form, key, on))
    setErrors({})
  }
  const change = (field: AlertField, value: string) => form && touch(setValue(form, field, value), field)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form || !behavior) return
    setError(null)
    setMessage(null)
    const parsed = parseAlertForm(form)
    if ('errors' in parsed) return setErrors(parsed.errors)
    setErrors({})
    setBusy(true)
    try {
      const { alerts, behavior: shared } = parsed.settings
      // La limite de trades par jour et la revanche sont enregistrées avec les autres seuils de discipline (risque max conservé).
      const savedBehavior = await api.setBehaviorSettings({ ...behavior, ...shared })
      const savedAlerts = await api.setAlertSettings(alerts)
      setBehavior(savedBehavior)
      setForm(formFromSettings(savedAlerts, savedBehavior))
      setMessage(s.saved)
    } catch (err) {
      setError(s.saveError(String(err instanceof Error ? err.message : err)))
      // Les réglages communs sont enregistrés en premier : en cas d'échec ensuite, on relit l'état réel.
      api.getBehaviorSettings().then(setBehavior).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const fieldsUi = (
    field: AlertField,
    label: string,
    unit: string,
    hint: string,
    opts: { inputMode?: 'decimal' | 'numeric' | 'text'; placeholder?: string; width?: string } = {},
  ) => {
    if (!form) return null
    const id = `as-${field}`
    const bad = errors[field]
    return (
      <div key={field} className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className="caption">{label}</label>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            id={id}
            className={`input tabular-nums ${bad ? '!border-loss' : ''}`}
            style={{ width: opts.width ?? '120px' }}
            inputMode={opts.inputMode ?? 'numeric'}
            value={form.values[field]}
            placeholder={opts.placeholder ?? '—'}
            aria-invalid={bad ? true : undefined}
            aria-describedby={`${id}-help`}
            onChange={(e) => change(field, e.target.value)}
          />
          {unit && <span className="text-sm text-tx2">{unit}</span>}
          <span className="text-xs text-tx3">{hint}</span>
        </div>
        {bad && <span className="text-xs text-[#F5A198]" role="alert">{s.errors[field]}</span>}
        <span id={`${id}-help`} className="sr-only">{s.errors[field]}</span>
      </div>
    )
  }

  /** Une alerte : interrupteur, explication en une phrase, champs, éventuelle mention « réglage commun ». */
  const card = (key: AlertKey, title: string, text: string, opts: { common?: boolean; body?: ReactNode; note?: string }) => {
    if (!form) return null
    const on = form.enabled[key]
    return (
      <div key={key} className="rounded-inner border p-5" style={{ borderColor: 'var(--hairline)', background: 'var(--control)' }} data-testid={`alert-${key}`}>
        <div className="flex flex-wrap items-center gap-3">
          <Switch on={on} onChange={(v) => toggle(key, v)} label={s.toggle(title)} />
          <h4 className="text-[15px] font-semibold">{title}</h4>
          <span className={`badge ${on ? 'badge-gain' : 'badge-neutral'}`}>{on ? s.on : s.off}</span>
          {opts.common && <span className="badge badge-warn">{s.commonBadge}</span>}
        </div>
        <p className="mt-2 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{text}</p>
        {opts.body && <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">{opts.body}</div>}
        {opts.note && <p className="mt-3 max-w-[80ch] text-xs leading-relaxed text-tx3">{opts.note}</p>}
      </div>
    )
  }

  const a = s.alerts
  const dflt = (v: string) => s.defaultIs(v)

  return (
    <section className="glass-card p-6" aria-labelledby="alert-settings-title" id="alertes">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="alert-settings-title" className="text-base font-semibold">{s.title}</h3>
        <Link to="/alerts" className="btn-link text-sm">{s.historyLink}</Link>
      </div>
      <p className="mb-4 max-w-[80ch] text-[13px] leading-relaxed text-tx2">{s.intro}</p>
      {form && (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {card('consecutiveLosses', a.consecutiveLosses.title, a.consecutiveLosses.text, {
            body: fieldsUi('consecutiveLosses', a.consecutiveLosses.field, s.unit.losses, `${dflt(ALERT_DEFAULTS.consecutiveLosses)} · ${s.emptyMeansOff}`),
            note: a.consecutiveLosses.rule,
          })}
          {card('tradesPerDay', a.tradesPerDay.title, a.tradesPerDay.text, {
            common: true,
            body: fieldsUi('maxTradesPerDay', a.tradesPerDay.field, s.unit.trades, `${s.defaultNone} · ${s.emptyMeansOff}`),
            note: s.commonNote,
          })}
          {card('tradesPerWindow', a.tradesPerWindow.title, a.tradesPerWindow.text, {
            body: (
              <>
                {fieldsUi('burstMaxTrades', a.tradesPerWindow.field, s.unit.trades, `${dflt(ALERT_DEFAULTS.burstMaxTrades)} · ${s.emptyMeansOff}`)}
                {fieldsUi('burstWindowMin', a.tradesPerWindow.window, s.unit.minutes, dflt(ALERT_DEFAULTS.burstWindowMin))}
              </>
            ),
            note: a.tradesPerWindow.rule,
          })}
          {card('dailyLoss', a.dailyLoss.title, a.dailyLoss.text, {
            body: (
              <>
                {fieldsUi('dailyLossPercent', a.dailyLoss.percent, s.unit.percent, `${dflt(`${ALERT_DEFAULTS.dailyLossPercent} %`)}`, { inputMode: 'decimal' })}
                {fieldsUi('dailyLossAmount', a.dailyLoss.amount, '', `${s.defaultNone}`, { inputMode: 'decimal', width: '160px' })}
              </>
            ),
            note: `${a.dailyLoss.rule} ${s.moneyNote}`,
          })}
          {card('weeklyLoss', a.weeklyLoss.title, a.weeklyLoss.text, {
            body: (
              <>
                {fieldsUi('weeklyLossPercent', a.weeklyLoss.percent, s.unit.percent, `${dflt(`${ALERT_DEFAULTS.weeklyLossPercent} %`)}`, { inputMode: 'decimal' })}
                {fieldsUi('weeklyLossAmount', a.weeklyLoss.amount, '', `${s.defaultNone}`, { inputMode: 'decimal', width: '160px' })}
              </>
            ),
            note: `${a.weeklyLoss.rule} ${s.moneyNote}`,
          })}
          {card('revenge', a.revenge.title, a.revenge.text, {
            common: true,
            body: (
              <>
                <div className="flex flex-col gap-1">
                  {fieldsUi('revengeWindowMin', a.revenge.window, s.unit.minutes, dflt(`${ALERT_DEFAULTS.revengeWindowMin} min`))}
                  <p className="text-xs leading-relaxed text-tx3">{a.revenge.windowText}</p>
                </div>
                <div className="flex flex-col gap-1">
                  {fieldsUi('revengeSizeFactor', a.revenge.factor, s.unit.factor, dflt(ALERT_DEFAULTS.revengeSizeFactor), { inputMode: 'decimal' })}
                  <p className="text-xs leading-relaxed text-tx3">{a.revenge.factorText}</p>
                </div>
              </>
            ),
            note: s.commonNote,
          })}
          {card('outsideHours', a.outsideHours.title, a.outsideHours.text, {
            body: (
              <>
                {fieldsUi('hoursStart', a.outsideHours.start, '', s.emptyMeansOff, { inputMode: 'text', placeholder: a.outsideHours.placeholder })}
                {fieldsUi('hoursEnd', a.outsideHours.end, '', s.defaultNone, { inputMode: 'text', placeholder: a.outsideHours.placeholder })}
              </>
            ),
            note: a.outsideHours.rule,
          })}
          {card('unusualSession', a.unusualSession.title, a.unusualSession.text, { note: a.unusualSession.fixed })}
          {card('noStopLoss', a.noStopLoss.title, a.noStopLoss.text, { note: a.noStopLoss.fixed })}

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={busy}>{s.save}</button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              title={s.resetHint}
              onClick={() => {
                setForm(DEFAULT_ALERT_FORM)
                setErrors({})
                setMessage(null)
              }}
            >
              {s.reset}
            </button>
            {Object.keys(errors).length > 0 && <span role="alert" className="text-sm text-[#F5A198]">{s.fixErrors}</span>}
            {message && <span role="status" className="text-sm text-[#9BE3C4]">{message}</span>}
          </div>
          <p className="text-xs text-tx3">{s.resetHint}</p>
        </form>
      )}
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
