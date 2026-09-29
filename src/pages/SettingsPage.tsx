import { useEffect, useState, type FormEvent } from 'react'
import { AlertSettingsPanel } from '../components/AlertSettingsPanel'
import { AccountRow, ArchivedAccountRow } from '../components/AccountRow'
import { BehaviorSettingsPanel } from '../components/BehaviorSettingsPanel'
import { CashFlowsPanel } from '../components/CashFlowsPanel'
import { DataPanel } from '../components/DataPanel'
import { EditableList } from '../components/EditableList'
import { PageHeader } from '../components/PageHeader'
import { ReminderPanel } from '../components/ReminderPanel'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useAccounts } from '../lib/accounts'
import { parseDecimalInput } from '../lib/decimal'
import type { AccountKind, AppInfo } from '../types/account'
import type { ChecklistItem, Rule } from '../types/trade'

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
    // Le capital voyage sous forme de chaîne décimale exacte (jamais un nombre JS) : "10 000,50" → "10000.50".
    const capitalValue = parseDecimalInput(capital)
    if (!name.trim()) return setError(t.settings.errNameRequired)
    if (capitalValue === null) return setError(t.settings.errCapital)
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

function RulesSection() {
  const t = useT()
  const [rules, setRules] = useState<Rule[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = () => api.listRules(true).then(setRules).catch((e) => setError(String(e)))
  useEffect(() => {
    void reload()
  }, [])
  return (
    <>
      {error && <div className="nt nt-bad" role="alert">{t.settings.list.loadError(error)}</div>}
      <EditableList
        title={t.settings.rules.title}
        intro={t.settings.rules.intro}
        placeholder={t.settings.rules.placeholder}
        emptyText={t.settings.rules.empty}
        addLabel={t.settings.rules.add}
        inputLabel={t.settings.rules.label}
        items={rules.map((r) => ({ id: r.id, text: r.text, archived: r.archived }))}
        onCreate={async (text) => { await api.createRule(text); await reload() }}
        onRename={async (id, text) => { await api.renameRule(id, text); await reload() }}
        onArchive={async (id, archived) => { await api.setRuleArchived(id, archived); await reload() }}
      />
    </>
  )
}

function ChecklistSection() {
  const t = useT()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = () => api.listChecklist(true).then(setItems).catch((e) => setError(String(e)))
  useEffect(() => {
    void reload()
  }, [])
  return (
    <>
      {error && <div className="nt nt-bad" role="alert">{t.settings.list.loadError(error)}</div>}
      <EditableList
        title={t.settings.checklist.title}
        intro={t.settings.checklist.intro}
        placeholder={t.settings.checklist.placeholder}
        emptyText={t.settings.checklist.empty}
        addLabel={t.settings.checklist.add}
        inputLabel={t.settings.checklist.label}
        items={items.map((c) => ({ id: c.id, text: c.label, archived: c.archived }))}
        onCreate={async (text) => { await api.createChecklistItem(text); await reload() }}
        onRename={async (id, text) => { await api.renameChecklistItem(id, text); await reload() }}
        onArchive={async (id, archived) => { await api.setChecklistItemArchived(id, archived); await reload() }}
      />
    </>
  )
}

export function SettingsPage() {
  const { accounts, allAccounts } = useAccounts()
  const archived = allAccounts.filter((a) => a.archived)
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
              <AccountRow key={a.id} account={a} />
            ))}
          </ul>
        )}
        <AccountForm />
        <p className="mt-4 text-[13px] text-tx3">{t.accountAdmin.hint}</p>
      </section>

      {archived.length > 0 && (
        <section className="glass-card p-6">
          <h3 className="mb-1 text-base font-semibold">{t.accountAdmin.archivedTitle}</h3>
          <p className="mb-3 text-[13px] text-tx3">{t.accountAdmin.archivedIntro}</p>
          <ul className="divide-y" style={{ borderColor: 'var(--hairline)' }}>
            {archived.map((a) => (
              <ArchivedAccountRow key={a.id} account={a} />
            ))}
          </ul>
        </section>
      )}

      <RulesSection />
      <ChecklistSection />
      <BehaviorSettingsPanel />
      <AlertSettingsPanel />
      <CashFlowsPanel />
      <ReminderPanel />
      <DataPanel />

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
