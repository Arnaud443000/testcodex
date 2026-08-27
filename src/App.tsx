import { DashboardPage } from './pages/DashboardPage';
import { TradesPage } from './pages/TradesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BehaviorPage } from './pages/BehaviorPage';
import { SettingsPage } from './pages/SettingsPage';
import { CalendarPage } from './pages/CalendarPage';
import { GoalsPage } from './pages/GoalsPage';
import { AccountProvider, useAccounts } from './lib/accountContext';
import { useState } from 'react';

type View = 'dashboard' | 'trades' | 'analytics' | 'behavior' | 'calendar' | 'goals' | 'settings';

const NAV_ITEMS: { key: View; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'trades', label: 'Trades' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'behavior', label: 'Comportement' },
  { key: 'calendar', label: 'Calendrier' },
  { key: 'goals', label: 'Objectifs' },
  { key: 'settings', label: 'Réglages' },
];

const PAGES: Record<View, () => React.JSX.Element> = {
  dashboard: DashboardPage,
  trades: TradesPage,
  analytics: AnalyticsPage,
  behavior: BehaviorPage,
  calendar: CalendarPage,
  goals: GoalsPage,
  settings: SettingsPage,
};

function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccounts();

  return (
    <select
      value={selectedAccountId ?? ''}
      onChange={(e) => setSelectedAccountId(e.target.value || null)}
      className="rounded-full border border-white/10 bg-surface px-3 py-1.5 text-sm text-cream"
      aria-label="Compte affiché"
    >
      <option value="">Tous les comptes</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </select>
  );
}

function AppShell() {
  const [view, setView] = useState<View>('dashboard');
  const Page = PAGES[view];

  return (
    <div>
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                view === item.key
                  ? 'bg-gradient-to-r from-primary to-accent text-cream'
                  : 'text-cream/60 hover:text-cream'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <AccountSelector />
      </nav>
      <Page />
    </div>
  );
}

function App() {
  return (
    <AccountProvider>
      <AppShell />
    </AccountProvider>
  );
}

export default App;
