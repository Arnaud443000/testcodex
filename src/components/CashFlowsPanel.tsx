import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { parseDecimalInput, signOf } from '../lib/decimal'
import { formatDate, formatSignedMoney } from '../lib/format'
import { localTzOffsetMin } from '../lib/period'
import type { CashFlow, CashFlowKind } from '../types/account'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dépôts et retraits d'un compte : liste, ajout, suppression. Jamais comptés dans la performance. */
export function CashFlowsPanel() {
  const t = useT()
  const { accounts } = useAccounts()
  const [accountId, setAccountId] = useState<number | null>(null)
  const [flows, setFlows] = useState<CashFlow[] | null>(null)
  const [kind, setKind] = useState<CashFlowKind>('deposit')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<number | null>(null)

  // Le compte choisi reste valide quand on en crée ou supprime un.
  const current = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null
  const currentId = current?.id ?? null

  const load = useCallback(async (id: number) => {
    try {
      setFlows(await api.listCashFlows(id))
    } catch (e) {
      setError(t.settings.cashFlows.loadError(String(e instanceof Error ? e.message : e)))
    }
  }, [t])

  useEffect(() => {
    setFlows(null)
    setConfirmId(null)
    if (currentId !== null) void load(currentId)
  }, [currentId, load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (currentId === null) return
    setError(null)
    const value = parseDecimalInput(amount)
    if (value === null || signOf(value) <= 0) return setError(t.settings.cashFlows.errAmount)
    // Midi à l'heure locale : la date choisie ne bascule pas d'un jour selon le fuseau.
    const at = new Date(`${date}T12:00:00`).getTime()
    if (!date || Number.isNaN(at)) return setError(t.settings.cashFlows.errDate)
    setBusy(true)
    try {
      await api.createCashFlow({ accountId: currentId, kind, amount: value, occurredAt: at, tzOffsetMin: localTzOffsetMin(), note })
      setAmount('')
      setNote('')
      await load(currentId)
    } catch (err) {
      setError(t.settings.cashFlows.errSave(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (currentId === null) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteCashFlow(id)
      setConfirmId(null)
      await load(currentId)
    } catch (err) {
      setError(t.settings.cashFlows.errDelete(String(err instanceof Error ? err.message : err)))
    } finally {
      setBusy(false)
    }
  }

  const c = t.settings.cashFlows
  return (
    <section className="glass-card p-6">
      <h3 className="text-base font-semibold">{c.title}</h3>
      <p className="mb-4 mt-1 max-w-[80ch] text-sm text-tx2">{c.intro}</p>
      {current === null ? (
        <p className="rounded-inner border border-dashed px-4 py-5 text-center text-sm text-tx2" style={{ borderColor: 'var(--glass-border)' }}>{c.noAccount}</p>
      ) : (
        <>
          <label className="mb-4 flex w-fit flex-col gap-1.5">
            <span className="caption">{c.account}</span>
            <select className="input min-w-[220px]" value={current.id} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-bg">{a.name}</option>
              ))}
            </select>
          </label>

          {flows === null ? (
            <p className="mb-4 text-sm text-tx2">{t.common.loading}</p>
          ) : flows.length === 0 ? (
            <p className="mb-4 rounded-inner border border-dashed px-4 py-5 text-center text-sm text-tx2" style={{ borderColor: 'var(--glass-border)' }}>{c.empty}</p>
          ) : (
            <ul className="mb-4 divide-y" style={{ borderColor: 'var(--hairline)' }}>
              {flows.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="flex items-center gap-3">
                    <span className={`badge ${f.kind === 'deposit' ? 'badge-gain' : 'badge-warn'}`}>{c.kinds[f.kind]}</span>
                    <span className="text-tx2">{formatDate(f.occurredAt)}</span>
                    {f.note && <span className="text-tx3">{f.note}</span>}
                  </span>
                  <span className="flex items-center gap-4">
                    <b>{f.kind === 'deposit' ? formatSignedMoney(f.amount, current.currency) : formatSignedMoney(`-${f.amount}`, current.currency)}</b>
                    {confirmId === f.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-tx2">{c.deleteConfirm}</span>
                        <button type="button" className="btn btn-secondary btn-sm !text-loss" disabled={busy} onClick={() => void remove(f.id)}>{c.deleteYes}</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmId(null)}>{c.deleteNo}</button>
                      </span>
                    ) : (
                      <button type="button" className="btn-link" onClick={() => setConfirmId(f.id)}>{c.delete}</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} className="grid grid-cols-2 items-end gap-3.5 md:grid-cols-[150px_160px_170px_1fr_auto]">
            <label className="flex flex-col gap-1.5">
              <span className="caption">{c.kind}</span>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CashFlowKind)}>
                <option value="deposit" className="bg-bg">{c.kinds.deposit}</option>
                <option value="withdrawal" className="bg-bg">{c.kinds.withdrawal}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="caption">{c.amount} ({current.currency})</span>
              <input className="input" inputMode="decimal" value={amount} placeholder="500" onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="caption">{c.date}</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="caption">{c.note}</span>
              <input className="input" value={note} placeholder={c.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>{c.add}</button>
          </form>
        </>
      )}
      {error && <div className="nt nt-bad mt-3" role="alert">{error}</div>}
    </section>
  )
}
