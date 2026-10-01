import { useId, useState, type ReactNode } from 'react'
import { Modal } from '../dashboard/Modal'
import { Icon } from '../Icon'
import { InputWithSuffix, Notice } from '../ui'
import { Checkbox } from '../ui/Checkbox'
import { Select } from '../ui/Select'
import { Tooltip } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { api } from '../../lib/api'
import { buildPropInput, emptyPropForm, formFromRules, type LimitForm, type PropForm, type PropFormError, type PropFormField } from '../../lib/propForm'
import { propErrorText } from '../../lib/propView'
import type { Account } from '../../types/account'
import type { PropRules } from '../../types/prop'

/** Petite icône « i » avec infobulle (lot 29), atteignable au clavier. */
function HelpTip({ text, name }: { text: string; name: string }) {
  const t = useT()
  return (
    <Tooltip content={text} focusable>
      <span className="grid h-[18px] w-[18px] cursor-help place-items-center text-tx3" role="img" aria-label={t.prop.editor.help(name)}>
        <Icon name="info" size={15} />
      </span>
    </Tooltip>
  )
}

function Label({ htmlFor, text, help }: { htmlFor?: string; text: string; help?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="caption">{text}</label>
      {help && <HelpTip text={help} name={text} />}
    </div>
  )
}

function ErrorText({ code }: { code: PropFormError | undefined }) {
  const t = useT()
  if (!code) return null
  return (
    <p role="alert" className="text-xs text-[#F5A198]">
      {t.prop.errors[code]}
    </p>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-4">{children}</div>
}

/**
 * Éditeur des règles d'un compte prop firm (lot 33), dans la boîte de dialogue du projet (focus piégé, Échap).
 * Contrôles de forme ici (`lib/propForm.ts`) ; pulse-core valide à nouveau et fait foi (codes `prop:…`).
 */
export function PropRulesEditor({
  account,
  rules,
  today,
  onClose,
  onSaved,
}: {
  account: Account
  rules: PropRules | null
  today: string
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const e = t.prop.editor
  const id = useId()
  const [form, setForm] = useState<PropForm>(() => (rules ? formFromRules(rules) : emptyPropForm(today)))
  const [errors, setErrors] = useState<Partial<Record<PropFormField, PropFormError>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof PropForm>(key: K, value: PropForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setLimit = (key: 'dailyLoss' | 'maxLoss' | 'profitTarget', patch: Partial<LimitForm>) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }))

  const save = async () => {
    const built = buildPropInput(form)
    setErrors(built.errors)
    setServerError(null)
    if (!built.input) return
    setBusy(true)
    try {
      await api.setPropRules(account.id, built.input)
      onSaved()
    } catch (err) {
      setServerError(propErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api.deletePropRules(account.id)
      onSaved()
    } catch (err) {
      setServerError(propErrorText(t, err))
      setBusy(false)
    }
  }

  const modeOptions = [
    { value: 'percent', label: e.modes.percent },
    { value: 'amount', label: `${e.modes.amount} (${account.currency})` },
  ]
  const limitBlock = (key: 'dailyLoss' | 'maxLoss' | 'profitTarget', title: string, help: string, extra?: ReactNode) => {
    const l = form[key]
    return (
      <Section>
        <div className="flex items-center gap-1.5">
          <Checkbox checked={l.enabled} onChange={(v) => setLimit(key, { enabled: v })} label={<span className="font-semibold">{title}</span>} testId={`prop-${key}-enable`} />
          <HelpTip text={help} name={title} />
        </div>
        {l.enabled && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-${key}-mode`} text={e.modeLabel} />
              <Select id={`${id}-${key}-mode`} value={l.mode} options={modeOptions} onChange={(v) => setLimit(key, { mode: v as LimitForm['mode'] })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-${key}-value`} text={e.value} />
              <InputWithSuffix suffix={l.mode === 'percent' ? '%' : account.currency}>
                <input
                  id={`${id}-${key}-value`}
                  className="input pr-14 tabular-nums"
                  inputMode="decimal"
                  autoComplete="off"
                  value={l.value}
                  aria-invalid={errors[key] ? true : undefined}
                  onChange={(ev) => setLimit(key, { value: ev.target.value })}
                />
              </InputWithSuffix>
              <ErrorText code={errors[key]} />
            </div>
          </div>
        )}
        {l.enabled && extra}
      </Section>
    )
  }

  return (
    <Modal title={e.title(account.name)} onClose={onClose} maxWidth="max-w-[640px]">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          void save()
        }}
      >
        <p className="text-[13px] leading-relaxed text-tx2">{e.intro}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-phase`} text={e.phase} help={e.phaseHelp} />
            <input id={`${id}-phase`} className="input" maxLength={60} autoComplete="off" placeholder={e.phasePlaceholder} value={form.phaseLabel} onChange={(ev) => set('phaseLabel', ev.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-start`} text={e.startedOn} help={e.startedOnHelp} />
            <input id={`${id}-start`} className="input" type="date" value={form.startedOn} aria-invalid={errors.startedOn ? true : undefined} onChange={(ev) => set('startedOn', ev.target.value)} />
            <ErrorText code={errors.startedOn} />
          </div>
        </div>

        <Section>
          <p className="text-[13px] font-semibold">{e.reset}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-time`} text={e.resetTime} help={e.resetTimeHelp} />
              <input
                id={`${id}-time`}
                className="input tabular-nums"
                autoComplete="off"
                placeholder="HH:MM"
                value={form.resetTime}
                aria-invalid={errors.resetTime ? true : undefined}
                onChange={(ev) => set('resetTime', ev.target.value)}
              />
              <ErrorText code={errors.resetTime} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-zone`} text={e.resetZone} help={e.resetZoneHelp} />
              <Select
                id={`${id}-zone`}
                value={form.resetZone}
                placeholder="—"
                error={Boolean(errors.resetZone)}
                options={[
                  { value: 'paris', label: e.zones.paris },
                  { value: 'newYork', label: e.zones.newYork },
                ]}
                onChange={(v) => set('resetZone', v as PropForm['resetZone'])}
              />
              <ErrorText code={errors.resetZone} />
            </div>
          </div>
        </Section>

        {limitBlock(
          'dailyLoss',
          e.dailyLoss,
          e.dailyLossHelp,
          form.dailyLoss.mode === 'percent' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-ref`} text={e.dailyReference} help={e.dailyReferenceHelp} />
              <Select
                id={`${id}-ref`}
                value={form.dailyReference}
                options={[
                  { value: 'initialBalance', label: e.references.initialBalance },
                  { value: 'dayStartBalance', label: e.references.dayStartBalance },
                ]}
                onChange={(v) => set('dailyReference', v as PropForm['dailyReference'])}
              />
            </div>
          ),
        )}
        {limitBlock(
          'maxLoss',
          e.maxLoss,
          e.maxLossHelp,
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-kind`} text={e.maxLossKind} help={e.maxLossKindHelp} />
              <Select
                id={`${id}-kind`}
                value={form.maxLossKind}
                options={[
                  { value: 'static', label: e.kinds.static },
                  { value: 'trailing', label: e.kinds.trailing },
                ]}
                onChange={(v) => set('maxLossKind', v as PropForm['maxLossKind'])}
              />
            </div>
            {form.maxLossKind === 'trailing' && (
              <Checkbox checked={form.trailingLocksAtInitial} onChange={(v) => set('trailingLocksAtInitial', v)} label={e.locks} description={e.locksHelp} align="start" />
            )}
          </div>,
        )}
        {limitBlock('profitTarget', e.profitTarget, e.profitTargetHelp)}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-days`} text={e.minTradingDays} help={e.minTradingDaysHelp} />
            <input
              id={`${id}-days`}
              className="input tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              value={form.minTradingDays}
              aria-invalid={errors.minTradingDays ? true : undefined}
              onChange={(ev) => set('minTradingDays', ev.target.value)}
            />
            <ErrorText code={errors.minTradingDays} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-cons`} text={e.consistency} help={e.consistencyHelp} />
            <InputWithSuffix suffix={e.consistencySuffix}>
              <input
                id={`${id}-cons`}
                className="input pr-24 tabular-nums"
                inputMode="decimal"
                autoComplete="off"
                value={form.consistency}
                aria-invalid={errors.consistency ? true : undefined}
                onChange={(ev) => set('consistency', ev.target.value)}
              />
            </InputWithSuffix>
            <ErrorText code={errors.consistency} />
          </div>
        </div>

        {serverError && <Notice level="bad">{serverError}</Notice>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <div>
            {rules &&
              (confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2 text-[13px] text-tx2">
                  {e.removeConfirm}
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>{e.removeYes}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{e.cancel}</button>
                </span>
              ) : (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>{e.remove}</button>
              ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" data-close onClick={onClose}>{e.cancel}</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? e.saving : e.save}</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
