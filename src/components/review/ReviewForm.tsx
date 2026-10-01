import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { localTzOffsetMin } from '../../lib/period'
import { canAddIntention, draftOf, errorText, isBlankDraft, sameDraft, toInput, type ReviewDraft } from '../../lib/reviewView'
import type { AnswerKey, WeeklyReview } from '../../types/review'
import { ANSWER_KEYS, MAX_ANSWER_CHARS, MAX_INTENTION_CHARS } from '../../types/review'
import { Icon } from '../Icon'

type Notice = { kind: 'ok' | 'bad'; text: string }

/**
 * Les deux cartes de saisie du bilan : « Vos réponses » (trois questions, facultatives) et « Intentions pour la
 * semaine prochaine » (1 à 3). Un seul `<form>` : Entrée dans un champ d'une ligne ne l'envoie pas (l'envoi est le
 * bouton « Enregistrer le brouillon »). Un bilan entièrement vide n'est pas envoyé : le bouton est grisé et pulse-core
 * refuse de toute façon. Rien d'autre que le texte saisi n'est écrit ; tout est enregistré par pulse-core.
 */
export function ReviewForm({ periodKey, review, onChanged }: { periodKey: string; review: WeeklyReview | null; onChanged: () => void }) {
  const r = useT().review
  const saved = draftOf(review)
  const [draft, setDraft] = useState<ReviewDraft>(saved)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const lastIntention = useRef<HTMLInputElement>(null)
  const [focusLast, setFocusLast] = useState(false)

  // Une autre semaine, ou un bilan relu depuis la base : le brouillon repart de ce qui est enregistré.
  useEffect(() => {
    setDraft(draftOf(review))
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, review?.updatedAt, review?.id])
  useEffect(() => setNotice(null), [periodKey])
  useEffect(() => {
    if (focusLast) {
      lastIntention.current?.focus()
      setFocusLast(false)
    }
  }, [focusLast, draft.intentions.length])

  const done = review?.state === 'done'
  const blank = isBlankDraft(draft)
  const unchanged = review !== null && sameDraft(draft, saved)

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setNotice({ kind: 'ok', text: ok })
      onChanged()
    } catch (e) {
      setNotice({ kind: 'bad', text: errorText(r, e, r.saveError) })
    } finally {
      setBusy(false)
    }
  }

  const save = () => api.saveWeeklyReview(toInput(periodKey, draft), localTzOffsetMin())
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (blank || busy) return
    void run(save, done ? r.actions.savedChanges : r.actions.savedDraft)
  }
  const complete = () =>
    run(async () => {
      if (!unchanged) await save()
      await api.completeWeeklyReview(periodKey)
    }, r.actions.savedDone)

  const setAnswer = (key: AnswerKey, value: string) => setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: value } }))
  const setIntention = (i: number, value: string) => setDraft((d) => ({ ...d, intentions: d.intentions.map((x, n) => (n === i ? value : x)) }))
  const removeIntention = (i: number) => setDraft((d) => ({ ...d, intentions: d.intentions.length > 1 ? d.intentions.filter((_, n) => n !== i) : [''] }))
  const addIntention = () => {
    setDraft((d) => (canAddIntention(d) ? { ...d, intentions: [...d.intentions, ''] } : d))
    setFocusLast(true)
  }

  async function remove() {
    setBusy(true)
    setNotice(null)
    try {
      await api.deleteWeeklyReview(periodKey)
      setConfirmDelete(false)
      onChanged()
      setNotice({ kind: 'ok', text: r.actions.deleted })
    } catch (e) {
      setNotice({ kind: 'bad', text: errorText(r, e, r.deleteError) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} aria-label={r.title} data-testid="review-form" noValidate>
      <section className="glass-card flex flex-col gap-4 px-6 py-5" aria-labelledby="review-answers-title">
        <div>
          <h2 id="review-answers-title" className="text-base font-semibold">{r.answers.title}</h2>
          <p className="mt-0.5 text-xs text-tx3">{r.answers.hint}</p>
        </div>
        {ANSWER_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`review-answer-${key}`} className="text-sm font-medium">{r.answers.questions[key]}</label>
            <textarea
              id={`review-answer-${key}`}
              className="input"
              rows={3}
              maxLength={MAX_ANSWER_CHARS}
              value={draft.answers[key]}
              onChange={(e) => setAnswer(key, e.target.value)}
            />
            <p className="self-end text-[11px] tabular-nums text-tx3" aria-hidden="true">{r.answers.counter([...draft.answers[key]].length, MAX_ANSWER_CHARS)}</p>
          </div>
        ))}
      </section>

      <section className="glass-card flex flex-col gap-3 px-6 py-5" aria-labelledby="review-intentions-title">
        <div>
          <h2 id="review-intentions-title" className="text-base font-semibold">{r.intentions.title}</h2>
          <p className="mt-0.5 max-w-[70ch] text-xs text-tx3">{r.intentions.hint}</p>
        </div>
        <ul className="flex flex-col gap-3">
          {draft.intentions.map((text, i) => (
            <li key={i} className="flex flex-col gap-1">
              <label htmlFor={`review-intention-${i}`} className="text-sm font-medium">{r.intentions.fieldLabel(i + 1)}</label>
              <div className="flex items-center gap-2">
                <input
                  id={`review-intention-${i}`}
                  ref={i === draft.intentions.length - 1 ? lastIntention : undefined}
                  className="input min-w-0 flex-1"
                  type="text"
                  maxLength={MAX_INTENTION_CHARS}
                  value={text}
                  placeholder={r.intentions.placeholder}
                  onChange={(e) => setIntention(i, e.target.value)}
                />
                <button
                  type="button"
                  className="control grid h-10 w-10 shrink-0 place-items-center !rounded-full text-tx2"
                  aria-label={r.intentions.remove(i + 1)}
                  onClick={() => removeIntention(i)}
                  disabled={draft.intentions.length === 1 && text === ''}
                >
                  <Icon name="cross" size={14} />
                </button>
              </div>
              <p className="self-end text-[11px] tabular-nums text-tx3" aria-hidden="true">{r.intentions.counter([...text].length, MAX_INTENTION_CHARS)}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addIntention} disabled={!canAddIntention(draft)}>
            <Icon name="plus" size={16} /> {r.intentions.add}
          </button>
          {!canAddIntention(draft) && <span className="text-xs text-tx3">{r.intentions.max}</span>}
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={`btn ${done ? 'btn-primary' : 'btn-secondary'}`} disabled={blank || busy || unchanged}>
            {busy ? r.actions.saving : done ? r.actions.saveChanges : r.actions.saveDraft}
          </button>
          {!done && (
            <button type="button" className="btn btn-primary" disabled={blank || busy} onClick={() => void complete()}>
              <Icon name="check" size={16} /> {r.actions.complete}
            </button>
          )}
          {review && (
            confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-tx2">{r.actions.deleteConfirm}</span>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>{r.actions.deleteYes}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{r.actions.cancel}</button>
              </span>
            ) : (
              <button type="button" className="btn-link !text-loss text-[13px]" onClick={() => setConfirmDelete(true)}>{r.actions.delete}</button>
            )
          )}
        </div>
        {blank && !review && <p className="text-xs text-tx3">{r.actions.emptyHint}</p>}
        {notice && <div className={`nt ${notice.kind === 'ok' ? 'nt-ok' : 'nt-bad'}`} role={notice.kind === 'ok' ? 'status' : 'alert'}>{notice.text}</div>}
      </div>
    </form>
  )
}
