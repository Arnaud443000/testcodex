import { useState } from 'react'
import { useT } from '../../i18n'
import { formatDate, formatR } from '../../lib/format'
import type { BacktestCase } from '../../types/backtest'
import { EmptyState } from '../EmptyState'
import { Th } from '../analyses/parts'

const rText = (v: string | null) => (v === null ? '—' : formatR(Number(v), 1))

/** Liste des cas, du plus récent au plus ancien. Les R sont des valeurs saisies : on les affiche, sans les recalculer. */
export function CasesTable({ cases, onEdit, onDelete }: { cases: BacktestCase[]; onEdit: (c: BacktestCase) => void; onDelete: (id: number) => Promise<void> }) {
  const t = useT().backtest
  const f = t.caseForm
  const c = t.cases
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const rows = [...cases].reverse()
  return (
    <section className="glass-card overflow-hidden" aria-label={c.title}>
      <div className="px-6 pt-5">
        <h2 className="text-[15px] font-semibold">{c.title} <span className="text-tx3">· {cases.length}</span></h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={c.title}>{c.empty}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <Th label={c.columns.date} />
                <Th label={c.columns.direction} />
                <Th label={c.columns.observation} />
                <Th label={c.columns.valid} />
                <Th label={c.columns.outcome} />
                <Th label={c.columns.planned} align="right" />
                <Th label={c.columns.result} align="right" />
                <Th label={c.columns.max} align="right" />
                <Th label={c.columns.actions} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const date = formatDate(x.occurredAt)
                return (
                  <tr key={x.id} className="h-[48px] border-t" style={{ borderColor: 'var(--hairline)' }}>
                    <td className="px-3 tabular-nums">{date}</td>
                    <td className="px-3 text-tx2">{x.direction === 'long' ? f.long : x.direction === 'short' ? f.short : '—'}</td>
                    <td className="px-3 text-tx2">{f.observations[x.observation]}</td>
                    <td className="px-3"><span className={`badge ${x.setupValid === 'yes' ? 'badge-gain' : x.setupValid === 'no' ? 'badge-loss' : 'badge-warn'}`}>{f.validities[x.setupValid]}</span></td>
                    <td className="px-3">{f.outcomes[x.outcome]}</td>
                    <td className="px-3 text-right tabular-nums text-tx2">{x.plannedRr === null ? '—' : `${Number(x.plannedRr).toLocaleString('fr-FR')} R`}</td>
                    <td className="px-3 text-right font-semibold tabular-nums">{rText(x.resultR)}</td>
                    <td className="px-3 text-right tabular-nums text-tx2">{x.maxR === null ? '—' : `${Number(x.maxR).toLocaleString('fr-FR')} R`}</td>
                    <td className="px-3 text-right">
                      {confirmId === x.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-tx2">{c.deleteConfirm}</span>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => void onDelete(x.id).then(() => setConfirmId(null))}>{c.deleteYes}</button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmId(null)}>{c.no}</button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-3">
                          <button type="button" className="btn-link" aria-label={c.editCase(date)} onClick={() => onEdit(x)}>{c.edit}</button>
                          <button type="button" className="btn-link !text-loss" aria-label={c.deleteCase(date)} onClick={() => setConfirmId(x.id)}>{c.delete}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
