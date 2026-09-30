import { useState, type FormEvent, type ReactNode } from 'react'
import { Select } from './ui/Select'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { IDLE_CHOICES, lockErrorText, newPasswordError } from '../lib/lockView'
import { Icon } from './Icon'
import { Field, Notice } from './ui'

type Result = { tone: 'ok' | 'bad'; text: string; extra?: string } | null

/** Champ de mot de passe masqué (jamais pré-rempli, jamais proposé à l'enregistrement). */
function PasswordInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      id={id}
      type="password"
      autoComplete="off"
      spellCheck={false}
      className="control h-[42px] w-full px-3.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  )
}

function InnerBlock({ title, children, tone }: { title: string; children: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-inner border p-4" style={{ background: 'rgba(255,255,255,.04)', borderColor: 'var(--hairline)' }}>
      <div className={`caption mb-1.5 ${tone === 'ok' ? '!text-gain' : tone === 'warn' ? '!text-warn' : ''}`}>{title}</div>
      <p className="text-[13px] leading-relaxed text-tx2">{children}</p>
    </div>
  )
}

/** Paramètres > Sécurité (lot 22) : activer, verrouiller, inactivité, changer, désactiver. */
export function SecurityPanel() {
  const t = useT()
  const s = t.lock.settings
  const { status, setStatus } = useLock()
  const [mode, setMode] = useState<'none' | 'enable' | 'change' | 'disable'>('none')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [current, setCurrent] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [encryptCopies, setEncryptCopies] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  if (!status) return null
  const min = status.minPasswordChars
  const copies = status.plainCopies.length

  function clear() {
    setPw('')
    setPw2('')
    setCurrent('')
    setUnderstood(false)
    setFormError(null)
  }

  function open(next: typeof mode) {
    clear()
    setResult(null)
    setEncryptCopies(true)
    setMode(next)
  }

  async function run(action: () => Promise<Result>) {
    setBusy(true)
    setResult(null)
    setFormError(null)
    try {
      const r = await action()
      setMode('none')
      setResult(r)
    } catch (e) {
      setFormError(lockErrorText(t, e, min))
    } finally {
      clear()
      setBusy(false)
    }
  }

  function submitEnable(e: FormEvent) {
    e.preventDefault()
    const err = newPasswordError(t, pw, pw2, min)
    if (err) return setFormError(err)
    if (!understood) return setFormError(t.lock.errors.notConfirmed)
    const [p, withCopies] = [pw, copies > 0 && encryptCopies]
    void run(async () => {
      setStatus(await api.enableLock(p, true, withCopies))
      return { tone: 'ok', text: s.enabled, extra: s.oldBackups }
    })
  }

  function submitChange(e: FormEvent) {
    e.preventDefault()
    if (!current) return setFormError(t.lock.errors.empty)
    const err = newPasswordError(t, pw, pw2, min)
    if (err) return setFormError(err)
    const [old, next] = [current, pw]
    void run(async () => {
      setStatus(await api.changeLockPassword(old, next))
      return { tone: 'ok', text: s.changed }
    })
  }

  function submitDisable(e: FormEvent) {
    e.preventDefault()
    if (!current) return setFormError(t.lock.errors.empty)
    const p = current
    void run(async () => {
      setStatus(await api.disableLock(p))
      return { tone: 'ok', text: s.disabled }
    })
  }

  async function lockNow() {
    try {
      setStatus(await api.lockNow())
    } catch (e) {
      setResult({ tone: 'bad', text: lockErrorText(t, e, min) })
    }
  }

  async function setIdle(value: string) {
    try {
      setStatus(await api.setLockIdle(value === '' ? null : Number(value)))
      setResult({ tone: 'ok', text: s.idleSaved })
    } catch (e) {
      setResult({ tone: 'bad', text: lockErrorText(t, e, min) })
    }
  }

  const idleChoices = status.idleMinutes !== null && !IDLE_CHOICES.includes(status.idleMinutes) ? [...IDLE_CHOICES, status.idleMinutes] : IDLE_CHOICES
  const cancel = (
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => open('none')}>
      {s.cancel}
    </button>
  )
  const errorBox = formError && (
    <div role="alert">
      <Notice level="bad">{formError}</Notice>
    </div>
  )

  return (
    <section id="securite" className="glass-card scroll-mt-6 p-6" aria-labelledby="security-title" data-testid="security-panel">
      <div className="mb-4 flex items-start justify-between gap-6">
        <div>
          <h2 id="security-title" className="mb-1 flex items-center gap-2 text-base font-semibold">
            <Icon name="lock" size={18} />
            {s.title}
          </h2>
          <p className="max-w-[78ch] text-sm text-tx3">{s.intro}</p>
        </div>
        <span className={`badge shrink-0 ${status.enabled ? 'badge-gain' : 'badge-neutral'}`}>{status.enabled ? s.on : s.off}</span>
      </div>

      {status.warning && (
        <div className="mb-4">
          <Notice level="warn">{lockErrorText(t, status.warning)}</Notice>
        </div>
      )}
      <p className="mb-4 text-sm">{status.enabled ? s.onState : s.offState}</p>
      <div className="mb-5 grid grid-cols-2 gap-3">
        <InnerBlock title={s.protectsTitle} tone="ok">{s.protects}</InnerBlock>
        <InnerBlock title={s.notProtectsTitle} tone="warn">{s.notProtects}</InnerBlock>
      </div>
      {api.isBrowserPreview && (
        <p className="mb-4 flex items-center gap-2 text-xs text-tx3">
          <span className="badge badge-warn shrink-0 whitespace-nowrap">{t.ai.settings.simulation}</span>
          {s.simulation}
        </p>
      )}

      {!status.enabled && mode !== 'enable' && (
        <button className="btn btn-primary" onClick={() => open('enable')} data-testid="enable-lock">
          {s.enableButton}
        </button>
      )}

      {!status.enabled && mode === 'enable' && (
        <form onSubmit={submitEnable} className="flex flex-col gap-4 border-t pt-5" style={{ borderColor: 'var(--hairline)' }} aria-labelledby="enable-title" noValidate>
          <h4 id="enable-title" className="text-[15px] font-semibold">{s.enableTitle}</h4>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={s.newPassword} htmlFor="lock-new">
              <PasswordInput id="lock-new" value={pw} onChange={setPw} disabled={busy} />
            </Field>
            <Field label={s.confirmPassword} htmlFor="lock-new2">
              <PasswordInput id="lock-new2" value={pw2} onChange={setPw2} disabled={busy} />
            </Field>
          </div>
          <p className="max-w-[78ch] text-[13px] leading-relaxed text-tx3">{s.policy(min)}</p>
          {copies > 0 && (
            <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet" checked={encryptCopies} onChange={(e) => setEncryptCopies(e.target.checked)} disabled={busy} />
              <span>{s.copies(copies)}</span>
            </label>
          )}
          <div className="nt nt-bad" role="note" data-testid="lost-warning">
            <span className="mt-px shrink-0">
              <Icon name="alert" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{s.lostTitle}</div>
              <p className="mt-1 leading-relaxed">{s.lostBody}</p>
              <label className="mt-3 flex items-start gap-2.5 font-medium text-tx">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} disabled={busy} data-testid="lock-understood" />
                <span>{s.understood}</span>
              </label>
            </div>
          </div>
          {errorBox}
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy || !understood}>
              {busy ? s.enabling : s.enableSubmit}
            </button>
            {cancel}
          </div>
        </form>
      )}

      {status.enabled && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-6 border-t pt-5" style={{ borderColor: 'var(--hairline)' }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.idleTitle}</div>
              <p className="mt-1 max-w-[62ch] text-[13px] text-tx3">{s.idleHelp}</p>
            </div>
            <Field label={s.idleLabel} htmlFor="lock-idle" className="w-[220px]">
              <Select
                id="lock-idle"
                value={status.idleMinutes === null || status.idleMinutes === undefined ? '' : String(status.idleMinutes)}
                onChange={(v) => void setIdle(v)}
                options={idleChoices.map((m) => ({ value: m === null ? '' : String(m), label: m === null ? s.idleNever : s.idleMinutes(m) }))}
              />
            </Field>
            <button className="btn btn-secondary" onClick={() => void lockNow()} data-testid="lock-now">
              <Icon name="lock" size={16} />
              {s.lockNow}
            </button>
          </div>

          {copies > 0 && <Notice level="warn">{s.copiesLeft(copies)}</Notice>}

          {mode === 'none' && (
            <div className="flex flex-wrap gap-3" role="group" aria-label={s.tabsLabel}>
              <button className="btn btn-secondary" onClick={() => open('change')}>{s.changeTitle}</button>
              <button className="btn btn-danger" onClick={() => open('disable')}>{s.disableTitle}</button>
            </div>
          )}

          {mode === 'change' && (
            <form onSubmit={submitChange} className="flex flex-col gap-4" aria-labelledby="change-title" noValidate>
              <h4 id="change-title" className="text-[15px] font-semibold">{s.changeTitle}</h4>
              <div className="grid grid-cols-3 gap-3.5">
                <Field label={s.currentPassword} htmlFor="lock-current">
                  <PasswordInput id="lock-current" value={current} onChange={setCurrent} disabled={busy} />
                </Field>
                <Field label={s.newPasswordChange} htmlFor="lock-new">
                  <PasswordInput id="lock-new" value={pw} onChange={setPw} disabled={busy} />
                </Field>
                <Field label={s.confirmNewPassword} htmlFor="lock-new2">
                  <PasswordInput id="lock-new2" value={pw2} onChange={setPw2} disabled={busy} />
                </Field>
              </div>
              <p className="max-w-[78ch] text-[13px] leading-relaxed text-tx3">{s.policy(min)}</p>
              <p className="max-w-[78ch] text-[13px] leading-relaxed text-tx3">{s.changeNote}</p>
              {errorBox}
              <div className="flex gap-3">
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? s.changing : s.changeSubmit}</button>
                {cancel}
              </div>
            </form>
          )}

          {mode === 'disable' && (
            <form onSubmit={submitDisable} className="flex flex-col gap-4" aria-labelledby="disable-title" noValidate>
              <h4 id="disable-title" className="text-[15px] font-semibold">{s.disableTitle}</h4>
              <p className="max-w-[78ch] text-[13px] leading-relaxed text-tx2">{s.disableHelp}</p>
              <Field label={s.currentPassword} htmlFor="lock-current" className="max-w-[360px]">
                <PasswordInput id="lock-current" value={current} onChange={setCurrent} disabled={busy} />
              </Field>
              {errorBox}
              <div className="flex gap-3">
                <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? s.disabling : s.disableSubmit}</button>
                {cancel}
              </div>
            </form>
          )}

          <p className="text-[13px] text-tx3">{s.exportNote}</p>
        </div>
      )}

      {result && (
        <div className="mt-5">
          <Notice level={result.tone === 'ok' ? 'ok' : 'bad'}>
            {result.text}
            {result.extra && <p className="mt-1 text-[13px]">{result.extra}</p>}
          </Notice>
        </div>
      )}
    </section>
  )
}
