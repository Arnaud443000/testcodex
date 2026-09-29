import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { parseDecimalInput } from '../lib/decimal'
import { formatDecimal } from '../lib/format'
import type { Account, AccountKind } from '../types/account'

const errText = (err: unknown) => String(err instanceof Error ? err.message : err)

/** "10000.50" et "10000.5" désignent le même capital : on compare sans zéros de fin. */
const sameAmount = (a: string, b: string) => {
  const norm = (x: string) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x)
  return norm(a) === norm(b)
}

/** Formulaire de modification d'un compte ; la devise est verrouillée s'il a de l'historique. */
function AccountEditForm({ account: a, onDone }: { account: Account; onDone: () => void }) {
  const { update } = useAccounts()
  const t = useT()
  const [name, setName] = useState(a.name)
  const [kind, setKind] = useState<AccountKind>(a.kind)
  const [broker, setBroker] = useState(a.broker)
  const [currency, setCurrency] = useState(a.currency)
  const [capital, setCapital] = useState(a.initialCapital)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<{ to: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(capitalValue: string) {
    setBusy(true)
    setError(null)
    try {
      await update(a.id, { name, kind, broker, currency, initialCapital: capitalValue })
      onDone()
    } catch (err) {
      const msg = errText(err)
      setError(msg.includes('currency_locked') ? t.accountAdmin.errCurrencyLocked : t.accountAdmin.errSave(msg))
      setWarn(null)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const capitalValue = parseDecimalInput(capital)
    if (!name.trim()) return setError(t.settings.errNameRequired)
    if (!currency.trim()) return setError(t.accountAdmin.errCurrency)
    if (capitalValue === null) return setError(t.settings.errCapital)
    // Changer le capital d'un compte qui a de l'historique réécrit les rendements en % : on demande confirmation.
    if (a.hasHistory && !sameAmount(capitalValue, a.initialCapital) && !warn) return setWarn({ to: capitalValue })
    void save(capitalValue)
  }

  const field = 'flex min-w-0 flex-col gap-1.5'
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3.5">
        <label className={field}>
          <span className="caption">{t.settings.name}</span>
          <input className="control h-[42px] px-3.5" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.type}</span>
          <select className="control h-[42px] px-3.5" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {Object.entries(t.settings.kinds).map(([k, l]) => (
              <option key={k} value={k} className="bg-bg">{l}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          <span className="caption">{t.settings.broker}</span>
          <input className="control h-[42px] px-3.5" value={broker} onChange={(e) => setBroker(e.target.value)} />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.currency}</span>
          <input
            className="control h-[42px] px-3.5"
            value={currency}
            maxLength={3}
            disabled={a.hasHistory}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label className={field}>
          <span className="caption">{t.settings.initialCapital}</span>
          <input
            className="control h-[42px] px-3.5"
            inputMode="decimal"
            value={capital}
            onChange={(e) => {
              setCapital(e.target.value)
              setWarn(null)
            }}
          />
        </label>
      </div>
      {a.hasHistory && <p className="text-[13px] text-tx3">{t.accountAdmin.currencyLocked}</p>}
      {warn && (
        <div className="nt nt-warn" role="alert">
          {t.accountAdmin.capitalWarning(formatDecimal(a.initialCapital, 2), formatDecimal(warn.to, 2), a.currency)}
        </div>
      )}
      {error && <div className="nt nt-bad" role="alert">{error}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary !px-4 !py-1.5 !text-[13px]" disabled={busy} type="submit">
          {warn ? t.accountAdmin.capitalConfirm : t.accountAdmin.save}
        </button>
        <button className="btn btn-secondary !px-4 !py-1.5 !text-[13px]" type="button" onClick={onDone}>
          {t.accountAdmin.cancel}
        </button>
      </div>
    </form>
  )
}

const link = 'text-[13px] font-medium text-tx-accent hover:underline'

/** Ligne d'un compte actif : modifier, archiver, supprimer (seulement s'il est vide). */
export function AccountRow({ account: a }: { account: Account }) {
  const { remove, setArchived, selectedId, select } = useAccounts()
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    setBusy(true)
    setError(null)
    try {
      await remove(a.id)
    } catch (err) {
      const msg = errText(err)
      setError(msg.includes('account_in_use') ? t.settings.errInUse : t.settings.errDelete(msg))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  async function doArchive() {
    setError(null)
    try {
      await setArchived(a.id, true)
      if (selectedId === a.id) select(null)
    } catch (err) {
      setError(t.accountAdmin.errArchive(errText(err)))
    }
  }

  return (
    <li className="py-3 text-sm" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium">{a.name}</span>
        <span className="flex items-center gap-4">
          <span className="text-tx2">
            {t.settings.kinds[a.kind]}{a.broker ? ` · ${a.broker}` : ''} · {formatDecimal(a.initialCapital, 2)} {a.currency}
          </span>
          {confirming ? (
            <span className="flex items-center gap-2">
              <span className="text-tx2">{t.settings.deleteConfirm(a.name)}</span>
              <button className="btn btn-secondary !px-4 !py-1.5 !text-[13px] !text-loss" disabled={busy} onClick={doDelete}>
                {t.settings.deleteYes}
              </button>
              <button className="btn btn-secondary !px-4 !py-1.5 !text-[13px]" onClick={() => setConfirming(false)}>
                {t.settings.deleteCancel}
              </button>
            </span>
          ) : (
            <>
              <button className={link} onClick={() => setEditing((v) => !v)}>{t.accountAdmin.edit}</button>
              <button className={link} onClick={doArchive} title={t.accountAdmin.archiveHelp}>{t.accountAdmin.archive}</button>
              {!a.hasHistory && (
                <button className={link} onClick={() => setConfirming(true)}>{t.settings.delete}</button>
              )}
            </>
          )}
        </span>
      </div>
      {editing && <AccountEditForm account={a} onDone={() => setEditing(false)} />}
      {error && <div className="nt nt-bad mt-2" role="alert">{error}</div>}
    </li>
  )
}

/** Ligne d'un compte archivé : consultable, désarchivable, jamais supprimable. */
export function ArchivedAccountRow({ account: a }: { account: Account }) {
  const { setArchived, select } = useAccounts()
  const navigate = useNavigate()
  const t = useT()
  const [error, setError] = useState<string | null>(null)

  async function restore() {
    setError(null)
    try {
      await setArchived(a.id, false)
    } catch (err) {
      setError(t.accountAdmin.errArchive(errText(err)))
    }
  }

  return (
    <li className="py-3 text-sm" style={{ borderColor: 'var(--hairline)' }}>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 font-medium">
          {a.name}
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-tx2" style={{ background: 'var(--hairline)' }}>
            {t.accountAdmin.archivedBadge}
          </span>
        </span>
        <span className="flex items-center gap-4">
          <span className="text-tx2">
            {t.settings.kinds[a.kind]}{a.broker ? ` · ${a.broker}` : ''} · {formatDecimal(a.initialCapital, 2)} {a.currency}
          </span>
          <button
            className={link}
            onClick={() => {
              select(a.id)
              navigate('/trades')
            }}
          >
            {t.accountAdmin.view}
          </button>
          <button className={link} onClick={restore}>{t.accountAdmin.restore}</button>
        </span>
      </div>
      {error && <div className="nt nt-bad mt-2" role="alert">{error}</div>}
    </li>
  )
}
