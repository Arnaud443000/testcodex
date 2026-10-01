import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { isBlank, questionLabel } from '../../lib/analysisView'
import type { AnswerValue, EmotionsAnswer, NewsBlock, Question, Timeframe, TrendAnswer, TrendValue } from '../../types/analysis'
import { TIMEFRAMES, TRENDS } from '../../types/analysis'
import type { Tag } from '../../types/trade'
import { ChipButton } from '../ui'
import { Select } from '../ui/Select'
import { NewsBlockView } from './NewsBlockView'

export interface FieldContext {
  setups: Tag[]
  emotions: Tag[]
  news: NewsBlock | null
}

/** Un champ de l'analyse, selon le type de la question. Une réponse laissée vide reste vide. */
export function QuestionField({ q, value, onChange, ctx }: { q: Question; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void; ctx: FieldContext }) {
  const t = useT()
  const a = t.analysis
  const id = useId()
  const label = questionLabel(q, a.questions)
  const labelId = `${id}-label`

  const body = (() => {
    switch (q.kind) {
      case 'shortText':
        return (
          <input id={id} className="control h-[42px] w-full px-3.5" value={typeof value === 'string' ? value : ''} placeholder={a.shortPlaceholder} onChange={(e) => onChange(e.target.value)} />
        )
      case 'longText':
        return (
          <textarea id={id} className="input" rows={3} value={typeof value === 'string' ? value : ''} placeholder={a.longPlaceholder} onChange={(e) => onChange(e.target.value)} />
        )
      case 'choice':
        return (
          <Select
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(v) => onChange(v === '' ? undefined : v)}
            placeholder={a.choicePlaceholder}
            className="min-w-[220px]"
            options={[{ value: '', label: a.choiceNone }, ...(q.options.choices ?? []).map((c) => ({ value: c, label: c }))]}
          />
        )
      case 'conviction':
        return <ConvictionField value={typeof value === 'number' ? value : null} onChange={(v) => onChange(v ?? undefined)} labelId={labelId} />
      case 'trend':
        return <TrendField units={q.options.timeframes ?? []} value={(value as TrendAnswer | undefined) ?? {}} onChange={(v) => onChange(isBlank(v) ? undefined : v)} />
      case 'setups': {
        const chosen = Array.isArray(value) ? value : []
        return ctx.setups.length === 0 ? (
          <p className="text-sm text-tx3">{a.setupsEmpty}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ctx.setups.map((g) => (
              <ChipButton key={g.id} on={chosen.includes(g.id)} onClick={() => onChange(chosen.includes(g.id) ? chosen.filter((x) => x !== g.id) : [...chosen, g.id])}>
                {g.name}
              </ChipButton>
            ))}
          </div>
        )
      }
      case 'emotions': {
        const v: EmotionsAnswer = (value as EmotionsAnswer | undefined) ?? { text: null, tagIds: [] }
        const set = (next: EmotionsAnswer) => onChange(next.text?.trim() || next.tagIds.length ? next : undefined)
        return (
          <div className="flex flex-col gap-3">
            <input
              id={id}
              className="control h-[42px] w-full px-3.5"
              value={v.text ?? ''}
              placeholder={a.emotionsTextPlaceholder}
              aria-label={a.emotionsText}
              onChange={(e) => set({ ...v, text: e.target.value })}
            />
            {ctx.emotions.length === 0 ? (
              <p className="text-sm text-tx3">
                {a.emotionsEmpty}{' '}
                <Link className="btn-link" to="/settings#emotions">{a.emotionsManage}</Link>
              </p>
            ) : (
              <div role="group" aria-label={a.emotionsList} className="flex flex-wrap gap-2">
                {ctx.emotions.map((g) => (
                  <ChipButton key={g.id} on={v.tagIds.includes(g.id)} onClick={() => set({ ...v, tagIds: v.tagIds.includes(g.id) ? v.tagIds.filter((x) => x !== g.id) : [...v.tagIds, g.id] })}>
                    {g.name}
                  </ChipButton>
                ))}
              </div>
            )}
          </div>
        )
      }
      case 'news': {
        const note = (value as { note: string | null } | undefined)?.note ?? ''
        return (
          <div className="flex flex-col gap-3">
            {ctx.news && <NewsBlockView block={ctx.news} />}
            <label htmlFor={id} className="text-[13px] font-medium text-tx2">{a.news.noteLabel}</label>
            <textarea id={id} className="input" rows={2} value={note} placeholder={a.news.notePlaceholder} onChange={(e) => onChange(e.target.value.trim() ? { note: e.target.value } : undefined)} />
          </div>
        )
      }
    }
  })()

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      {q.kind === 'news' ? (
        <span id={labelId} className="text-sm font-semibold leading-snug">{label}</span>
      ) : (
        <label id={labelId} htmlFor={q.kind === 'conviction' || q.kind === 'trend' || q.kind === 'setups' ? undefined : id} className="text-sm font-semibold leading-snug">
          {label}
        </label>
      )}
      {body}
    </div>
  )
}

function ConvictionField({ value, onChange, labelId }: { value: number | null; onChange: (v: number | null) => void; labelId: string }) {
  const a = useT().analysis
  return (
    <div className="flex flex-col gap-2" aria-labelledby={labelId} role="group">
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={a.convictionPick(n)}
            onClick={() => onChange(value === n ? null : n)}
            className={`chip h-9 min-w-9 justify-center tabular-nums ${value === n ? 'chip-on' : ''}`}
          >
            {n}
          </button>
        ))}
        {value !== null && (
          <button type="button" className="btn-link ml-2" onClick={() => onChange(null)}>{a.convictionClear}</button>
        )}
      </div>
      <p className="text-xs text-tx3">{a.convictionScale}</p>
    </div>
  )
}

function TrendField({ units, value, onChange }: { units: Timeframe[]; value: TrendAnswer; onChange: (v: TrendAnswer) => void }) {
  const a = useT().analysis
  const shown = TIMEFRAMES.filter((tf) => units.includes(tf))
  const update = (tf: Timeframe, patch: { trend?: TrendValue | null; note?: string | null }) => {
    const current = value[tf] ?? { trend: null, note: null }
    const next = { ...value, [tf]: { ...current, ...patch } }
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((tf) => {
        const e = value[tf] ?? { trend: null, note: null }
        return (
          <div key={tf} role="group" aria-label={a.timeframes[tf]} className="grid gap-x-3 gap-y-1.5 sm:grid-cols-[110px_minmax(0,1fr)]">
            <span className="pt-1.5 text-sm text-tx2">{a.timeframes[tf]}</span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5">
                {TRENDS.map((tr) => (
                  <ChipButton key={tr} on={e.trend === tr} onClick={() => update(tf, { trend: e.trend === tr ? null : tr })}>
                    {a.trends[tr]}
                  </ChipButton>
                ))}
              </div>
              <input
                className="control h-[38px] w-full min-w-0 px-3"
                value={e.note ?? ''}
                placeholder={a.trendNote}
                aria-label={a.trendNoteLabel(a.timeframes[tf])}
                onChange={(ev) => update(tf, { note: ev.target.value })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
