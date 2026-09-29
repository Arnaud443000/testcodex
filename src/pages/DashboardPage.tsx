import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useT } from '../i18n'
import { useAccounts } from '../lib/accounts'

export function DashboardPage() {
  const { accounts, loading } = useAccounts()
  const t = useT()
  const hasAccount = accounts.length > 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />
      <section className="glass-card">
        {loading ? null : hasAccount ? (
          <EmptyState
            title={t.dashboard.noTradesTitle}
            action={<Link to="/trades" className="btn btn-primary">{t.dashboard.addFirstTrade}</Link>}
          >
            {t.dashboard.noTradesText}
          </EmptyState>
        ) : (
          <EmptyState
            title={t.dashboard.welcomeTitle}
            action={<Link to="/settings" className="btn btn-primary">{t.dashboard.createFirstAccount}</Link>}
          >
            {t.dashboard.welcomeText}
          </EmptyState>
        )}
      </section>
    </div>
  )
}
