import { Checkbox } from './ui/Checkbox'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tooltip } from './ui/Tooltip'
import { Link } from 'react-router-dom'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { dayKey, formatDayTitle, shiftDay } from '../lib/journalPeriod'
import type { DayOverview, JournalEntry } from '../types/journal'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { ChipButton, Field, Notice, OutcomeBadge, Pnl } from './ui'

const emptyEntry = (day: string): JournalEntry => ({
  day,
  mood: null,
  sleepQuality: null,
  fatigue: null,
  lateHours: false,
  wentWell: '',
  toImprove: '',
  notes: '',
})

/** Échelle de 1 à 5 : cinq boutons, le sens de chaque valeur est écrit (jamais la couleur seule). */
function Scale({ label, value, labels, onChange }: { label: string; value: number | null | undefined; labels: string[]; onChange: (v: number | null) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1.5">
      <span className="caption">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {labels.map((text, i) => {
          const n = i + 1
          return (
            <ChipButton key={n} on={value === n} onClick={() => onChange(value === n ? null : n)}>
              <span aria-label={t.journalPage.day.scaleValue(n, text)}>
                <span className="mr-1.5 tabular-nums">{n}</span>
                <span className="text-[12px] opacity-80">{text}</span>
              </span>
            </ChipButton>
          )
        })}
      </div>
    </div>
  )
}

export function JournalDayPanel({ initialDay }: { initialDay?: string }) {
  const t = useT()
  const d = t.journalPage.day
  const { selectedId } = useAccounts()
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const today = dayKey()
  const [day, setDay] = useState(initialDay ?? today)
  const [overview, setOverview] = useState<DayOverview | null>(null)
  const [form, setForm] = useState<JournalEntry>(emptyEntry(day))
  const [history, setHistory] = useState<JournalEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadHistory = useCallback(() => api.listJournalEntries(null, null).then((l) => setHistory(l.slice(0, 14))).catch(() => setHistory([])), [])

  useEffect(() => {
    let live = true
    setOverview(null)
    setMessage(null)
    setError(null)
    api
      .getJournalDay(accountIds, day)
      .then((o) => {
        if (!live) return
        setOverview(o)
        setForm(o.entry ?? emptyEntry(day))
      })
      .catch((e) => live && setError(d.loadError(String(e instanceof Error ? e.message : e))))
    return () => {
      live = false
    }
  }, [accountIds, day, d])
  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => {
    setMessage(null)
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function save() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await api.saveJournalEntry({ ...form, day })
      setMessage(saved ? d.saved : d.cleared)
      setOverview((o) => (o ? { ...o, entry: saved } : o))
      if (!saved) setForm(emptyEntry(day))
      await loadHistory()
    } catch (e) {
      setError(d.saveError(String(e instanceof Error ? e.message : e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        <section className="glass-card flex flex-col gap-5 px-6 py-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={d.previous} onClick={() => setDay(shiftDay(day, -1))}>
                <span className="rotate-90"><Icon name="chevron" size={16} /></span>
              </button>
              <div className="min-w-[220px] text-center">
                <p className="text-[17px] font-semibold first-letter:uppercase">{formatDayTitle(day)}</p>
                {day === today && <p className="text-xs text-tx3">{d.today}</p>}
              </div>
              <button type="button" className="control grid h-10 w-10 place-items-center !rounded-full text-tx2" aria-label={d.next} onClick={() => setDay(shiftDay(day, 1))}>
                <span className="-rotate-90"><Icon name="chevron" size={16} /></span>
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-tx2">
              <span className="caption">{d.dayLabel}</span>
              <input type="date" className="input !w-auto" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </label>
          </div>

          {overview && overview.incompleteCount > 0 && <Notice level="warn">{d.incompleteNotice(overview.incompleteCount)}</Notice>}
          {error && <div className="nt nt-bad" role="alert">{error}</div>}

          <h2 className="text-[15px] font-semibold">{d.factorsTitle}</h2>
          <div className="grid grid-cols-1 gap-4">
            <Scale label={d.mood} value={form.mood} labels={d.moodScale} onChange={(v) => set('mood', v)} />
            <Scale label={d.sleep} value={form.sleepQuality} labels={d.sleepScale} onChange={(v) => set('sleepQuality', v)} />
            <Scale label={d.fatigue} value={form.fatigue} labels={d.fatigueScale} onChange={(v) => set('fatigue', v)} />
            <Checkbox checked={form.lateHours} onChange={(v) => set('lateHours', v)} label={d.lateHours} />
          </div>

          <Field label={d.wentWell} htmlFor="j-well">
            <textarea id="j-well" className="input" value={form.wentWell} placeholder={d.wentWellPlaceholder} onChange={(e) => set('wentWell', e.target.value)} />
          </Field>
          <Field label={d.toImprove} htmlFor="j-improve">
            <textarea id="j-improve" className="input" value={form.toImprove} placeholder={d.toImprovePlaceholder} onChange={(e) => set('toImprove', e.target.value)} />
          </Field>
          <Field label={d.notes} htmlFor="j-notes">
            <textarea id="j-notes" className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? d.saving : d.save}
            </button>
            {message && <span role="status" className="text-sm text-[#9BE3C4]">{message}</span>}
            <span className="text-xs text-tx3">{d.clearedHint}</span>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-5">
        <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="day-trades">
          <h2 id="day-trades" className="text-[15px] font-semibold">{d.tradesTitle}</h2>
          {!overview ? null : overview.trades.length === 0 ? (
            <p className="text-sm text-tx3">{d.noTrades}</p>
          ) : (
            <ul className="flex flex-col">
              {overview.trades.map((l) => (
                <li key={l.tradeId} className="hairline-row flex-wrap">
                  <Link to={`/trades/${l.tradeId}`} className="min-w-0 font-medium hover:underline">
                    {l.symbol} <span className="text-xs font-normal text-tx3">{t.common.directions[l.direction]} · {formatDateTime(l.entryTime).split(' · ')[1]}</span>
                  </Link>
                  <span className="flex items-center gap-2">
                    {l.netPnl !== null && l.outcome ? <Pnl value={l.netPnl} currency={l.currency} className="text-sm font-semibold" /> : <OutcomeBadge outcome="open" />}
                    {l.incomplete && (
                      <Tooltip content={t.trades.incompleteHint}>
                        <Link to={`/trades/${l.tradeId}/edit`} className="badge badge-warn">
                          {d.incomplete}
                        </Link>
                      </Tooltip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="journal-history">
          <h2 id="journal-history" className="text-[15px] font-semibold">{d.historyTitle}</h2>
          {history.length === 0 ? (
            <EmptyState title={d.historyTitle}>{d.historyEmpty}</EmptyState>
          ) : (
            <ul className="flex flex-col">
              {history.map((e) => (
                <li key={e.day} className="hairline-row">
                  <button
                    type="button"
                    className={`min-h-[28px] text-left font-medium first-letter:uppercase hover:underline ${e.day === day ? 'text-tx-accent' : ''}`}
                    aria-current={e.day === day ? 'date' : undefined}
                    aria-label={d.historyOpen(formatDayTitle(e.day))}
                    onClick={() => setDay(e.day)}
                  >
                    {formatDayTitle(e.day)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}
