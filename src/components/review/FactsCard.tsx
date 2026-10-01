import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import { formatR, formatRatioPercent } from '../../lib/format'
import { formatLoss, formatScore } from '../../lib/behaviorFormat'
import { tradesHref } from '../../lib/idsFilter'
import { goalSentence, valueText } from '../../lib/processGoalsView'
import { reasonText } from '../../lib/reviewView'
import type { Fact, WeeklyReviewView } from '../../types/review'
import { ProcessStatusBadge } from '../goals/ProcessGoals'
import { Pnl } from '../ui'

/** Une ligne de fait : libellé, valeur (ou « — » avec sa raison), lien facultatif. */
function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 border-b py-3 first:pt-0 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--hairline)' }} data-fact={testId}>
      <p className="caption">{label}</p>
      <div className="min-w-0 text-[15px]">{children}</div>
    </li>
  )
}

/** « — » + la raison : la valeur n'existe pas, ce n'est jamais zéro. */
function Missing({ reason }: { reason: string }) {
  return (
    <p className="text-sm text-tx2">
      <span className="text-[17px] font-semibold text-tx3">—</span> <span className="text-[13px]">{reason}</span>
    </p>
  )
}

const value = (v: ReactNode) => <strong className="text-[17px] font-semibold tabular-nums">{v}</strong>

/**
 * Les faits de la semaine : une ligne par fait, calculés par pulse-core (aucune formule ici). Un fait indisponible
 * montre « — » et pourquoi ; un décompte à zéro (pauses, idées, jours de journal) est un vrai zéro.
 */
export function FactsCard({ view }: { view: WeeklyReviewView }) {
  const t = useT()
  const r = t.review
  const f = view.facts
  const currency = view.currency ?? ''
  const reason = (fact: Fact<unknown>) => reasonText(r, fact.reason, f)
  const mistake = f.costlyMistake.value
  const mistakeHref = mistake ? tradesHref(mistake.tradeIds) : null

  return (
    <section className="glass-card flex flex-col gap-4 px-6 py-5" aria-labelledby="review-facts-title" data-testid="review-facts">
      <div>
        <h2 id="review-facts-title" className="text-base font-semibold">{r.facts.title}</h2>
        <p className="mt-1 max-w-[70ch] text-xs text-tx3">{r.facts.note}</p>
      </div>
      <ul className="flex flex-col">
        <Row label={r.facts.labels.closedTrades} testId="closedTrades">
          {value(r.facts.closedTradesValue(f.closedTradeCount))}
        </Row>
        <Row label={r.facts.labels.netPnl} testId="netPnl">
          {f.netPnl.value !== null ? <span className="text-[17px] font-semibold tabular-nums"><Pnl value={f.netPnl.value} currency={currency} /></span> : <Missing reason={reason(f.netPnl)} />}
        </Row>
        <Row label={r.facts.labels.winRate} testId="winRate">
          {f.winRate.value !== null ? value(formatRatioPercent(f.winRate.value)) : <Missing reason={reason(f.winRate)} />}
        </Row>
        <Row label={r.facts.labels.expectancy} testId="expectancy">
          {f.expectancyR.value !== null ? value(formatR(f.expectancyR.value, 2)) : <Missing reason={reason(f.expectancyR)} />}
        </Row>
        <Row label={r.facts.labels.discipline} testId="discipline">
          {f.discipline.value !== null ? value(r.facts.disciplineValue(formatScore(f.discipline.value))) : <Missing reason={reason(f.discipline)} />}
        </Row>
        <Row label={r.facts.labels.goals} testId="goals">
          {f.goals.value ? (
            <ul className="flex flex-col gap-2">
              {f.goals.value.map((g) => (
                <li key={g.goal.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 text-sm">
                    {goalSentence(t.processGoals, g.goal.metric, g.goal.target)}
                    <span className="ml-2 text-tx2 tabular-nums">({valueText(t.processGoals, g)})</span>
                  </span>
                  <ProcessStatusBadge p={g} />
                </li>
              ))}
            </ul>
          ) : (
            <Missing reason={reason(f.goals)} />
          )}
          <Link to="/goals?type=process&kind=week" className="btn-link mt-1 inline-block text-[13px]">{r.facts.seeGoals}</Link>
        </Row>
        <Row label={r.facts.labels.pauses} testId="pauses">
          <p className="text-sm text-tx">{r.facts.pausesValue(f.pauseCount, f.tradesDuringPause)}</p>
        </Row>
        <Row label={r.facts.labels.ideas} testId="ideas">
          <p className="text-sm text-tx">
            {r.facts.ideasValue(f.ideasClosed)}
            {f.ideasToReview.value !== null && <span className="text-tx2">, {r.facts.ideasToReview(f.ideasToReview.value)}</span>}
          </p>
          {f.ideasToReview.value === null && <p className="text-[13px] text-tx3">{reason(f.ideasToReview)}</p>}
        </Row>
        <Row label={r.facts.labels.mistake} testId="mistake">
          {mistake ? (
            <>
              <p className="text-sm">
                {r.facts.mistakeValue(mistake.label, mistake.tradeCount)}
                <span className="ml-2 font-semibold tabular-nums text-loss">{formatLoss(mistake.cost, currency)}</span>
              </p>
              {mistakeHref && <Link to={mistakeHref} className="btn-link mt-1 inline-block text-[13px]">{r.facts.seeTrades}</Link>}
            </>
          ) : (
            <Missing reason={reason(f.costlyMistake)} />
          )}
        </Row>
        <Row label={r.facts.labels.journal} testId="journal">
          <p className="text-sm text-tx">{r.facts.journalValue(f.journalDays)}</p>
        </Row>
      </ul>
    </section>
  )
}
