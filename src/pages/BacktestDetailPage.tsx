import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { CaseForm } from '../components/backtest/CaseForm'
import { CasesTable } from '../components/backtest/CasesTable'
import { ReportView } from '../components/backtest/ReportView'
import { SessionForm } from '../components/backtest/SessionForm'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { draftFromCase, draftFromSession, emptyCaseDraft } from '../lib/backtestForm'
import { useReferenceData } from '../lib/referenceData'
import type { Backtest, BacktestCase, BacktestReport } from '../types/backtest'

const statusBadge = { running: 'badge-warn', validated: 'badge-gain', rejected: 'badge-loss' } as const

function TextBlock({ label, text, none }: { label: string; text: string; none: string }) {
  return (
    <div className="min-w-0">
      <h3 className="caption">{label}</h3>
      <p className={`mt-1.5 whitespace-pre-wrap text-sm leading-relaxed ${text ? '' : 'text-tx3'}`}>{text || none}</p>
    </div>
  )
}

/** Un backtest : la stratégie, la saisie des cas, la liste des cas et les résultats. */
export function BacktestDetailPage() {
  const t = useT()
  const b = t.backtest
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const ref = useReferenceData()
  const [session, setSession] = useState<Backtest | null>(null)
  const [cases, setCases] = useState<BacktestCase[]>([])
  const [report, setReport] = useState<BacktestReport | null>(null)
  const [includeDoubtful, setIncludeDoubtful] = useState(false)
  const [editingSession, setEditingSession] = useState(false)
  const [editingCase, setEditingCase] = useState<BacktestCase | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, rows, rep] = await Promise.all([api.listBacktests(), api.listBacktestCases(id), api.getBacktestReport(id, { includeDoubtful })])
      const found = list.find((x) => x.id === id)
      if (!found) return setMissing(true)
      setSession(found)
      setCases(rows)
      setReport(rep)
      setError(null)
    } catch {
      setMissing(true)
    }
  }, [id, includeDoubtful])
  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      await load()
    } catch (e) {
      setError(b.saveError(String(e instanceof Error ? e.message : e)))
    }
  }

  const setups = ref.tags.filter((tag) => tag.kind === 'setup')
  const back = <Link to="/backtest" className="btn-link">{b.backToList}</Link>

  if (missing) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <section className="glass-card"><EmptyState title={b.detail.notFound}>{b.intro}</EmptyState></section>
      </div>
    )
  }
  if (!session) return <div className="flex flex-col gap-5">{back}</div>

  return (
    <div className="flex flex-col gap-5">
      {back}
      <PageHeader
        title={session.name}
        subtitle={b.detail.marketLine(session.asset, session.timeframe) || undefined}
        actions={<span className={`badge ${statusBadge[session.status]}`}>{b.status[session.status]}</span>}
      />
      {error && <div className="nt nt-bad" role="alert">{error}</div>}

      {editingSession ? (
        <SessionForm
          initial={draftFromSession(session)}
          setups={setups}
          submitLabel={b.session.save}
          onCancel={() => setEditingSession(false)}
          onSubmit={async (data) => {
            await api.updateBacktest(session.id, data)
            setEditingSession(false)
            await load()
          }}
        />
      ) : (
        <section className="glass-card flex flex-col gap-4 px-6 py-5" aria-label={b.session.formTitle}>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <TextBlock label={b.session.conditions} text={session.entryConditions} none={b.session.none} />
            <TextBlock label={b.session.exits} text={session.exitRules} none={b.session.none} />
          </div>
          {session.notes && <TextBlock label={b.session.notes} text={session.notes} none={b.session.none} />}
          <div className="flex flex-wrap items-center gap-4 text-[13px]">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSession(true)}>{b.session.edit}</button>
            {confirmDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-tx2">{b.session.deleteConfirm(cases.length)}</span>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void api.deleteBacktest(session.id).then(() => navigate('/backtest'))}>{b.session.deleteYes}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>{b.session.cancel}</button>
              </span>
            ) : (
              <button type="button" className="btn-link !text-loss" onClick={() => setConfirmDelete(true)}>{b.session.delete}</button>
            )}
          </div>
        </section>
      )}

      <CaseForm
        key={editingCase?.id ?? 'new'}
        initial={editingCase ? draftFromCase(editingCase) : emptyCaseDraft()}
        editing={editingCase !== null}
        onCancel={editingCase ? () => setEditingCase(null) : undefined}
        onSubmit={async (data) => {
          if (editingCase) await api.updateBacktestCase(editingCase.id, data)
          else await api.addBacktestCase(session.id, data)
          setEditingCase(null)
          await load()
        }}
      />

      <CasesTable
        cases={cases}
        onEdit={(c) => {
          setEditingCase(c)
          window.scrollTo?.({ top: 0 })
        }}
        onDelete={(cid) => run(() => api.deleteBacktestCase(cid))}
      />

      {report && <ReportView report={report} includeDoubtful={includeDoubtful} onIncludeDoubtful={setIncludeDoubtful} />}
    </div>
  )
}
