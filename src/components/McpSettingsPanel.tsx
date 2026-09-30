import { useEffect, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api, notifyMcpChanged } from '../lib/api'
import { useAccounts } from '../lib/accounts'
import { formatDateTime } from '../lib/format'
import { enableBlocker, formChanged, formFromSettings, mcpErrorMessage, mixedCurrencies, paramsSummary, toggleAccount } from '../lib/mcpView'
import type { McpCall, McpDuration, McpInstallCommand, McpSettingsUpdate, McpStatus } from '../types/mcp'
import { Checkbox } from './ui/Checkbox'
import { Select } from './ui/Select'
import { Tooltip } from './ui/Tooltip'
import { Notice, Switch } from './ui'

function SimulationTag() {
  const t = useT().mcp
  return <span className="badge badge-warn">{t.simulation}</span>
}

/** Une commande à copier, sur une ligne défilante (jamais de défilement de la page). */
function CommandLine({ text, testId }: { text: string; testId: string }) {
  return (
    <code
      data-testid={testId}
      className="pop-scroll block max-w-full select-all overflow-x-auto whitespace-pre rounded-[10px] border px-3.5 py-2.5 font-mono text-[12.5px] text-tx"
      style={{ borderColor: 'var(--hairline)', background: 'rgba(0,0,0,.25)' }}
    >
      {text}
    </code>
  )
}

function InstallBlock() {
  const t = useT().mcp
  const [cmd, setCmd] = useState<McpInstallCommand | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    api.getMcpInstallCommand().then(setCmd).catch((e) => setError(mcpErrorMessage(e, t)))
  }, [t])
  const copy = async () => {
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd.add)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  return (
    <div className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: 'var(--hairline)' }} data-testid="mcp-install">
      <h3 className="flex flex-wrap items-center gap-3 text-sm font-semibold">
        {t.installTitle}
        {api.isBrowserPreview && <SimulationTag />}
      </h3>
      {error && <Notice level="bad">{error}</Notice>}
      {cmd && (
        <>
          {!cmd.exeFound && <Notice level="warn">{t.exeMissing(cmd.exePath)}</Notice>}
          <p className="text-[13px] text-tx2">{t.installStep1}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 basis-[420px]">
              <CommandLine text={cmd.add} testId="mcp-command" />
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
              {t.copy}
            </button>
          </div>
          {copyState && <p className={`text-[12.5px] ${copyState === 'copied' ? 'text-tx2' : 'text-warn'}`} role="status">{copyState === 'copied' ? t.copied : t.copyFailed}</p>}
          <p className="max-w-[95ch] text-[12.5px] leading-relaxed text-tx3">
            <code className="font-mono text-tx2">{t.scopeFlag}</code> {t.scopeNote}
            {cmd.withDataDir && (
              <>
                {' '}
                <code className="font-mono text-tx2">{t.dataDirFlag}</code> {t.dataDirNote}
              </>
            )}
          </p>
          <p className="max-w-[95ch] text-[13px] text-tx2">{t.installStep2}</p>
          <CommandLine text={cmd.list} testId="mcp-command-list" />
          <p className="max-w-[95ch] text-[13px] text-tx2">{t.installStep3}</p>
          <p className="text-[13px] text-tx2">{t.removeTitle}</p>
          <CommandLine text={cmd.remove} testId="mcp-command-remove" />
          <p className="text-[12.5px] text-tx3">{t.onlyClaudeCode}</p>
        </>
      )}
    </div>
  )
}

function CallRow({ call }: { call: McpCall }) {
  const t = useT().mcp
  const [open, setOpen] = useState(false)
  const label = t.toolLabels[call.tool]
  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="grid grid-cols-[150px_minmax(0,1.1fr)_minmax(0,1.6fr)_70px_180px] items-center gap-3 text-[13px]">
        <span className="tabular-nums text-tx2">{formatDateTime(call.at)}</span>
        <span className="min-w-0 truncate">
          <span className="font-medium text-tx">{label ?? call.tool}</span>
          {label && <span className="ml-2 font-mono text-[11.5px] text-tx3">{call.tool}</span>}
          {call.isError && <span className="badge badge-warn ml-2 !px-2 !py-0.5">{t.error}</span>}
        </span>
        <Tooltip content={call.params.length > 80 ? call.params : undefined}>
          <span className="min-w-0 truncate font-mono text-[12px] text-tx2">{paramsSummary(call.params, t.noParams)}</span>
        </Tooltip>
        <span className="tabular-nums text-tx3">{t.bytes(call.size)}</span>
        <button type="button" className="btn-link justify-self-end" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.hideResult : t.showResult}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1">
          <span className="caption">{t.resultLabel} · {t.duration(call.durationMs)}</span>
          <pre
            className="pop-scroll max-h-[280px] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border px-3.5 py-2.5 font-mono text-[12px] text-tx2"
            style={{ borderColor: 'var(--hairline)', background: 'rgba(0,0,0,.25)' }}
          >
            {call.result}
          </pre>
        </div>
      )}
    </li>
  )
}

function CallLog({ active, refreshKey, onChanged }: { active: boolean; refreshKey: number; onChanged: () => void }) {
  const t = useT().mcp
  const [calls, setCalls] = useState<McpCall[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const reload = () => api.listMcpCalls().then(setCalls).catch((e) => setError(mcpErrorMessage(e, t)))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  const clear = async () => {
    setConfirm(false)
    try {
      setMessage(t.cleared(await api.clearMcpCalls()))
      await reload()
      onChanged()
    } catch (e) {
      setError(mcpErrorMessage(e, t))
    }
  }
  const simulate = async () => {
    setError(null)
    try {
      await api.simulateMcpCall('period_summary', { period: '1S' })
      await reload()
      onChanged()
    } catch (e) {
      setError(mcpErrorMessage(e, t))
    }
  }
  return (
    <div className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: 'var(--hairline)' }} data-testid="mcp-log">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t.logTitle}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {api.isBrowserPreview && active && (
            <Tooltip content={t.simulateHint}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void simulate()}>
                {t.simulate}
              </button>
            </Tooltip>
          )}
          {calls && calls.length > 0 && !confirm && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(true)}>
              {t.clear}
            </button>
          )}
        </div>
      </div>
      <p className="max-w-[95ch] text-[12.5px] leading-relaxed text-tx3">{t.logIntro}</p>
      {confirm && calls && (
        <Notice
          level="warn"
          actions={
            <>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void clear()}>{t.clearYes}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(false)}>{t.cancel}</button>
            </>
          }
        >
          {t.clearConfirm(calls.length)}
        </Notice>
      )}
      {error && <Notice level="bad">{error}</Notice>}
      {message && <Notice level="ok">{message}</Notice>}
      {calls === null ? null : calls.length === 0 ? (
        <p className="rounded-[12px] border border-dashed px-4 py-5 text-center text-[13px] text-tx3" style={{ borderColor: 'var(--hairline)' }}>
          {t.logEmpty}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[150px_minmax(0,1.1fr)_minmax(0,1.6fr)_70px_180px] gap-3 text-[11.5px] uppercase tracking-wide text-tx3" aria-hidden="true">
            <span>{t.colDate}</span>
            <span>{t.colTool}</span>
            <span>{t.colParams}</span>
            <span>{t.colSize}</span>
            <span />
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }} aria-label={t.logCount(calls.length)}>
            {calls.map((c) => (
              <CallRow key={c.id} call={c} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Paramètres > « Accès MCP (Claude Code) » (lot 37, ancre `/settings#mcp`) : explication, consentement, comptes
 * exposés, durée, démarrage, état, installation guidée, journal « Données envoyées ». pulse-core revalide tout.
 */
export function McpSettingsPanel() {
  const t = useT()
  const m = t.mcp
  const { accounts } = useAccounts()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [form, setForm] = useState<McpSettingsUpdate | null>(null)
  const [consent, setConsent] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'enable' | 'stop' | null>(null)
  const [logKey, setLogKey] = useState(0)
  const activeIds = accounts.map((a) => a.id)

  const load = () =>
    api
      .getMcpStatus()
      .then((st) => {
        setStatus(st)
        setForm((f) => f ?? formFromSettings(st.settings, activeIds))
      })
      .catch((e) => setLoadError(m.loadError(mcpErrorMessage(e, m))))
  useEffect(() => {
    void load()
    const off = api.onMcpChanged(() => void api.getMcpStatus().then(setStatus).catch(() => undefined))
    return () => void off.then((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loadError) return <section id="mcp" className="glass-card p-6"><div className="nt nt-bad" role="alert">{loadError}</div></section>
  if (!status || !form) return <section id="mcp" className="glass-card p-6" aria-busy="true"><h2 className="text-base font-semibold">{m.title}</h2></section>

  const act = async (kind: 'save' | 'enable' | 'stop', run: () => Promise<McpStatus>, done?: string) => {
    setError(null)
    setMessage(null)
    setBusy(kind)
    try {
      const st = await run()
      setStatus(st)
      setForm(formFromSettings(st.settings, activeIds))
      if (done) setMessage(done)
      notifyMcpChanged()
      setLogKey((k) => k + 1)
    } catch (e) {
      setError(mcpErrorMessage(e, m))
    } finally {
      setBusy(null)
    }
  }
  const dirty = formChanged(status.settings, form)
  const save = (e?: FormEvent) => {
    e?.preventDefault()
    void act('save', () => api.setMcpSettings(form), m.saved)
  }
  const enable = () =>
    void act(
      'enable',
      async () => {
        if (dirty) await api.setMcpSettings(form)
        return api.enableMcp(consent)
      },
      m.enabled,
    )
  const stop = () => void act('stop', () => api.disableMcp(false), m.stopped)
  const withdraw = () => void act('stop', () => api.disableMcp(true), m.withdrawn)
  const blocker = enableBlocker(status, consent, form)
  const hasConsent = status.settings.consentAt !== null

  return (
    <section id="mcp" className="glass-card flex flex-col gap-5 p-6" aria-labelledby="mcp-title" data-testid="mcp-panel">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="mcp-title" className="flex flex-wrap items-center gap-3 text-base font-semibold">
            {m.title}
            {api.isBrowserPreview && <SimulationTag />}
          </h2>
          <p className="mt-1 max-w-[85ch] text-[13px] leading-relaxed text-tx2">{m.what}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm text-tx2">{status.active ? m.on : m.off}</span>
          <Switch on={status.active} label={m.switchLabel} onChange={(on) => (on ? (blocker ? setError(m.cannotEnable[blocker]) : enable()) : stop())} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 text-[13px] leading-relaxed xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-tx2"><b className="text-tx">{m.whatTitle}</b> {m.notAi}</p>
          <p className="text-tx2">{m.leaves}</p>
          <p className="text-tx2">{m.readOnly} <b className="text-tx">{m.notAdvice}</b></p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-tx2"><b className="text-tx">{m.returnsTitle}</b> {m.returns}</p>
          <p className="text-tx2"><b className="text-tx">{m.neverTitle}</b> {m.never}</p>
        </div>
      </div>
      <Notice level="warn">{m.residualRisk}</Notice>

      {error && <Notice level="bad">{error}</Notice>}
      {message && <Notice level="ok">{message}</Notice>}

      <div className="flex flex-col gap-2" data-testid="mcp-consent">
        {hasConsent ? (
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-tx2">
            <span>{m.consentGiven(formatDateTime(status.settings.consentAt as number))}</span>
            <button type="button" className="btn-link" onClick={withdraw} disabled={busy !== null}>{m.withdraw}</button>
          </div>
        ) : (
          <Checkbox className="max-w-[95ch] leading-relaxed" align="start" checked={consent} onChange={setConsent} label={m.consentLabel} />
        )}
      </div>

      <form onSubmit={save} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="caption mb-2">{m.accountsTitle}</legend>
          <p className="text-[12.5px] text-tx3">{m.accountsHint}</p>
          {accounts.length === 0 ? (
            <p className="text-[13px] text-tx3">{m.noAccounts}</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1" data-testid="mcp-accounts">
              {accounts.map((a) => (
                <Checkbox
                  key={a.id}
                  checked={form.accountIds.includes(a.id)}
                  onChange={(v) => setForm({ ...form, accountIds: toggleAccount(form.accountIds, a.id, v) })}
                  label={`${a.name} (${a.currency})`}
                />
              ))}
            </div>
          )}
          {mixedCurrencies(accounts, form.accountIds) && <p className="text-[12.5px] text-tx3">{m.currencyNote}</p>}
        </fieldset>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <label className="flex flex-col gap-1.5">
            <span className="caption">{m.durationLabel}</span>
            <Select
              id="mcp-duration"
              className="min-w-[260px]"
              value={form.duration}
              onChange={(v) => setForm({ ...form, duration: v as McpDuration })}
              options={(['untilClose', '1h', '4h'] as const).map((d) => ({ value: d, label: m.durations[d] }))}
            />
          </label>
          <div className="max-w-[60ch]">
            <Checkbox checked={form.autostart} onChange={(v) => setForm({ ...form, autostart: v })} label={m.autostartLabel} description={m.autostartHint} align="start" />
          </div>
        </div>
        <p className="text-[12.5px] text-tx3">{m.durationHint}</p>
        <div>
          <button type="submit" className="btn btn-secondary" disabled={busy !== null || !dirty}>{busy === 'save' ? m.saving : m.save}</button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t pt-5 text-[13px] text-tx2" style={{ borderColor: 'var(--hairline)' }} data-testid="mcp-state">
        <h3 className="text-sm font-semibold text-tx">{m.stateTitle}</h3>
        {status.active ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="badge badge-gain">{m.on}</span>
              <span>{m.stateOn}</span>
            </p>
            <p>
              {status.startedAt !== null && m.since(formatDateTime(status.startedAt))} {status.expiresAt !== null ? m.until(formatDateTime(status.expiresAt)) : m.untilClose}
            </p>
            <p>
              {m.calls(status.calls)} {status.lastCallAt !== null && m.lastCall(formatDateTime(status.lastCallAt))}
              {status.refused > 0 && ` ${m.refused(status.refused)}`}
            </p>
            <p className="text-[12.5px] text-tx3">{m.newToken}</p>
            <div>
              <button type="button" className="btn btn-danger" onClick={stop} disabled={busy !== null}>{m.stop}</button>
            </div>
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="badge badge-neutral">{m.off}</span>
              <span>{m.stateOff}</span>
            </p>
            {status.lastStopReason && status.lastStopAt !== null && (
              <p className="text-[12.5px] text-tx3">{m.stoppedAt(m.stopReasons[status.lastStopReason], formatDateTime(status.lastStopAt))}</p>
            )}
            {blocker && <p className="text-[12.5px] text-warn">{m.cannotEnable[blocker]}</p>}
            <div>
              <button type="button" className="btn btn-primary" onClick={enable} disabled={busy !== null || blocker !== null}>
                {busy === 'enable' ? m.enabling : m.enable}
              </button>
            </div>
          </>
        )}
      </div>

      <InstallBlock />
      <CallLog active={status.active} refreshKey={logKey} onChanged={() => void api.getMcpStatus().then(setStatus)} />
    </section>
  )
}
