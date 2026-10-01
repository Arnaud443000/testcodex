import { useState } from 'react'
import { Checkbox, CheckMark } from './ui/Checkbox'
import { useT } from '../i18n'
import { nextRuleState } from '../lib/tradeForm'
import type { ChecklistItem, Rule } from '../types/trade'
import { Notice } from './ui'

/** Règles personnelles (tri-état) et checklist pré-trade (case à cocher), charte 5.5. */
export function RulesPanel({
  rules,
  checklist,
  ruleChecks,
  checked,
  onRule,
  onItem,
  onAddRule,
  onAddItem,
}: {
  rules: Rule[]
  checklist: ChecklistItem[]
  ruleChecks: Record<number, boolean>
  checked: Record<number, boolean>
  onRule: (id: number, respected: boolean | undefined) => void
  onItem: (id: number, checked: boolean) => void
  onAddRule: (text: string) => Promise<unknown>
  onAddItem: (label: string) => Promise<unknown>
}) {
  const t = useT()
  const broken = rules.filter((r) => ruleChecks[r.id] === false)
  const empty = rules.length === 0 && checklist.length === 0

  return (
    <>
      <section className="glass-card flex flex-col gap-3 px-6 py-[22px]" aria-labelledby="rules-title">
        <h2 id="rules-title" className="text-[15px] font-semibold">{t.form.rules.title}</h2>
        {empty && <p className="text-sm text-tx2">{t.form.rules.empty}</p>}

        {rules.length > 0 && (
          <>
            <p className="caption">{t.form.rules.rulesTitle}</p>
            <ul className="flex flex-col gap-2.5">
              {rules.map((r) => {
                const state = ruleChecks[r.id]
                const stateLabel = state === undefined ? t.form.rules.stateUnanswered : state ? t.form.rules.stateRespected : t.form.rules.stateBroken
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onRule(r.id, nextRuleState(state))}
                      aria-label={`${r.text} — ${stateLabel}`}
                      className="flex w-full items-center gap-3 rounded-sm text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
                    >
                      <CheckMark visual={state === undefined ? 'off' : state ? 'on' : 'bad'} />
                      <span className={state === false ? 'text-[#F5A198]' : ''}>{r.text}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-tx3">{t.form.rules.hint}</p>
          </>
        )}
        <Adder placeholder={t.form.rules.rulePlaceholder} label={t.form.rules.addRule} onAdd={onAddRule} />

        {checklist.length > 0 && (
          <>
            <p className="caption mt-2">{t.form.rules.checklistTitle}</p>
            <ul className="flex flex-col gap-2.5">
              {checklist.map((c) => (
                <li key={c.id}>
                  <Checkbox checked={checked[c.id] ?? false} onChange={(v) => onItem(c.id, v)} label={c.label} />
                </li>
              ))}
            </ul>
          </>
        )}
        <Adder placeholder={t.form.rules.itemPlaceholder} label={t.form.rules.addItem} onAdd={onAddItem} />
      </section>

      {broken.map((r) => (
        <Notice key={r.id} level="bad">{t.form.notices.ruleBroken(r.text)}</Notice>
      ))}
    </>
  )
}

function Adder({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => Promise<unknown> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!value.trim()) return
    try {
      await onAdd(value)
      setValue('')
      setOpen(false)
      setError(null)
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
    }
  }
  if (!open) {
    return (
      <button type="button" className="btn-link self-start" onClick={() => setOpen(true)}>
        + {label}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          autoFocus
          className="input !h-[36px]"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void submit()}>
          {t.form.create}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-[#F5A198]">{error}</p>}
    </div>
  )
}
