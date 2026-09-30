import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { analysisSummary, formatTimeOfDay, linkableIdeas, snippet, toggleId } from '../../lib/analysisView'
import { api } from '../../lib/api'
import { useReferenceData } from '../../lib/referenceData'
import { useLocalDay } from '../../lib/useLocalDay'
import type { Analysis, IdeaLink, IdeaView, Question } from '../../types/analysis'
import { Icon } from '../Icon'
import { Checkbox } from '../ui/Checkbox'
import { useNames } from './AnalysisCard'

export interface TradeLinksDraft {
  ideaIds: number[]
  analysisIds: number[]
}

/**
 * Section repliée « Analyse et idées » du formulaire de trade : un bandeau discret (« Aucune analyse pour aujourd'hui » avec
 * un lien, ou le résumé de la dernière analyse du jour) qui s'ouvre sur les idées actives de l'actif choisi. Tout est facultatif,
 * rien ne bloque l'enregistrement. Le lien est enregistré avec le trade par la page (`setTradeLinks`).
 */
export function TradeAnalysisSection({
  instrumentId,
  editingTradeId,
  links,
  onLinks,
}: {
  instrumentId: number | null
  editingTradeId: number | null
  /** `null` tant que les liens existants ne sont pas lus : la page n'écrit rien dans ce cas. */
  links: TradeLinksDraft | null
  onLinks: (next: TradeLinksDraft | null) => void
}) {
  const t = useT()
  const a = t.analysis.tradeForm
  const { day, tz } = useLocalDay()
  const ref = useReferenceData()
  const names = useNames()
  const [open, setOpen] = useState(false)
  const [latest, setLatest] = useState<Analysis | null | undefined>(undefined)
  const [questions, setQuestions] = useState<Question[]>([])
  const [ideas, setIdeas] = useState<IdeaView[]>([])
  const [linked, setLinked] = useState<IdeaLink[]>([])
  const [failed, setFailed] = useState(false)

  // Analyse du jour, questions, et liens déjà enregistrés (trade modifié).
  useEffect(() => {
    let live = true
    Promise.all([api.listAnalysesOfDay(day), api.getAnalysisQuestions(true), editingTradeId === null ? null : api.getTradeLinks(editingTradeId)])
      .then(([today, q, existing]) => {
        if (!live) return
        const last = today.length ? today[today.length - 1] : null
        setLatest(last)
        setQuestions(q)
        setLinked(existing?.ideas ?? [])
        // Nouveau trade : l'analyse du jour est proposée cochée (décochable). Trade modifié : on garde ce qui est enregistré.
        onLinks(existing ? { ideaIds: existing.ideas.map((i) => i.id), analysisIds: existing.analyses.map((x) => x.id) } : { ideaIds: [], analysisIds: last ? [last.id] : [] })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
    // Les liens ne sont lus qu'une fois par trade et par jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, editingTradeId])

  useEffect(() => {
    if (instrumentId === null) return setIdeas([])
    let live = true
    api.listIdeas('active', instrumentId, tz).then((x) => live && setIdeas(x)).catch(() => live && setIdeas([]))
    return () => {
      live = false
    }
  }, [instrumentId, tz])

  const symbol = ref.instruments.find((i) => i.id === instrumentId)?.symbol ?? ''
  const shown = useMemo(() => linkableIdeas(ideas, linked), [ideas, linked])
  const summary = latest ? analysisSummary(latest, questions, names, ref.allTags, 3) : []

  if (failed) return <p className="text-[13px] text-tx3">{a.loadError}</p>
  if (latest === undefined) return null

  const chosen = links ?? { ideaIds: [], analysisIds: [] }
  return (
    <section className="glass-card px-5 py-3" aria-label={a.title}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <button type="button" className="flex min-h-[32px] flex-1 items-center gap-2.5 text-left" aria-expanded={open} aria-controls="trade-analysis-body" onClick={() => setOpen(!open)}>
          <span className="text-tx-accent"><Icon name="analysis" size={18} /></span>
          <span className="text-sm font-semibold">{a.title}</span>
          <span className="min-w-0 truncate text-[13px] text-tx2">
            {latest ? a.bannerLast(formatTimeOfDay(latest.createdAt, latest.tzOffsetMin)) : a.bannerNone}
          </span>
          <span className={`ml-auto text-tx3 transition ${open ? 'rotate-180' : ''}`}><Icon name="chevron" size={16} /></span>
        </button>
        {!latest && <Link className="btn-link" to="/analysis">{a.makeAnalysis}</Link>}
      </div>

      {open && (
        <div id="trade-analysis-body" className="mt-3 flex flex-col gap-4 border-t pt-3" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-xs text-tx3">{a.optional}</p>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{latest ? a.summaryLast(formatTimeOfDay(latest.createdAt, latest.tzOffsetMin)) : a.summaryNone}</h3>
            {latest ? (
              <>
                <ul className="flex flex-col gap-1 text-[13px]">
                  {summary.map((s) => (
                    <li key={s.label}><span className="text-tx3">{s.label}{' '}: </span>{snippet(s.lines.join(' '), 140)}</li>
                  ))}
                </ul>
                <Checkbox
                  label={a.followAnalysis}
                  checked={chosen.analysisIds.includes(latest.id)}
                  onChange={(on) => onLinks({ ...chosen, analysisIds: toggleId(chosen.analysisIds, latest.id, on) })}
                />
                <Link className="btn-link self-start" to="/analysis">{a.readAnalysis}</Link>
              </>
            ) : (
              <Link className="btn-link self-start" to="/analysis">{a.makeAnalysis}</Link>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{symbol ? a.ideasTitle(symbol) : a.ideasChooseAsset}</h3>
            {shown.length === 0 && symbol && <p className="text-[13px] text-tx3">{a.ideasNone}</p>}
            {shown.map((i) => (
              <div key={i.id} className="flex flex-col gap-0.5">
                <Checkbox
                  label={`${a.followIdea}${i.source === 'linked' ? ` (${i.symbol}${i.closed ? `, ${a.closedLinked.toLowerCase()}` : ''})` : ''}`}
                  description={snippet(i.note, 120)}
                  checked={chosen.ideaIds.includes(i.id)}
                  onChange={(on) => onLinks({ ...chosen, ideaIds: toggleId(chosen.ideaIds, i.id, on) })}
                />
              </div>
            ))}
            {symbol && (
              <Link className="btn-link self-start" to={`/analysis?tab=ideas&new=1&instrument=${instrumentId}`}>{a.newIdea}</Link>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
