import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '../components/ui/Tooltip'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AssetPicker } from '../components/AssetPicker'
import { EmptyState } from '../components/EmptyState'
import { Select } from '../components/ui/Select'
import { PageHeader } from '../components/PageHeader'
import { Field, InputWithSuffix, Notice, Segmented } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { formatDecimal, formatMoney } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import {
  buildSizingRequest, emptySizingForm, loadSizingMemory, saveSizingMemory, seedToForm, sizingWarnings, tradePrefill,
  type SizingForm, type SizingSeed,
} from '../lib/sizingForm'
import { signOf, trimDecimal } from '../lib/decimal'
import type { Instrument } from '../types/trade'
import type { Sizing, SizingOutcome, SizingRequest } from '../types/sizing'

/** Lot 27 : calculateur de taille de position. Aucun calcul ici : tout vient de pulse-core (`sizing.rs`). */
export function SizingPage() {
  const t = useT()
  const s = t.sizing
  const navigate = useNavigate()
  const location = useLocation()
  const { accounts, loading: accountsLoading, selectedId } = useAccounts()
  const ref = useReferenceData()
  const [form, setForm] = useState<SizingForm | null>(null)
  const [outcome, setOutcome] = useState<{ request: SizingRequest; outcome: SizingOutcome } | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const seeded = useRef(false)

  const set = <K extends keyof SizingForm>(key: K, value: SizingForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  // Départ : prérempli depuis le formulaire de trade, sinon la mémoire de ce PC, sinon le compte de la barre du haut.
  useEffect(() => {
    if (form || ref.loading || accountsLoading || seeded.current) return
    seeded.current = true
    const memory = loadSizingMemory()
    const fallbackAccount = accounts.find((a) => a.id === selectedId)?.id ?? accounts[0]?.id ?? null
    let f: SizingForm = {
      ...emptySizingForm(),
      accountId: accounts.some((a) => a.id === memory?.accountId) ? memory!.accountId : fallbackAccount,
      instrumentId: ref.instruments.some((i) => i.id === memory?.instrumentId) ? memory!.instrumentId : null,
      riskMode: memory?.riskMode ?? 'percent',
      riskValue: memory?.riskValue || '1',
    }
    const seed = (location.state as { sizingSeed?: SizingSeed } | null)?.sizingSeed
    if (seed) {
      f = seedToForm({ ...seed, accountId: accounts.some((a) => a.id === seed.accountId) ? seed.accountId : f.accountId }, f)
      setShowAdvanced(seed.multiplier !== '')
    }
    setForm(f)
  }, [form, ref.loading, accountsLoading, accounts, selectedId, ref.instruments, location.state])

  useEffect(() => {
    if (form) saveSizingMemory(form)
  }, [form?.accountId, form?.instrumentId, form?.riskMode, form?.riskValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo(() => (form ? buildSizingRequest(form) : null), [form])
  const request = built?.request ?? null

  // Calcul demandé à pulse-core dès que la saisie est prête (léger délai de frappe).
  useEffect(() => {
    if (!request) {
      setOutcome(null)
      setFailure(null)
      setPending(false)
      return
    }
    let live = true
    setPending(true)
    const timer = setTimeout(() => {
      api
        .calculatePositionSize(request)
        .then((o) => {
          if (!live) return
          setOutcome({ request, outcome: o })
          setFailure(null)
        })
        .catch((e) => {
          if (!live) return
          setOutcome(null)
          setFailure(String(e).replace(/^Error: /, ''))
        })
        .finally(() => live && setPending(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [request])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  if (accountsLoading || ref.loading || (!form && !ref.error)) return <PageHeader title={s.title} />
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={s.title} subtitle={s.subtitle} />
        <section className="glass-card">
          <EmptyState title={s.states.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{s.states.noAccountAction}</Link>}>
            {s.states.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (ref.error || !form || !built) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={s.title} />
        <div className="nt nt-bad" role="alert">{s.states.failed(ref.error ?? '')}</div>
      </div>
    )
  }

  const account = accounts.find((a) => a.id === form.accountId)
  const instrument = ref.instruments.find((i) => i.id === form.instrumentId)
  const currency = account?.currency ?? ''
  const err = (key: keyof typeof built.errors) => (built.errors[key] ? s.errors[key] : undefined)
  const current = outcome && request && outcome.request === request ? outcome.outcome : null

  const copy = async (size: string) => {
    try {
      await navigator.clipboard.writeText(size)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={s.title} subtitle={s.subtitle} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="glass-card relative z-20 flex flex-col gap-5 px-6 py-[22px]" aria-label={s.sections.setup}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={s.fields.account} htmlFor="s-account">
              <Select
                id="s-account"
                value={form.accountId === null ? '' : String(form.accountId)}
                onChange={(v) => set('accountId', v === '' ? null : Number(v))}
                options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
              />
            </Field>
            <Field label={s.fields.asset} htmlFor="s-asset">
              <AssetPicker id="s-asset" instruments={ref.instruments} value={form.instrumentId} onChange={(i: Instrument) => set('instrumentId', i.id)} />
            </Field>
          </div>
          <Field label={s.fields.side}>
            <div className="max-w-[320px]">
              <Segmented
                label={s.fields.side}
                value={form.direction}
                onChange={(v) => v && set('direction', v)}
                options={[
                  { value: 'long', label: t.common.directions.long, tone: 'gain' },
                  { value: 'short', label: t.common.directions.short, tone: 'loss' },
                ]}
              />
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumberField id="s-entry" label={s.fields.entry} value={form.entry} onChange={(v) => set('entry', v)} error={err('entry')} placeholder={s.placeholders.price} />
            <NumberField id="s-stop" label={s.fields.stop} value={form.stop} onChange={(v) => set('stop', v)} error={err('stop')} placeholder={s.placeholders.price} />
            <NumberField id="s-tp" label={s.fields.takeProfit} value={form.takeProfit} onChange={(v) => set('takeProfit', v)} error={err('takeProfit')} placeholder={s.placeholders.optional} />
          </div>
          <div className="flex flex-col gap-3 border-t pt-5" style={{ borderColor: 'var(--hairline)' }}>
            <h2 className="text-[15px] font-semibold">{s.sections.risk}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={s.fields.riskMode}>
                <Segmented
                  label={s.fields.riskMode}
                  value={form.riskMode}
                  onChange={(v) => v && set('riskMode', v)}
                  options={[
                    { value: 'percent', label: s.fields.riskPercent },
                    { value: 'amount', label: s.fields.riskAmount },
                  ]}
                />
              </Field>
              <NumberField
                id="s-risk"
                label={form.riskMode === 'percent' ? s.fields.riskPercentLabel : s.fields.riskAmountLabel(currency)}
                value={form.riskValue}
                onChange={(v) => set('riskValue', v)}
                error={err('risk')}
                suffix={form.riskMode === 'percent' ? '%' : currency}
                placeholder={form.riskMode === 'percent' ? s.placeholders.percent : s.placeholders.amount}
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <button type="button" className="btn-link self-start" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
              {s.sections.advanced}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField id="s-mult" label={s.fields.multiplier} value={form.multiplier} onChange={(v) => set('multiplier', v)} error={err('multiplier')} placeholder={instrument ? formatDecimal(instrument.defaultMultiplier) : '1'} />
                <NumberField id="s-step" label={s.fields.sizeStep} value={form.sizeStep} onChange={(v) => set('sizeStep', v)} error={err('sizeStep')} placeholder={s.placeholders.stepDefault} />
                <p className="text-xs text-tx3 sm:col-span-2">{s.hints.advanced}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-tx3">{s.hints.remembered}</p>
        </section>

        <section className="glass-card flex flex-col gap-5 px-6 py-[22px]" aria-live="polite" data-testid="sizing-result">
          {form.instrumentId === null ? (
            <EmptyState title={s.states.noAssetTitle}>{s.states.noAssetText}</EmptyState>
          ) : built.incomplete || !request ? (
            <EmptyState title={s.states.incompleteTitle}>{s.states.incompleteText}</EmptyState>
          ) : failure ? (
            <Notice level="bad">{s.states.failed(failure)}</Notice>
          ) : !current ? (
            <p className="py-10 text-center text-sm text-tx3">{s.states.calculating}</p>
          ) : current.status === 'refused' ? (
            <Refused outcome={current} request={request} currency={currency} />
          ) : (
            <Result
              result={current.result}
              currency={current.currency}
              direction={request.direction}
              stale={pending}
              copied={copied}
              onCopy={() => void copy(current.result.size)}
              onUse={() => navigate('/trades/new', { state: { tradePrefill: tradePrefill(request, current.result) } })}
            />
          )}
          <p className="border-t pt-4 text-xs text-tx3" style={{ borderColor: 'var(--hairline)' }}>{s.disclaimer}</p>
        </section>
      </div>
    </div>
  )
}

function NumberField({ id, label, value, onChange, error, suffix, placeholder }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  suffix?: string
  placeholder?: string
}) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <InputWithSuffix suffix={suffix}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`input tabular-nums ${error ? 'input-error' : ''}`}
          value={value}
          placeholder={placeholder}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputWithSuffix>
    </Field>
  )
}

function Refused({ outcome, request, currency }: { outcome: Extract<SizingOutcome, { status: 'refused' }>; request: SizingRequest; currency: string }) {
  const r = useT().sizing.refused
  let text: string
  switch (outcome.code) {
    case 'stopWrongSide':
      text = r.stopWrongSide(request.direction)
      break
    case 'sizeZero':
      text = r.sizeZero(outcome.detail ? formatMoney(outcome.detail, currency) : '—')
      break
    case 'priceNotPositive':
    case 'stopEqualsEntry':
    case 'riskNotPositive':
    case 'riskPercentTooHigh':
    case 'balanceNotPositive':
    case 'multiplierNotPositive':
    case 'stepNotPositive':
    case 'overflow':
      text = r[outcome.code]
      break
    default:
      text = r.unknown(String(outcome.code))
  }
  return (
    <div className="flex flex-col gap-3" data-testid="sizing-refused">
      <h2 className="text-[15px] font-semibold">{r.title}</h2>
      <Notice level="bad">
        <span data-code={outcome.code}>{text}</span>
        {outcome.code === 'sizeZero' && <span className="mt-1.5 block text-tx2">{r.sizeZeroHint}</span>}
      </Notice>
    </div>
  )
}

function Result({ result, currency, direction, stale, copied, onCopy, onUse }: {
  result: Sizing
  currency: string
  direction: 'long' | 'short'
  stale: boolean
  copied: 'ok' | 'fail' | null
  onCopy: () => void
  onUse: () => void
}) {
  const s = useT().sizing
  const r = s.result
  const warnings = sizingWarnings(result)
  const alerts = warnings.filter((w): w is 'exceedsMax' | 'takeProfitWrongSide' => w !== 'defaultStep')
  const pct = (v: string | null) => (v === null ? null : `${formatDecimal(trimDecimal(v, 2), 2)} %`)
  const money = (v: string) => formatMoney(v, currency)
  const limit = result.maxRiskPercent !== null
    ? result.maxRiskAmount !== null
      ? r.limitValue(`${formatDecimal(result.maxRiskPercent)} %`, money(result.maxRiskAmount))
      : `${formatDecimal(result.maxRiskPercent)} %`
    : null
  const withPct = (amount: string, percent: string | null) => (percent === null ? money(amount) : r.percentOf(money(amount), pct(percent)!))
  return (
    <div className={`flex flex-col gap-5 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      <div>
        <div className="caption">{r.label}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span
            className="text-[64px] font-semibold leading-none tracking-tight tabular-nums"
            data-testid="sizing-size"
            aria-label={r.sizeAria(formatDecimal(result.size))}
          >
            {formatDecimal(result.size)}
          </span>
        </div>
        <p className="mt-2 text-sm text-tx2">
          {r.riskActual} : <b className="tabular-nums text-tx">{withPct(result.riskActual, result.riskActualPercent)}</b>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={onCopy}>
            {r.copy}
          </button>
          <Tooltip content={r.useInTradeHint}>
            <button type="button" className="btn btn-primary" onClick={onUse}>
              {r.useInTrade}
            </button>
          </Tooltip>
          {copied === 'ok' && <span role="status" className="text-sm text-tx2">{r.copied}</span>}
          {copied === 'fail' && <span role="status" className="text-sm text-[#F5A198]">{r.copyFailed}</span>}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2.5" data-testid="sizing-warnings">
          {alerts.map((w) => (
            <Notice key={w} level="warn">
              <b>{s.warnings.prefix} : </b>
              {w === 'exceedsMax'
                ? s.warnings.exceedsMax(
                    money(result.riskActual),
                    result.riskActualPercent === null ? '—' : pct(result.riskActualPercent)!,
                    `${formatDecimal(result.maxRiskPercent ?? '0')} %`,
                    result.maxRiskAmount === null ? null : money(result.maxRiskAmount),
                  )
                : s.warnings.takeProfitWrongSide(direction)}
            </Notice>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-[15px] font-semibold">{r.detailsTitle}</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
          <Row label={r.riskWanted} value={withPct(result.riskWanted, result.riskWantedPercent)} />
          <Row label={r.riskActual} value={withPct(result.riskActual, result.riskActualPercent)} />
          <Row label={r.gap} value={signOf(result.riskGap) === 0 ? r.gapNone : money(result.riskGap)} />
          <Row label={r.distance} value={formatDecimal(result.stopDistance)} />
          <Row label={r.rawSize} value={formatDecimal(result.rawSize)} />
          <Row label={r.step} value={`${formatDecimal(result.sizeStep)} (${result.sizeStepIsDefault ? r.stepDefault : r.stepCustom})`} />
          <Row label={r.multiplier} value={formatDecimal(result.multiplier)} />
          <Row label={r.balance} value={money(result.balance)} hint={r.balanceHint} />
          {limit && <Row label={r.limit} value={limit} />}
          {result.rewardAmount !== null && <Row label={r.reward} value={money(result.rewardAmount)} />}
          {result.rewardRisk !== null && <Row label={r.rewardRisk} value={`${result.rewardRisk.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} : 1`} />}
        </dl>
        <p className="mt-3 text-xs text-tx3">{r.rounding}</p>
        {warnings.includes('defaultStep') && <p className="mt-1.5 text-xs text-tx3" data-testid="sizing-default-step">{s.warnings.defaultStep}</p>}
      </div>
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Tooltip content={hint}>
      <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm" style={{ borderColor: 'var(--hairline)' }}>
        <dt className="text-tx2">{label}</dt>
        <dd className="text-right font-medium tabular-nums">{value}</dd>
      </div>
    </Tooltip>
  )
}
