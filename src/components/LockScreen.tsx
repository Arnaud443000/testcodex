import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useLock } from '../lib/lock'
import { lockErrorText, retryDelay } from '../lib/lockView'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { Field, Notice } from './ui'

/**
 * Écran de déverrouillage (lot 22) : affiché à la place de toute l'application tant que la base
 * chiffrée n'est pas ouverte. Le champ est vidé à chaque envoi ; rien n'est gardé côté interface.
 */
export function LockScreen() {
  const t = useT()
  const l = t.lock.screen
  const { status, setStatus } = useLock()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [until, setUntil] = useState(() => Date.now() + (status?.retryAfterMs ?? 0))
  const [, tick] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(id)
  }, [])
  const remaining = Math.max(0, until - Date.now())
  const waiting = remaining > 0

  useEffect(() => {
    if (!busy && !waiting) input.current?.focus()
  }, [busy, waiting])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || waiting) return
    if (!password) return setError(t.lock.errors.empty)
    const typed = password
    setPassword('')
    setBusy(true)
    setError(null)
    try {
      setStatus(await api.unlockDatabase(typed))
    } catch (err) {
      setError(lockErrorText(t, err, status?.minPasswordChars))
      const fresh = await api.getLockStatus().catch(() => null)
      if (fresh) setStatus(fresh)
      const wait = retryDelay(err) ?? fresh?.retryAfterMs ?? 0
      setUntil(Date.now() + wait)
    } finally {
      setBusy(false)
    }
  }

  const failures = status?.failures ?? 0
  return (
    <div className="app-shell flex h-full items-center justify-center overflow-y-auto px-6 py-10">
      <main className="glass-card w-full max-w-[460px] px-8 py-9" aria-labelledby="lock-title" data-testid="lock-screen">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <span className="text-[26px] font-light leading-none tracking-tight">Pulse</span>
        </div>
        <div className="mb-2 flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: 'linear-gradient(135deg,rgba(74,95,217,.45),rgba(139,127,232,.35))' }} aria-hidden="true">
            <Icon name="lock" size={18} />
          </span>
          <h1 id="lock-title" className="text-[28px] font-semibold tracking-[-0.02em]">{l.title}</h1>
        </div>
        <p className="mb-7 text-[15px] leading-relaxed text-tx2">{l.intro}</p>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={l.passwordLabel} htmlFor="lock-password">
            <div className="relative">
              <input
                ref={input}
                id="lock-password"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                className="control h-[42px] w-full px-3.5 pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || waiting}
                aria-invalid={error !== null}
                aria-describedby={error ? 'lock-error' : undefined}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-1 grid w-10 place-items-center rounded-md text-tx3 hover:text-tx focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
                aria-label={show ? l.hide : l.show}
                aria-pressed={show}
                onClick={() => setShow((s) => !s)}
              >
                <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
          </Field>

          {error && (
            <div id="lock-error">
              <Notice level="bad">{error}</Notice>
            </div>
          )}
          {waiting && !error && <Notice level="warn">{l.waiting(t.lock.wait(remaining))}</Notice>}

          <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy || waiting}>
            {busy ? l.submitting : waiting ? l.waiting(t.lock.wait(remaining)) : l.submit}
          </button>
        </form>

        {failures > 0 && <p className="mt-4 text-[13px] leading-relaxed text-tx2">{l.failures(failures)}</p>}
        {status?.warning && (
          <div className="mt-4">
            <Notice level="warn">{lockErrorText(t, status.warning)}</Notice>
          </div>
        )}
        <p className="mt-6 border-t pt-4 text-[13px] leading-relaxed text-tx3" style={{ borderColor: 'var(--hairline)' }}>
          {l.lost}
        </p>
        {api.isBrowserPreview && (
          <p className="mt-3 flex items-center gap-2 text-xs text-tx3">
            <span className="badge badge-warn shrink-0 whitespace-nowrap">{t.ai.settings.simulation}</span>
            {l.simulation}
          </p>
        )}
      </main>
    </div>
  )
}

/** Pendant la toute première lecture de l'état du verrou (quelques millisecondes). */
export function LockSplash() {
  const t = useT()
  return (
    <div className="app-shell grid h-full place-items-center" role="status">
      <div className="flex items-center gap-3 text-tx2">
        <Logo />
        <span className="text-sm">{t.lock.screen.loading}</span>
      </div>
    </div>
  )
}
