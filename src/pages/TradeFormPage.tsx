import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '../components/ui/Tooltip'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { AssetPicker } from '../components/AssetPicker'
import { Select } from '../components/ui/Select'
import { PageHeader } from '../components/PageHeader'
import { PreviewPanel } from '../components/PreviewPanel'
import { RulesPanel } from '../components/RulesPanel'
import { ScreenshotDrop } from '../components/ScreenshotDrop'
import { EmotionListPanel } from '../components/EmotionListPanel'
import { TagChips } from '../components/TagChips'
import { ChipButton, Field, InputWithSuffix, Notice, QualityBar, Segmented, StarRating, StepCard } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { isPositiveDecimal } from '../lib/decimal'
import { formatDecimal } from '../lib/format'
import { useReferenceData } from '../lib/referenceData'
import { formEmotions } from '../lib/emotionList'
import { buildTradeData, emptyForm, formFromTrade, toggleEmotion, type FormErrorCode, type TradeForm } from '../lib/tradeForm'
import type { AssetClass, EmotionMoment, Instrument, Preview, TagKind } from '../types/trade'
import { applyTradePrefill, type SizingSeed, type TradePrefill } from '../lib/sizingForm'

const ASSET_CLASSES: AssetClass[] = ['forex', 'index', 'crypto', 'stock', 'commodity', 'future', 'other']
const MOMENTS: EmotionMoment[] = ['before', 'during', 'after']

export function TradeFormPage() {
  const t = useT()
  const navigate = useNavigate()
  const params = useParams()
  const editId = params.id ? Number(params.id) : null
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const [prefilled, setPrefilled] = useState(false)
  const quick = search.get('mode') === 'quick'
  const { accounts, allAccounts, loading: accountsLoading, selectedId } = useAccounts()
  const ref = useReferenceData()

  const [form, setForm] = useState<TradeForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmNoStop, setConfirmNoStop] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [newAsset, setNewAsset] = useState(false)
  const [emotionPanelOpen, setEmotionPanelOpen] = useState(false)
  const slRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof TradeForm>(key: K, value: TradeForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  // Initialisation : nouveau trade (valeurs par défaut) ou trade à modifier.
  useEffect(() => {
    if (ref.loading || accountsLoading || form) return
    if (editId === null) {
      const blank = emptyForm(accounts.find((a) => a.id === selectedId)?.id ?? accounts[0]?.id ?? null, Date.now())
      // Lot 27 : « Utiliser dans un nouveau trade » depuis le calculateur de position (rien n'est enregistré).
      const prefill = (location.state as { tradePrefill?: TradePrefill } | null)?.tradePrefill
      const usable = prefill && accounts.some((a) => a.id === prefill.accountId) && ref.instruments.some((i) => i.id === prefill.instrumentId)
      setPrefilled(!!usable)
      setForm(usable ? applyTradePrefill(blank, prefill) : blank)
      return
    }
    api
      .getTrade(editId)
      .then((tr) => setForm(formFromTrade(tr, ref.allTags, ref.checklist)))
      .catch((e) => setLoadError(String(e)))
  }, [ref.loading, accountsLoading, form, editId, selectedId, accounts, ref.allTags, ref.checklist])

  const built = useMemo(
    () => (form ? buildTradeData(form, { checklistItems: ref.checklist, quick }) : { data: null, errors: {} }),
    [form, ref.checklist, quick],
  )
  const account = allAccounts.find((a) => a.id === form?.accountId)
  const instrument = ref.instruments.find((i) => i.id === form?.instrumentId)

  // Aperçu en direct : demandé à pulse-core (jamais recalculé ici), avec un léger délai de frappe.
  useEffect(() => {
    const data = built.data
    if (!data) {
      setPreview(null)
      setPreviewError(null)
      setPreviewPending(false)
      return
    }
    let live = true
    setPreviewPending(true)
    const timer = setTimeout(() => {
      api
        .previewTrade(data)
        .then((p) => {
          if (!live) return
          setPreview(p)
          setPreviewError(null)
        })
        .catch((e) => {
          if (!live) return
          setPreview(null)
          setPreviewError(String(e).replace(/^Error: /, ''))
        })
        .finally(() => live && setPreviewPending(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [built.data])

  // Session déduite de l'heure d'entrée, tant que le trader ne la corrige pas.
  const deduced = preview?.session
  useEffect(() => {
    if (!form || form.sessionManual || !deduced) return
    const tag = ref.tags.find((g) => g.kind === 'session' && g.name.toLowerCase() === deduced.toLowerCase())
    if (tag && tag.id !== form.sessionTagId) setForm({ ...form, sessionTagId: tag.id })
  }, [deduced, form, ref.tags])

  // Le stop change : la confirmation « sans stop » ne vaut plus.
  const plannedSl = form?.plannedSl
  useEffect(() => setConfirmNoStop(false), [plannedSl])

  if (accountsLoading || ref.loading || (!form && !loadError && !ref.error)) {
    return <PageHeader title={editId ? t.form.titleEdit : t.form.titleNew} />
  }
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.form.titleNew} />
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {t.common.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  if (loadError || ref.error || !form) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t.form.titleEdit} />
        <div className="nt nt-bad" role="alert">{t.form.loadError(loadError ?? ref.error ?? '')}</div>
      </div>
    )
  }

  // Choisir un actif pré-remplit le multiplicateur (modifiable ensuite).
  const pickInstrument = (i: Instrument) => setForm((f) => (f ? { ...f, instrumentId: i.id, multiplier: i.defaultMultiplier } : f))
  const errorText = (code: FormErrorCode) => (attempted && built.errors[code] ? t.form.errors[code] : undefined)
  const hasErrors = Object.keys(built.errors).length > 0
  const currency = account?.currency ?? ''

  const save = async (force = false) => {
    setAttempted(true)
    setSaveError(null)
    if (!built.data) return
    if (form.plannedSl.trim() === '' && !force && !confirmNoStop) {
      setConfirmNoStop(true)
      return
    }
    setSaving(true)
    try {
      const saved = editId === null ? await api.createTrade(built.data) : await api.updateTrade(editId, built.data)
      navigate(`/trades/${saved.id}`)
    } catch (e) {
      setSaveError(String(e).replace(/^Error: /, ''))
      setSaving(false)
    }
  }

  const toggleMode = () => {
    const next = new URLSearchParams(search)
    if (quick) next.delete('mode')
    else next.set('mode', 'quick')
    setSearch(next, { replace: true })
  }

  const single = (key: 'setupTagId' | 'marketTagId') => ({
    isOn: (id: number) => form[key] === id,
    onToggle: (id: number) => set(key, form[key] === id ? null : id),
  })
  const create = (kind: TagKind, name: string) => ref.addTag(kind, name)
  // Ma liste + les émotions déjà cochées sur ce trade et retirées depuis (elles restent visibles).
  const emotionChoices = formEmotions(ref.allTags, form.emotions.map((e) => e.tagId))
  const sessions = ref.tags.filter((g) => g.kind === 'session')
  const timeframes = ref.tags.filter((g) => g.kind === 'timeframe')
  const autoSession = !form.sessionManual && form.sessionTagId !== null
  const noStop = form.plannedSl.trim() === ''

  const basics = (
    <StepCard n={1} title={t.form.sections.basics} raised>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t.form.fields.asset} htmlFor="f-asset" error={errorText('instrument')}>
          <AssetPicker
            id="f-asset"
            error={!!errorText('instrument')}
            instruments={ref.instruments}
            value={form.instrumentId}
            onChange={pickInstrument}
            onAddCustom={() => setNewAsset(true)}
          />
        </Field>
        <Field label={t.form.fields.side}>
          <Segmented
            label={t.form.fields.side}
            value={form.direction}
            onChange={(v) => v && set('direction', v)}
            options={[
              { value: 'long', label: t.common.directions.long, tone: 'gain' },
              { value: 'short', label: t.common.directions.short, tone: 'loss' },
            ]}
          />
        </Field>
        <Field label={t.form.fields.account} htmlFor="f-account" error={errorText('account')}>
          <Select
            id="f-account"
            value={form.accountId === null ? '' : String(form.accountId)}
            onChange={(v) => set('accountId', v === '' ? null : Number(v))}
            options={(account?.archived ? [...accounts, account] : accounts).map((a) => ({ value: String(a.id), label: a.archived ? t.accountAdmin.archivedOption(a.name) : a.name }))}
          />
        </Field>
        <Field label={t.form.fields.entryTime} htmlFor="f-entry-time" error={errorText('entryTime')}>
          <input id="f-entry-time" type="datetime-local" className={`input !px-2 text-[12.5px] ${errorText('entryTime') ? 'input-error' : ''}`} value={form.entryTime} onChange={(e) => set('entryTime', e.target.value)} />
        </Field>
        <Field label={t.form.fields.session} htmlFor="f-session">
          <Tooltip content={t.form.autoHint}>
            <div className="relative">
              <Select
                id="f-session"
                className={autoSession ? 'input-auto !pr-16' : ''}
                value={form.sessionTagId === null ? '' : String(form.sessionTagId)}
                onChange={(v) => setForm({ ...form, sessionTagId: v === '' ? null : Number(v), sessionManual: v !== '' })}
                options={[{ value: '', label: t.form.placeholders.select }, ...sessions.map((g) => ({ value: String(g.id), label: g.name }))]}
              />
              {autoSession && (
                <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 rounded-full bg-violet/20 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-tx-accent">
                  {t.form.auto}
                </span>
              )}
            </div>
          </Tooltip>
        </Field>
        <Field label={t.form.fields.timeframe} htmlFor="f-timeframe">
          <Select
            id="f-timeframe"
            value={form.timeframeTagId === null ? '' : String(form.timeframeTagId)}
            onChange={(v) => set('timeframeTagId', v === '' ? null : Number(v))}
            options={[{ value: '', label: t.form.placeholders.select }, ...timeframes.map((g) => ({ value: String(g.id), label: g.name }))]}
          />
        </Field>
      </div>
      {newAsset && (
        <NewInstrumentForm
          onCancel={() => setNewAsset(false)}
          onCreate={async (n) => {
            const i = await ref.addInstrument(n)
            pickInstrument(i)
            setNewAsset(false)
          }}
        />
      )}
    </StepCard>
  )

  const prices = (
    <StepCard n={2} title={t.form.sections.price}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PriceField id="f-entry" label={t.form.fields.entry} value={form.entryPrice} error={errorText('entryPrice')} onChange={(v) => set('entryPrice', v)} placeholder={t.form.placeholders.price} />
        <PriceField id="f-exit" label={t.form.fields.exit} value={form.exitPrice} error={errorText('exitPrice') ?? errorText('exitPair')} onChange={(v) => set('exitPrice', v)} placeholder={t.form.placeholders.optional} />
        <PriceField id="f-size" label={t.form.fields.size} value={form.size} error={errorText('size')} onChange={(v) => set('size', v)} placeholder={t.form.placeholders.size} />
        <PriceField id="f-sl" label={t.form.fields.stopLoss} suffix={t.form.units.planned} value={form.plannedSl} error={errorText('plannedSl')} onChange={(v) => set('plannedSl', v)} placeholder={t.form.placeholders.optional} inputRef={slRef} />
        <PriceField id="f-tp" label={t.form.fields.takeProfit} suffix={t.form.units.planned} value={form.plannedTp} error={errorText('plannedTp')} onChange={(v) => set('plannedTp', v)} placeholder={t.form.placeholders.optional} />
        <PriceField id="f-fees" label={t.form.fields.fees} suffix={currency} value={form.fees} error={errorText('fees')} onChange={(v) => set('fees', v)} placeholder={t.form.placeholders.fees} />
        <Field label={t.form.fields.exitTime} htmlFor="f-exit-time" error={errorText('exitTime') ?? errorText('exitBeforeEntry') ?? errorText('exitPair')} className="sm:col-span-3">
          <input id="f-exit-time" type="datetime-local" className="input sm:max-w-[260px]" value={form.exitTime} onChange={(e) => set('exitTime', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t.form.fields.multiplier} htmlFor="f-mult" error={errorText('multiplier')}>
          <input
            id="f-mult"
            className={`input ${errorText('multiplier') ? 'input-error' : ''}`}
            inputMode="decimal"
            value={form.multiplier}
            onChange={(e) => set('multiplier', e.target.value)}
            placeholder={instrument ? formatDecimal(instrument.defaultMultiplier) : '1'}
          />
        </Field>
        <p className="text-xs text-tx3 sm:col-span-2 sm:self-end sm:pb-3">{t.form.multiplierHelp}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Tooltip content={t.sizing.linkHint}>
          <Link
            to="/sizing"
            state={{ sizingSeed: { accountId: form.accountId, instrumentId: form.instrumentId, direction: form.direction, entry: form.entryPrice, stop: form.plannedSl, takeProfit: form.plannedTp, multiplier: form.multiplier } satisfies SizingSeed }}
            className="btn-link"
          >
            {t.sizing.link}
          </Link>
        </Tooltip>
        {prefilled && <span className="text-xs text-tx-accent">{t.sizing.prefilled}</span>}
      </div>
    </StepCard>
  )

  const context = (
    <StepCard n={3} title={t.form.sections.context}>
      <Field label={t.form.fields.setup}>
        <TagChips kind="setup" label={t.form.fields.setup} tags={ref.tags} onCreate={create} {...single('setupTagId')} />
      </Field>
      <Field label={t.form.fields.marketCondition}>
        <TagChips kind="market_condition" label={t.form.fields.marketCondition} tags={ref.tags} onCreate={create} {...single('marketTagId')} />
      </Field>
      <Field label={t.form.fields.tradeType}>
        <div className="max-w-[320px]">
          <Segmented
            label={t.form.fields.tradeType}
            allowClear
            value={form.executionType}
            onChange={(v) => set('executionType', v)}
            options={[
              { value: 'discretionary', label: t.common.executionTypes.discretionary },
              { value: 'system', label: t.common.executionTypes.system },
            ]}
          />
        </div>
      </Field>
    </StepCard>
  )

  const why = (
    <StepCard n={4} title={t.form.sections.why}>
      <Field label={t.form.fields.thesis} htmlFor="f-thesis">
        <textarea id="f-thesis" className="input" placeholder={t.form.placeholders.thesis} value={form.thesis} onChange={(e) => set('thesis', e.target.value)} />
      </Field>
      <Field label={t.form.fields.conviction}>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={10}
            aria-label={t.form.fields.conviction}
            value={form.conviction ?? 5}
            onChange={(e) => set('conviction', Number(e.target.value))}
            className={`h-1.5 flex-1 cursor-pointer accent-violet ${form.conviction === null ? 'opacity-40' : ''}`}
          />
          <span className="min-w-[110px] whitespace-nowrap text-right text-sm font-semibold">
            {form.conviction === null ? <span className="font-normal text-tx3">{t.form.convictionUnset}</span> : `${form.conviction} / 10`}
          </span>
          {form.conviction !== null && (
            <button type="button" className="btn-link" onClick={() => set('conviction', null)}>{t.form.clearValue}</button>
          )}
        </div>
      </Field>
      {MOMENTS.map((m) => (
        <Field key={m} label={t.form.fields[m === 'before' ? 'emotionBefore' : m === 'during' ? 'emotionDuring' : 'emotionAfter']}>
          <div role="group" aria-label={t.common.moments[m]} className="flex flex-wrap gap-2">
            {emotionChoices.map(({ tag, removed }) => (
              <ChipButton
                key={tag.id}
                on={form.emotions.some((e) => e.moment === m && e.tagId === tag.id)}
                onClick={() => set('emotions', toggleEmotion(form.emotions, m, tag.id))}
              >
                {tag.name}
                {removed && <span className="ml-1.5 text-[11px] text-tx3" title={t.emotions.removedHint}>({t.emotions.removedFromList})</span>}
              </ChipButton>
            ))}
            {emotionChoices.length === 0 && <span className="text-[13px] text-tx3">{t.emotions.empty}</span>}
          </div>
        </Field>
      ))}
      <div className="flex flex-col gap-3">
        <div>
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={emotionPanelOpen} onClick={() => setEmotionPanelOpen((o) => !o)}>
            {emotionPanelOpen ? t.emotions.hideManage : t.emotions.addButton}
          </button>
        </div>
        {emotionPanelOpen && (
          <div className="rounded-inner border p-4" style={{ borderColor: 'var(--glass-border)' }}>
            <EmotionListPanel tags={ref.allTags} onAdd={ref.addEmotion} onRemove={ref.removeEmotion} onDelete={ref.deleteEmotion} catalogOpenAtStart />
          </div>
        )}
      </div>
      <Field label={t.form.fields.planFollowed}>
        <div className="max-w-[420px]">
          <Segmented
            label={t.form.fields.planFollowed}
            allowClear
            value={form.planFollowed}
            onChange={(v) => set('planFollowed', v)}
            options={[
              { value: 'yes', label: t.form.planOptions.yes },
              { value: 'partial', label: t.form.planOptions.partial },
              { value: 'no', label: t.form.planOptions.no },
            ]}
          />
        </div>
      </Field>
    </StepCard>
  )

  const after = (
    <StepCard n={5} title={t.form.sections.after}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Field label={t.form.fields.executionQuality}>
          <QualityBar label={t.form.fields.executionQuality} value={form.executionQuality} onChange={(v) => set('executionQuality', v)} />
        </Field>
        <Field label={t.form.fields.rating}>
          <StarRating label={t.form.fields.rating} value={form.rating} onChange={(v) => set('rating', v)} />
        </Field>
      </div>
      <Field label={t.form.fields.postMortem} htmlFor="f-post">
        <textarea id="f-post" className="input" placeholder={t.form.placeholders.postMortem} value={form.postMortem} onChange={(e) => set('postMortem', e.target.value)} />
      </Field>
      <Field label={t.form.fields.mistakes}>
        <TagChips
          kind="mistake"
          bad
          label={t.form.fields.mistakes}
          tags={ref.tags}
          onCreate={create}
          isOn={(id) => form.mistakeTagIds.includes(id)}
          onToggle={(id) => set('mistakeTagIds', form.mistakeTagIds.includes(id) ? form.mistakeTagIds.filter((x) => x !== id) : [...form.mistakeTagIds, id])}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PriceField id="f-asl" label={t.form.fields.actualSl} suffix={t.form.units.actual} value={form.actualSl} error={errorText('actualSl')} onChange={(v) => set('actualSl', v)} placeholder={t.form.placeholders.optional} />
        <PriceField id="f-atp" label={t.form.fields.actualTp} suffix={t.form.units.actual} value={form.actualTp} error={errorText('actualTp')} onChange={(v) => set('actualTp', v)} placeholder={t.form.placeholders.optional} />
        <PriceField id="f-after" label={t.form.fields.priceAfterExit} value={form.priceAfterExit} error={errorText('priceAfterExit')} onChange={(v) => set('priceAfterExit', v)} placeholder={t.form.placeholders.optional} />
      </div>
    </StepCard>
  )

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <PageHeader
        title={editId === null ? (quick ? t.form.quickTitle : t.form.titleNew) : t.form.titleEdit}
        subtitle={quick ? t.form.quickSubtitle : t.form.subtitle}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={toggleMode}>
              {quick ? t.form.fullForm : t.form.quickAdd}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(editId === null ? '/trades' : `/trades/${editId}`)}>
              {t.form.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t.form.saving : t.form.save}
            </button>
          </>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid items-start gap-5">
          <div className="flex flex-col gap-5">
            {basics}
            {prices}
            {!quick && context}
          </div>
          {!quick && (
            <div className="flex flex-col gap-5">
              {why}
              {after}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <PreviewPanel preview={preview} currency={currency} pending={previewPending} error={previewError} />

          {preview?.stopLoss === 'invalid' && <Notice level="bad">{t.form.notices.badStop}</Notice>}
          {noStop && !confirmNoStop && <Notice level="warn">{t.form.notices.noStop}</Notice>}
          {confirmNoStop && (
            <Notice
              level="warn"
              actions={
                <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setConfirmNoStop(false); slRef.current?.focus() }}>
                    {t.form.notices.addStop}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void save(true)}>
                    {t.form.notices.saveAnyway}
                  </button>
                </>
              }
            >
              <strong className="block">{t.form.notices.noStopConfirmTitle}</strong>
              {t.form.notices.noStopConfirmText}
            </Notice>
          )}
          {attempted && hasErrors && <Notice level="bad">{t.form.notices.fixErrors}</Notice>}
          {attempted && built.errors.exitBeforeEntry && <Notice level="bad">{t.form.errors.exitBeforeEntry}</Notice>}
          {saveError && <Notice level="bad">{t.form.notices.saveError(saveError)}</Notice>}

          {!quick && (
            <RulesPanel
              rules={ref.rules}
              checklist={ref.checklist}
              ruleChecks={form.ruleChecks}
              checked={form.checklist}
              onRule={(id, v) => {
                const next = { ...form.ruleChecks }
                if (v === undefined) delete next[id]
                else next[id] = v
                set('ruleChecks', next)
              }}
              onItem={(id, v) => set('checklist', { ...form.checklist, [id]: v })}
              onAddRule={ref.addRule}
              onAddItem={ref.addChecklistItem}
            />
          )}

          <ScreenshotDrop path={form.screenshotPath} onChange={(p) => set('screenshotPath', p)} />
        </aside>
      </div>
    </form>
  )
}

function PriceField({
  id,
  label,
  value,
  onChange,
  error,
  suffix,
  placeholder,
  inputRef,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  suffix?: string
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <Field label={suffix ? `${label} (${suffix})` : label} htmlFor={id} error={error}>
      <InputWithSuffix>
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={`input ${error ? 'input-error' : ''}`}
          value={value}
          placeholder={placeholder}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputWithSuffix>
    </Field>
  )
}

function NewInstrumentForm({
  onCreate,
  onCancel,
}: {
  onCreate: (n: { symbol: string; name: string; assetClass: AssetClass; defaultMultiplier: string }) => Promise<void>
  onCancel: () => void
}) {
  const t = useT()
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [assetClass, setAssetClass] = useState<AssetClass>('forex')
  const [multiplier, setMultiplier] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!symbol.trim()) return setError(t.form.errors.instrument)
    if (!isPositiveDecimal(multiplier)) return setError(t.form.instrumentMultiplier)
    try {
      await onCreate({ symbol, name, assetClass, defaultMultiplier: multiplier.trim().replace(',', '.') })
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-inner border p-4" style={{ borderColor: 'var(--hairline)', background: 'rgba(255,255,255,.04)' }}>
      <legend className="caption px-1">{t.form.newInstrument}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t.form.instrumentSymbol} htmlFor="ni-symbol">
          <input id="ni-symbol" autoFocus className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="EURUSD" />
        </Field>
        <Field label={t.form.instrumentName} htmlFor="ni-name">
          <input id="ni-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.form.instrumentClass} htmlFor="ni-class">
          <Select
            id="ni-class"
            value={assetClass}
            onChange={(v) => setAssetClass(v as AssetClass)}
            options={ASSET_CLASSES.map((c) => ({ value: c, label: t.common.assetClasses[c] }))}
          />
        </Field>
        <Field label={t.form.instrumentMultiplier} htmlFor="ni-mult">
          <input id="ni-mult" className="input" inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-tx3">{t.form.instrumentMultiplierHint}</p>
      {error && <p role="alert" className="text-xs text-[#F5A198]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void submit()}>{t.form.create}</button>
        <button type="button" className="btn-link" onClick={onCancel}>{t.common.cancel}</button>
      </div>
    </fieldset>
  )
}
