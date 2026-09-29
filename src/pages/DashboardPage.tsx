import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReadOnlyGrid, STACK_BELOW, useWidth } from '../components/dashboard/DashboardGrid'
import { DashboardSwitcher } from '../components/dashboard/DashboardSwitcher'
import { EditBar } from '../components/dashboard/EditBar'
import { EditableGrid } from '../components/dashboard/EditableGrid'
import { NameDialog } from '../components/dashboard/NameDialog'
import { WidgetLibrary } from '../components/dashboard/WidgetLibrary'
import { WidgetSettings } from '../components/dashboard/WidgetSettings'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'
import { api } from '../lib/api'
import { addWidget, countByKind, patchWidget, removeWidget, sameLayout } from '../lib/dashboardDraft'
import { ENGINE_PERIOD, localTzOffsetMin, usePeriod } from '../lib/period'
import { clearWidgetCache } from '../lib/widgetData'
import type { ScopeEnv } from '../lib/widgetScope'
import type { DashboardLayout, DashboardSummary, WidgetDefinition, WidgetInstance } from '../types/dashboardLayout'

/** Dashboard consulté pendant cette session : on y revient en quittant puis en rouvrant la page. */
let sessionKey: string | null = null

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Dialog = { kind: 'save' } | { kind: 'rename' } | { kind: 'new' } | null

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
  const [gridRef, gridWidth] = useWidth<HTMLDivElement>()
  // Instant de référence figé à l'ouverture : tous les widgets envoient exactement les mêmes requêtes.
  const [nowMs] = useState(() => {
    clearWidgetCache()
    return Date.now()
  })
  const tzOffsetMin = useMemo(() => localTzOffsetMin(), [])

  const chosen = useMemo(() => (selectedId === null ? accounts : allAccounts.filter((a) => a.id === selectedId)), [accounts, allAccounts, selectedId])
  const accountIds = useMemo(() => (selectedId === null ? [] : [selectedId]), [selectedId])
  const mixedCurrencies = chosen.some((a) => a.currency !== chosen[0].currency)
  const ready = !loading && chosen.length > 0
  const editing = draft !== null
  const defs = useMemo(() => Object.fromEntries(catalog.map((d) => [d.kind, d])), [catalog])
  const dirty = layout !== null && draft !== null && !sameLayout(draft, layout.widgets)
  const narrow = gridWidth > 0 && gridWidth < STACK_BELOW

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
    if (!ready || mixedCurrencies) return
    let alive = true
    api
      .getDashboard({ accountIds, period: ENGINE_PERIOD.ALL, nowMs, tzOffsetMin })
      .then((d) => alive && setHasTrades(d.report.summary.tradeCount > 0 || d.report.openTradeCount > 0))
      .catch(() => alive && setHasTrades(true))
    return () => {
      alive = false
    }
  }, [ready, mixedCurrencies, accountIds, nowMs, tzOffsetMin])

  const env: ScopeEnv = useMemo(
    () => ({ accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin }),
    [accounts, allAccounts, selectedId, period, nowMs, tzOffsetMin],
  )

  const show = (next: DashboardLayout) => {
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
  async function saveDraft(name: string | null) {
    if (!layout || !draft) return
    const saved = await api.saveDashboardLayout(layout.key, name ?? layout.name, draft)
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

  const announce = useCallback((m: string) => setLive(m), [])
  const settingsTarget = draft?.find((w) => w.uid === settingsUid) ?? null

  const header = (
    <PageHeader
      title={t.dashboard.title}
      subtitle={t.dashboard.subtitle}
      actions={
        layout && ready && !mixedCurrencies && hasTrades !== false && !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <DashboardSwitcher
              summaries={summaries}
              current={layout}
              onSelect={(k) => void select(k)}
              onSetDefault={() => void makeDefault()}
              onRename={() => setDialog({ kind: 'rename' })}
              onDelete={removeDashboard}
              onNew={() => setDialog({ kind: 'new' })}
            />
            {!narrow && (
              <button type="button" className="btn btn-secondary" onClick={() => startEdit()}>
                <Icon name="edit" size={16} />
                {b.toolbar.edit}
              </button>
            )}
          </div>
        ) : undefined
      }
    />
  )
  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-5">
      {header}
      {body}
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
  if (mixedCurrencies) {
    return wrap(
      <section className="glass-card">
        <EmptyState title={t.dashboard.mixedCurrenciesTitle}>{t.dashboard.mixedCurrenciesText}</EmptyState>
      </section>,
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
      {notice && !editing && <div className="nt nt-ok" role="status">{notice}</div>}
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
          onChange={(patch) => setDraft(patchWidget(draft!, settingsTarget.uid, patch))}
          onClose={() => setSettingsUid(null)}
        />
      )}
      {dialog?.kind === 'save' && (
        <NameDialog
          title={b.toolbar.saveAs}
          initial={b.toolbar.nameSuggestion(layout.name)}
          submitLabel={t.common.save}
          onSubmit={async (name) => {
            await saveDraft(name)
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
      {dialog?.kind === 'new' && (
        <NameDialog
          title={b.toolbar.newDashboard}
          initial=""
          submitLabel={t.common.save}
          onSubmit={async (name) => {
            const created = await api.saveDashboardLayout(null, name, [])
            show(created)
            await refreshSummaries()
            setDialog(null)
            setDraft([])
            setLibraryOpen(true)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>,
  )
}
