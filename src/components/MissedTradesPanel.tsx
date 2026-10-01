import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select } from './ui/Select'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import { fromLocalInput, toLocalInput, tzOffsetMinutes } from '../lib/tradeTime'
import type { Direction } from '../types/trade'
import type { MissedTrade, MissedTradeData } from '../types/journal'
import { AssetPicker } from './AssetPicker'
import { EmptyState } from './EmptyState'
import { ChipButton, Field, Segmented } from './ui'

interface Draft {
  accountId: number | null
  instrumentId: number | null
  direction: Direction | null
  when: string
  reason: string
  notes: string
  conviction: number | null
  setupTagId: number | null
}

const blank = (accountId: number | null): Draft => ({
  accountId,
  instrumentId: null,
  direction: null,
  when: toLocalInput(Date.now()),
  reason: '',
  notes: '',
  conviction: null,
  setupTagId: null,
})

export function MissedTradesPanel() {
  const t = useT()
  const m = t.journalPage.missed
  const { accounts, selectedId } = useAccounts()
  const ref = useReferenceData()
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const defaultAccount = selectedId ?? accounts[0]?.id ?? null
  const [list, setList] = useState<MissedTrade[] | null>(null)
  const [draft, setDraft] = useState<Draft>(() => blank(defaultAccount))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api
      .listMissedTrades(accountIds)
      .then(setList)
      .catch((e) => setError(m.loadError(String(e instanceof Error ? e.message : e))))
  }, [accountIds, m])
  useEffect(() => {
    setList(null)
    load()
  }, [load])
  useEffect(() => {
    setDraft((d) => (d.accountId === null ? { ...d, accountId: defaultAccount } : d))
  }, [defaultAccount])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setups = ref.tags.filter((g) => g.kind === 'setup')
  const symbolOf = (id: number) => ref.instruments.find((i) => i.id === id)?.symbol ?? '—'
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? '—'

  function reset() {
    setDraft(blank(defaultAccount))
    setEditingId(null)
    setErrors({})
    setError(null)
  }

  function edit(x: MissedTrade) {
    setEditingId(x.id)
    setErrors({})
    setError(null)
    setDraft({
      accountId: x.accountId,
      instrumentId: x.instrumentId,
      direction: x.direction ?? null,
      when: toLocalInput(x.occurredAt),
      reason: x.reason,
      notes: x.notes,
      conviction: x.conviction ?? null,
      setupTagId: x.tagIds.find((id) => ref.allTags.find((g) => g.id === id)?.kind === 'setup') ?? null,
    })
  }

  async function submit() {
    const errs: Record<string, string> = {}
    const at = fromLocalInput(draft.when)
    if (draft.accountId === null) errs.account = m.errAccount
    if (draft.instrumentId === null) errs.asset = m.errAsset
    if (at === null) errs.when = m.errWhen
    setErrors(errs)
    if (Object.keys(errs).length > 0 || draft.accountId === null || draft.instrumentId === null || at === null) return
    const data: MissedTradeData = {
      accountId: draft.accountId,
      instrumentId: draft.instrumentId,
      direction: draft.direction,
      occurredAt: at,
      tzOffsetMin: tzOffsetMinutes(at),
      reason: draft.reason,
      notes: draft.notes,
      conviction: draft.conviction,
      // Les autres tags d'un trade manqué éventuellement posés (session…) sont conservés en édition.
      tagIds: [
        ...(editingId === null ? [] : (list?.find((x) => x.id === editingId)?.tagIds ?? []).filter((id) => ref.allTags.find((g) => g.id === id)?.kind !== 'setup')),
        ...(draft.setupTagId === null ? [] : [draft.setupTagId]),
      ],
    }
    setBusy(true)
    setError(null)
    try {
      if (editingId === null) await api.createMissedTrade(data)
      else await api.updateMissedTrade(editingId, data)
      reset()
      load()
    } catch (e) {
      setError(m.saveError(String(e instanceof Error ? e.message : e)))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setError(null)
    try {
      await api.deleteMissedTrade(id)
      setConfirmId(null)
      if (editingId === id) reset()
      load()
    } catch (e) {
      setError(m.saveError(String(e instanceof Error ? e.message : e)))
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
      <section className="glass-card relative z-20 flex flex-col gap-4 px-6 py-[22px]" aria-labelledby="missed-form">
        <div>
          <h2 id="missed-form" className="text-[15px] font-semibold">{editingId === null ? m.formTitle : m.editTitle}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-tx2">{m.intro}</p>
        </div>
        {accounts.length > 1 && (
          <Field label={m.account} htmlFor="mt-account" error={errors.account}>
            <Select
              id="mt-account"
              value={draft.accountId === null ? '' : String(draft.accountId)}
              onChange={(v) => set('accountId', Number(v))}
              options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            />
          </Field>
        )}
        <Field label={m.asset} htmlFor="mt-asset" error={errors.asset}>
          <AssetPicker
            id="mt-asset"
            instruments={ref.instruments}
            value={draft.instrumentId}
            error={!!errors.asset}
            onChange={(i) => set('instrumentId', i.id)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={m.side}>
            <Segmented
              label={m.side}
              value={draft.direction}
              allowClear
              onChange={(v) => set('direction', v)}
              options={[
                { value: 'long', label: t.common.directions.long, tone: 'gain' },
                { value: 'short', label: t.common.directions.short, tone: 'loss' },
              ]}
            />
          </Field>
          <Field label={m.when} htmlFor="mt-when" error={errors.when}>
            <input id="mt-when" type="datetime-local" className={`input ${errors.when ? 'input-error' : ''}`} value={draft.when} onChange={(e) => set('when', e.target.value)} />
          </Field>
        </div>
        <Field label={m.reason} htmlFor="mt-reason">
          <div className="flex flex-wrap gap-2 pb-1">
            {m.reasonChoices.map((r) => (
              <ChipButton key={r} on={draft.reason.trim().toLowerCase() === r.toLowerCase()} onClick={() => set('reason', draft.reason.trim().toLowerCase() === r.toLowerCase() ? '' : r)}>
                {r}
              </ChipButton>
            ))}
          </div>
          <input id="mt-reason" className="input" value={draft.reason} placeholder={m.reasonPlaceholder} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        <Field label={m.conviction}>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={10}
              aria-label={m.conviction}
              value={draft.conviction ?? 5}
              onChange={(e) => set('conviction', Number(e.target.value))}
              className={`h-1.5 flex-1 cursor-pointer accent-violet ${draft.conviction === null ? 'opacity-40' : ''}`}
            />
            <span className="min-w-[110px] whitespace-nowrap text-right text-sm font-semibold">
              {draft.conviction === null ? <span className="font-normal text-tx3">{m.convictionUnset}</span> : `${draft.conviction} / 10`}
            </span>
            {draft.conviction !== null && (
              <button type="button" className="btn-link" onClick={() => set('conviction', null)}>{t.form.clearValue}</button>
            )}
          </div>
        </Field>
        {setups.length > 0 && (
          <Field label={m.setup}>
            <div className="flex flex-wrap gap-2">
              {setups.map((g) => (
                <ChipButton key={g.id} on={draft.setupTagId === g.id} onClick={() => set('setupTagId', draft.setupTagId === g.id ? null : g.id)}>
                  {g.name}
                </ChipButton>
              ))}
            </div>
          </Field>
        )}
        <Field label={m.notes} htmlFor="mt-notes">
          <textarea id="mt-notes" className="input" value={draft.notes} placeholder={m.notesPlaceholder} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {error && <div className="nt nt-bad" role="alert">{error}</div>}
        <div className="flex items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={busy || accounts.length === 0} onClick={submit}>
            {busy ? m.saving : editingId === null ? m.save : m.saveChanges}
          </button>
          {editingId !== null && (
            <button type="button" className="btn btn-secondary" onClick={reset}>{m.cancel}</button>
          )}
        </div>
      </section>

      <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="missed-list">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="missed-list" className="text-[15px] font-semibold">{m.listTitle}</h2>
          {list && list.length > 0 && <span className="text-xs text-tx3">{m.count(list.length)}</span>}
        </div>
        {list === null ? null : list.length === 0 ? (
          <EmptyState title={m.emptyTitle}>{m.emptyText}</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {list.map((x) => (
              <li key={x.id} className="hairline-row !items-start">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {symbolOf(x.instrumentId)}
                    {x.direction && <span className="ml-2 text-xs font-normal text-tx3">{t.common.directions[x.direction]}</span>}
                  </p>
                  <p className="text-xs text-tx3">
                    {formatDateTime(x.occurredAt)}
                    {accounts.length > 1 && ` · ${accountName(x.accountId)}`}
                    {x.conviction != null && ` · ${m.convictionShort(x.conviction)}`}
                  </p>
                  {x.reason && <p className="mt-1 text-sm text-tx2">{x.reason}</p>}
                  {x.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-tx3">{x.notes}</p>}
                </div>
                {confirmId === x.id ? (
                  <span className="flex shrink-0 items-center gap-2 text-[13px]">
                    <span className="text-tx2">{m.deleteConfirm}</span>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(x.id)}>{m.deleteYes}</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmId(null)}>{m.cancel}</button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-3">
                    <button type="button" className="btn-link" onClick={() => edit(x)}>{m.edit}</button>
                    <button type="button" className="btn-link !text-loss" onClick={() => setConfirmId(x.id)}>{m.delete}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
