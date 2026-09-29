import { useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useAccounts } from '../lib/accounts'
import { formatAmount } from '../lib/format'
import type { AccountKind, AppInfo } from '../types/account'

function AccountForm() {
  const { create } = useAccounts()
  const t = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('personal')
  const [broker, setBroker] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [capital, setCapital] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const capitalValue = capital.trim() === '' ? 0 : Number(capital.replace(',', '.'))
    if (!name.trim()) return setError(t.settings.errNameRequired)
    if (!Number.isFinite(capitalValue) || capitalValue < 0) return setError(t.settings.errCapital)
    setBusy(true)
    try {
      await create({ name, kind, broker, currency, initialCapital: capitalValue })
      setName('')
      setBroker('')
      setCapital('')
    } catch (err) {
      setError(t.settings.errSave(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  const field = 'flex min-w-0 flex-col gap-1.5'
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3.5">
        <label className={field}>
          <span className="caption">{t.settings.name}</span>
          <input id="acc-name" className="control h-[42px] px-3.5" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.settings.namePlaceholder} />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.type}</span>
          <select id="acc-kind" className="control h-[42px] px-3.5" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {Object.entries(t.settings.kinds).map(([k, l]) => (
              <option key={k} value={k} className="bg-bg">{l}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span className="caption">{t.settings.broker}</span>
          <input id="acc-broker" className="control h-[42px] px-3.5" value={broker} onChange={(e) => setBroker(e.target.value)} />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.currency}</span>
          <input id="acc-currency" className="control h-[42px] px-3.5" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.initialCapital}</span>
          <input id="acc-capital" className="control h-[42px] px-3.5" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} placeholder="10 000" />
        </label>
        <div className="flex items-end">
          <button className="btn btn-primary" disabled={busy} type="submit">{t.settings.add}</button>
        </div>
      </div>
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
    </form>
  )
}

export function SettingsPage() {
  const { accounts } = useAccounts()
  const t = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      <section className="glass-card p-6">
        <h3 className="mb-4 text-base font-semibold">{t.settings.accountsTitle}</h3>
        {accounts.length > 0 && (
          <ul className="mb-5 divide-y" style={{ borderColor: 'var(--hairline)' }}>
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-3 text-sm" style={{ borderColor: 'var(--hairline)' }}>
                <span className="font-medium">{a.name}</span>
                <span className="text-tx2">
                  {t.settings.kinds[a.kind]}{a.broker ? ` · ${a.broker}` : ''} · {formatAmount(a.initialCapital, a.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <AccountForm />
      </section>

      <section className="glass-card p-6">
        <h3 className="mb-3 text-base font-semibold">{t.settings.aboutTitle}</h3>
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
          <dt className="text-tx3">{t.settings.version}</dt>
          <dd>{info?.version ?? '…'}</dd>
          <dt className="text-tx3">{t.settings.dataFolder}</dt>
          <dd className="break-all">{info ? (info.dataDir === '(browser preview)' ? t.settings.browserPreview : info.dataDir) : '…'}</dd>
          <dt className="text-tx3">{t.settings.schema}</dt>
          <dd>v{info?.schemaVersion ?? '…'}</dd>
        </dl>
      </section>
    </div>
  )
}
