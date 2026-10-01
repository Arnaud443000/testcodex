import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReadOnlyGrid, STACK_BELOW, useWidth } from '../components/dashboard/DashboardGrid'
import { DashboardSwitcher } from '../components/dashboard/DashboardSwitcher'
import { EditBar } from '../components/dashboard/EditBar'
import { EditableGrid } from '../components/dashboard/EditableGrid'
import { ImportReport } from '../components/dashboard/ImportReport'
import { NameDialog } from '../components/dashboard/NameDialog'
import { ScopeBar } from '../components/dashboard/ScopeBar'
import { ScopeDialog } from '../components/dashboard/ScopeDialog'
import { WidgetLibrary } from '../components/dashboard/WidgetLibrary'
import { WidgetSettings } from '../components/dashboard/WidgetSettings'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Tooltip } from '../components/ui/Tooltip'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { configFileName, parseImportError } from '../lib/dashboardTransfer'
import { addWidget, countByKind, patchWidget, removeWidget, sameLayout } from '../lib/dashboardDraft'
import { ENGINE_PERIOD, localTzOffsetMin, usePeriod } from '../lib/period'
import { clearWidgetCache } from '../lib/widgetData'
import type { ScopeEnv } from '../lib/widgetScope'
import type { DashboardLayout, DashboardScope, DashboardSummary, ImportWarning, ResolvedDashboard, WidgetDefinition, WidgetInstance } from '../types/dashboardLayout'

/** Dashboard consulté pendant cette session : on y revient en quittant puis en rouvrant la page. */
let sessionKey: string | null = null

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Dialog = { kind: 'save' } | { kind: 'rename' } | { kind: 'new' } | { kind: 'scope' } | null

export function DashboardPage() {
  const { accounts, allAccounts, loading, selectedId } = useAccounts()
  const { period } = usePeriod()
  const t = useT()
  const b = t.dashboardBuilder
  const [layout, setLayout] = useState<DashboardLayout | null>(null)
  const [summaries, setSummaries] = useState<DashboardSummary[]>([])
  const [catalog, setCatalog] = useState<WidgetDefinition[]>([])
  const [draft, setDraft] = useState<WidgetInstance[] | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsUid, setSettingsUid] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [hasTrades, setHasTrades] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState<{ text: string; detail: string | null } | null>(null)
  const [report, setReport] = useState<{ name: string; warnings: ImportWarning[] } | null>(null)
  // Comptes réellement lus (calculés par pulse-core), avec ce pour quoi ils ont été calculés.
  const [resolvedState, setResolvedState] = useState<{ for: string; value: ResolvedDashboard } | null>(null)
  const [gridRef, gridWidth] = useWidth<HTMLDivElement>()
  // Instant de référence figé à l'ouverture : tous les widgets envoient exactement les mêmes requêtes.
  const [nowMs] = useState(() => {
    clearWidgetCache()
    return Date.now()
  })
  const tzOffsetMin = useMemo(() => localTzOffsetMin(), [])

  const scopeKey = layout ? JSON.stringify([layout.key, layout.scope, selectedId]) : null
  const resolved = resolvedState && resolvedState.for === scopeKey ? resolvedState.value : null
  // Sans portée encore calculée : la barre du haut, comme avant le lot 18.
  const chosen = useMemo(
    () => resolved?.scope.accounts ?? (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)),
    [resolved, accounts, allAccounts, selectedId],
  )
  const accountIds = useMemo(() => resolved?.scope.accountIds ?? (selectedId === null ? [] : [selectedId]), [resolved, selectedId])
  const ready = !loading && chosen.length > 0
  const editing = draft !== null
  const shownWidgets = draft ?? layout?.widgets ?? []
  // Devises mélangées : chaque widget libre le dit ; la page entière ne se bloque que si aucun widget n'a son propre compte.
  const mixedCurrencies = (resolved ? resolved.scope.mixedCurrency : chosen.some((a) => a.currency !== chosen[0].currency)) && !shownWidgets.some((w) => w.accountId !== null)
  const defs = useMemo(() => Object.fromEntries(catalog.map((d) => [d.kind, d])), [catalog])
  const dirty = layout !== null && draft !== null && !sameLayout(draft, layout.widgets)
  const narrow = gridWidth > 0 && gridWidth < STACK_BELOW

  const widgetAccountsSig = JSON.stringify(shownWidgets.map((w) => [w.uid, w.accountId]))
  useEffect(() => {
    if (!layout || scopeKey === null) return
    let alive = true
    api
      .resolveDashboardScope(layout.scope, shownWidgets, selectedId)
      .then((value) => alive && setResolvedState({ for: scopeKey, value }))
      .catch((e) => alive && setError(message(e)))
    return () => {
      alive = false
    }
    // `shownWidgets` change à chaque déplacement : seuls les identifiants et comptes des widgets modifient la portée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, widgetAccountsSig])

  const refreshSummaries = useCallback(() => api.listDashboardLayouts().then(setSummaries), [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cat, list] = await Promise.all([api.listWidgetCatalog(), api.listDashboardLayouts()])
        const shown = await (sessionKey && list.some((s) => s.key === sessionKey) ? api.getDashboardLayout(sessionKey) : api.getStartupDashboard())
        if (!alive) return
        setCatalog(cat)
        setSummaries(list)
        setLayout(shown)
        sessionKey = shown.key
      } catch (e) {
        if (alive) setError(message(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Aucun trade du tout (toutes périodes) : bienvenue plutôt qu'une grille de widgets vides.
  useEffect(() => {
    if (!ready) return
    if (mixedCurrencies) {
      setHasTrades(true)
      return
    }
    let alive = true
    api
      .getDashboard({ accountIds, period: ENGINE_PERIOD.ALL, nowMs, tzOffsetMin })
      .then((d) => alive && setHasTrades(d.report.summary.tradeCount > 0 || d.report.openTradeCount > 0))
      .catch(() => alive && setHasTrades(true))
    return () => {
      alive = false
    }
  }, [ready, mixedCurrencies, accountIds, nowMs, tzOffsetMin])

  const resolvedByUid = useMemo(() => Object.fromEntries((resolved?.widgets ?? []).map((w) => [w.uid, w])), [resolved])
  const env: ScopeEnv = useMemo(
    () => ({ accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin, resolved: resolvedByUid }),
    [accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin, resolvedByUid],
  )
  const selectedAccount = useMemo(() => allAccounts.find((a) => a.id === selectedId) ?? null, [allAccounts, selectedId])
  const scopeChoices = useMemo(
    () => allAccounts.filter((a) => !a.archived || a.id === layout?.scope.accountId),
    [allAccounts, layout?.scope.accountId],
  )

  const show = (next: DashboardLayout) => {
    setTransferError(null)
    setLayout(next)
    sessionKey = next.key
  }

  async function select(key: string) {
    setNotice(null)
    try {
      show(await api.getDashboardLayout(key))
    } catch (e) {
      setError(message(e))
    }
  }

  function startEdit(open = false) {
    if (!layout) return
    setDraft(layout.widgets.map((w) => ({ ...w })))
    setLibraryOpen(open)
    setEditError(null)
    setNotice(null)
  }

  function stopEdit() {
    setDraft(null)
    setLibraryOpen(false)
    setSettingsUid(null)
    setEditError(null)
  }

  /** Enregistre le brouillon : sur un dashboard de l'utilisateur, il est remplacé ; sur un dashboard livré, une copie est créée. */
  async function saveDraft(name: string | null, scope: DashboardScope | null = null) {
    if (!layout || !draft) return
    const saved = await api.saveDashboardLayout(layout.key, name ?? layout.name, draft, scope)
    show(saved)
    await refreshSummaries()
    setNotice(layout.builtin ? b.toolbar.savedAsCopy(saved.name) : b.toolbar.saved(saved.name))
    stopEdit()
  }

  async function onSaveClick() {
    if (!layout) return
    if (layout.builtin) return setDialog({ kind: 'save' })
    try {
      await saveDraft(null)
    } catch (e) {
      setEditError(b.toolbar.saveError(message(e)))
    }
  }

  async function makeDefault() {
    if (!layout) return
    try {
      const l = await api.setDefaultDashboardLayout(layout.key)
      show(l)
      await refreshSummaries()
      setNotice(b.toolbar.defaultSet(l.name))
    } catch (e) {
      setError(message(e))
    }
  }

  async function removeDashboard() {
    if (!layout) return
    try {
      await api.deleteDashboardLayout(layout.key)
      const [list, start] = await Promise.all([api.listDashboardLayouts(), api.getStartupDashboard()])
      setSummaries(list)
      show(start)
      setNotice(null)
    } catch (e) {
      setError(message(e))
    }
  }

  /** Dupliquer, exporter, importer (3.8.7). Toutes les règles sont dans pulse-core ; ici on ne fait que choisir le fichier et dire le résultat. */
  async function transfer(run: () => Promise<void>) {
    setTransferBusy(true)
    setTransferError(null)
    setNotice(null)
    try {
      await run()
    } catch (e) {
      const raw = message(e)
      const parsed = parseImportError(raw)
      const er = b.transfer.error
      const text = !parsed
        ? er.unreadable(raw)
        : parsed.code === 'too_new'
          ? er.too_new(parsed.detail)
          : er[parsed.code]
      setTransferError({ text, detail: parsed?.code === 'invalid' || parsed?.code === 'corrupt' ? parsed.detail : null })
    } finally {
      setTransferBusy(false)
    }
  }

  const duplicate = () =>
    transfer(async () => {
      if (!layout) return
      const copy = await api.duplicateDashboardLayout(layout.key)
      show(copy)
      await refreshSummaries()
      setNotice(b.transfer.duplicated(copy.name))
    })

  const exportConfig = () =>
    transfer(async () => {
      if (!layout) return
      const path = await api.pickConfigSavePath(b.transfer.dialogExportTitle, configFileName(layout.name))
      if (!path) return
      await api.exportDashboardConfig(layout.key, path)
      setNotice(b.transfer.exported(layout.name, path))
    })

  const importConfig = () =>
    transfer(async () => {
      const path = await api.pickConfigOpenPath(b.transfer.dialogImportTitle)
      if (!path) return
      const result = await api.importDashboardConfig(path)
      clearWidgetCache()
      show(result.layout)
      await refreshSummaries()
      if (result.warnings.length > 0) {
        setNotice(b.transfer.importedWithWarnings(result.layout.name, result.warnings.length))
        setReport({ name: result.layout.name, warnings: result.warnings })
      } else setNotice(b.transfer.imported(result.layout.name))
    })

  const announce = useCallback((m: string) => setLive(m), [])
  const settingsTarget = draft?.find((w) => w.uid === settingsUid) ?? null

  const header = (
    <PageHeader
      title={t.dashboard.title}
      subtitle={t.dashboard.subtitle}
      inline
      actions={
        layout && ready && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <DashboardSwitcher
              summaries={summaries}
              current={layout}
              onSelect={(k) => void select(k)}
              onSetDefault={() => void makeDefault()}
              onRename={() => setDialog({ kind: 'rename' })}
              onDelete={removeDashboard}
              onNew={() => setDialog({ kind: 'new' })}
              onDuplicate={() => void duplicate()}
              onExport={() => void exportConfig()}
              onImport={() => void importConfig()}
              transferBusy={transferBusy}
            />
            {!narrow && (
              // Le crayon seul serait ambigu (renommer ? modifier ?) : l'action principale garde un mot.
              <Tooltip content={b.toolbar.edit}>
                <button type="button" className="btn btn-secondary btn-sm" aria-label={b.toolbar.edit} onClick={() => startEdit()}>
                  <Icon name="edit" size={15} />
                  {b.toolbar.editShort}
                </button>
              </Tooltip>
            )}
          </div>
        ) : undefined
      }
    />
  )
  const wrap = (body: React.ReactNode) => (
    // La bibliothèque est un panneau fixe à droite : le contenu lui laisse la place (les boutons Enregistrer restent visibles).
    <div className={`flex flex-col gap-5 ${editing && libraryOpen ? 'pr-[436px]' : ''}`}>
      {header}
      {notice && !editing && <div className="nt nt-ok" role="status">{notice}</div>}
      {transferError && (
        <div className="nt nt-bad flex flex-col gap-1" role="alert">
          <p className="font-semibold">{b.transfer.error.title}</p>
          <p>{transferError.text} {b.transfer.error.nothingWritten}</p>
          {transferError.detail && (
            <details className="text-xs text-tx3">
              <summary className="cursor-pointer">{b.transfer.error.detail}</summary>
              <code className="break-words">{transferError.detail}</code>
            </details>
          )}
          <button type="button" className="btn btn-secondary btn-sm self-start" onClick={() => setTransferError(null)}>{b.transfer.error.dismiss}</button>
        </div>
      )}
      {body}
      {report && <ImportReport name={report.name} warnings={report.warnings} onClose={() => setReport(null)} />}
    </div>
  )

  if (loading) return wrap(null)
  if (chosen.length === 0) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.welcomeTitle} action={<Link to="/settings" className="btn btn-primary">{t.dashboard.createFirstAccount}</Link>}>
          {t.dashboard.welcomeText}
        </EmptyState>
      </section>,
    )
  }
  const dialogs = () =>
    layout ? (
      <>
      {dialog?.kind === 'save' && (
        <NameDialog
          title={b.toolbar.saveAs}
          initial={b.toolbar.nameSuggestion(layout.name)}
          submitLabel={t.common.save}
          scopeAccounts={scopeChoices}
          onSubmit={async (name, scope) => {
            await saveDraft(name, scope)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={b.toolbar.rename}
          initial={layout.name}
          submitLabel={t.common.save}
          onSubmit={async (name) => {
            show(await api.renameDashboardLayout(layout.key, name))
            await refreshSummaries()
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'scope' && !layout.builtin && (
        <ScopeDialog
          initial={layout.scope}
          accounts={scopeChoices}
          onSubmit={async (scope) => {
            const updated = await api.setDashboardScope(layout.key, scope)
            show(updated)
            await refreshSummaries()
            setNotice(b.scope.changed(updated.name))
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'new' && (
        <NameDialog
          title={b.toolbar.newDashboard}
          initial=""
          submitLabel={t.common.save}
          scopeAccounts={scopeChoices}
          onSubmit={async (name, scope) => {
            const created = await api.saveDashboardLayout(null, name, [], scope)
            show(created)
            await refreshSummaries()
            setDialog(null)
            setDraft([])
            setLibraryOpen(true)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      </>
    ) : null
  const scopeBar = resolved && layout ? (
    <ScopeBar resolved={resolved} selectedAccount={selectedAccount} isPreset={layout.builtin} onChange={editing ? undefined : () => setDialog({ kind: 'scope' })} />
  ) : null
  if (mixedCurrencies) {
    return wrap(
      <>
        {scopeBar}
        <section className="glass-card">
          {resolved && resolved.scope.effective !== 'follow' ? (
            <EmptyState title={b.scope.mixedEmptyTitle}>{b.scope.mixedEmptyText}</EmptyState>
          ) : (
            <EmptyState title={t.dashboard.mixedCurrenciesTitle}>{t.dashboard.mixedCurrenciesText}</EmptyState>
          )}
        </section>
        {dialogs()}
      </>,
    )
  }
  if (error) return wrap(<div className="nt nt-bad" role="alert">{b.toolbar.loadError(error)}</div>)
  if (!layout || hasTrades === null) return wrap(null)
  if (!hasTrades && !editing) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.noTradesTitle} action={<Link to="/trades/new" className="btn btn-primary">{t.dashboard.addFirstTrade}</Link>}>
          {t.dashboard.noTradesText}
        </EmptyState>
      </section>,
    )
  }

  const shownItems = draft ?? layout.widgets
  return wrap(
    <>
      {scopeBar}
      {editing && (
        <EditBar
          name={layout.name}
          builtin={layout.builtin}
          dirty={dirty}
          libraryOpen={libraryOpen}
          error={editError}
          onToggleLibrary={() => setLibraryOpen((o) => !o)}
          onReset={() => setDraft(layout.widgets.map((w) => ({ ...w })))}
          onCancel={stopEdit}
          onSave={() => void onSaveClick()}
        />
      )}
      <p className="sr-only" aria-live="polite" role="status">{live}</p>
      <div ref={gridRef}>
        {shownItems.length === 0 ? (
          <section className="glass-card">
            <EmptyState
              title={b.toolbar.emptyDashboardTitle}
              action={
                editing ? undefined : (
                  <button type="button" className="btn btn-primary" onClick={() => startEdit(true)}>{b.toolbar.addWidget}</button>
                )
              }
            >
              {b.toolbar.emptyDashboardText}
            </EmptyState>
          </section>
        ) : editing ? (
          <EditableGrid
            items={draft}
            defs={defs}
            env={env}
            onChange={setDraft}
            onRemove={(uid) => {
              const gone = draft.find((w) => w.uid === uid)
              setDraft(removeWidget(draft, uid))
              if (gone) announce(b.edit.removed(b.widgets[gone.kind]?.title ?? gone.kind))
            }}
            onSettings={setSettingsUid}
            announce={announce}
          />
        ) : (
          <ReadOnlyGrid items={layout.widgets} env={env} />
        )}
      </div>
      {editing && libraryOpen && (
        <WidgetLibrary
          catalog={catalog}
          counts={countByKind(draft)}
          env={env}
          onAdd={(def) => {
            setDraft(addWidget(draft, def))
            announce(b.edit.added(b.widgets[def.kind]?.title ?? def.kind))
          }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {settingsTarget && defs[settingsTarget.kind] && (
        <WidgetSettings
          instance={settingsTarget}
          def={defs[settingsTarget.kind]}
          accounts={allAccounts}
          dashboardScope={resolved?.scope ?? null}
          onChange={(patch) => setDraft(patchWidget(draft!, settingsTarget.uid, patch))}
          onClose={() => setSettingsUid(null)}
        />
      )}
      {dialogs()}
    </>,
  )
}
