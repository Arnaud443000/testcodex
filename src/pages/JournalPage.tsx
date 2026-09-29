import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { InsightsPanel } from '../components/InsightsPanel'
import { JournalDayPanel } from '../components/JournalDayPanel'
import { MissedTradesPanel } from '../components/MissedTradesPanel'
import { PageHeader } from '../components/PageHeader'
import { Segmented } from '../components/ui'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'

type Tab = 'day' | 'missed' | 'insights'

/** Journal : réflexion quotidienne, trades manqués, qualité d'exécution et confiance (cahier 3.2.5 à 3.2.9, 3.1.9). */
export function JournalPage() {
  const t = useT()
  const { accounts, loading } = useAccounts()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>('day')
  const day = params.get('day') ?? undefined

  const header = <PageHeader title={t.pages.journal.title} subtitle={t.pages.journal.subtitle} />
  if (loading) return <div className="flex flex-col gap-5">{header}</div>
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <section className="glass-card">
          <EmptyState title={t.common.noAccountTitle} action={<Link to="/settings" className="btn btn-primary">{t.common.createAccount}</Link>}>
            {t.journalPage.noAccountText}
          </EmptyState>
        </section>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="max-w-[640px]">
        <Segmented
          label={t.pages.journal.title}
          value={tab}
          onChange={(v) => v && setTab(v)}
          options={[
            { value: 'day', label: t.journalPage.tabs.day },
            { value: 'missed', label: t.journalPage.tabs.missed },
            { value: 'insights', label: t.journalPage.tabs.insights },
          ]}
        />
      </div>
      {tab === 'day' && <JournalDayPanel initialDay={day} />}
      {tab === 'missed' && <MissedTradesPanel />}
      {tab === 'insights' && <InsightsPanel />}
    </div>
  )
}
