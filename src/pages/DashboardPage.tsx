import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useAccounts } from '../lib/accounts'

export function DashboardPage() {
  const { accounts, loading } = useAccounts()
  const hasAccount = accounts.length > 0

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" subtitle="Your trading performance at a glance" />
      <section className="glass-card">
        {loading ? null : hasAccount ? (
          <EmptyState
            title="No trades recorded yet"
            action={<Link to="/trades" className="btn btn-primary">Add your first trade</Link>}
          >
            Once you log trades, your net P&amp;L, equity curve, discipline score and insights will appear here.
          </EmptyState>
        ) : (
          <EmptyState
            title="Welcome to Pulse"
            action={<Link to="/settings" className="btn btn-primary">Create your first account</Link>}
          >
            Pulse keeps everything on this computer. Start by creating a trading account, then log your trades and the process behind them.
          </EmptyState>
        )}
      </section>
    </div>
  )
}
