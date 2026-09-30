import { useSearchParams } from 'react-router-dom'
import { ArchivesTab } from '../components/analysis/ArchivesTab'
import { IdeasTab } from '../components/analysis/IdeasTab'
import { SessionTab } from '../components/analysis/SessionTab'
import { PageHeader } from '../components/PageHeader'
import { Segmented } from '../components/ui'
import { useT } from '../i18n'

type Tab = 'session' | 'ideas' | 'archives'
const TABS: Tab[] = ['session', 'ideas', 'archives']

/**
 * Analyse avant trading (lot 31) : trois onglets. Séance (le formulaire du jour), Idées (à surveiller, revue du matin),
 * Archives (idées clôturées, analyses passées). L'onglet se choisit dans l'adresse (`?tab=ideas`) : la bannière de la
 * revue du matin y mène. Que des règles déterministes, aucune IA, rien n'est envoyé nulle part.
 */
export function AnalysisPage() {
  const t = useT()
  const a = t.analysis
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'session'
  const instrument = Number(params.get('instrument'))
  const choose = (next: Tab) => setParams(next === 'session' ? {} : { tab: next }, { replace: true })
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={a.title} subtitle={a.subtitle} />
      <div className="max-w-[520px]">
        <Segmented<Tab> label={a.tabsLabel} value={tab} onChange={(v) => choose(v ?? 'session')} options={TABS.map((k) => ({ value: k, label: a.tabs[k] }))} />
      </div>
      <div className="flex flex-col gap-5">
        {tab === 'session' && <SessionTab />}
        {tab === 'ideas' && <IdeasTab initialInstrumentId={Number.isFinite(instrument) && instrument > 0 ? instrument : null} openNew={params.get('new') === '1'} />}
        {tab === 'archives' && <ArchivesTab />}
      </div>
    </div>
  )
}
