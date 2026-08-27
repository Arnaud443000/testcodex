import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { TradesPage } from './pages/TradesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BehaviorPage } from './pages/BehaviorPage';
import { SettingsPage } from './pages/SettingsPage';
import { CalendarPage } from './pages/CalendarPage';
import { GoalsPage } from './pages/GoalsPage';
import { AccountProvider, useAccounts } from './lib/accountContext';

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

function NavButton({
  label,
  active,
  onClick,
  className = '',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-gradient-to-r from-primary to-accent text-cream shadow-[0_0_16px_-2px_rgba(139,127,232,0.6)]'
          : 'text-cream/60 hover:bg-white/5 hover:text-cream'
      } ${className}`}
    >
      {label}
    </button>
  );
}

function AccountSelector({ className = '' }: { className?: string }) {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccounts();

  return (
    <select
      value={selectedAccountId ?? ''}
      onChange={(e) => setSelectedAccountId(e.target.value || null)}
      className={`rounded-full border border-white/10 bg-surface px-3 py-1.5 text-sm text-cream transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 ${className}`}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const Page = PAGES[view];
  const activeLabel = NAV_ITEMS.find((item) => item.key === view)?.label ?? '';

  function go(key: View) {
    setView(key);
    setMenuOpen(false);
  }

  return (
    <div>
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-surface/80 backdrop-blur-md">
        {/* Mobile bar: brand + current page + hamburger toggle */}
        <div className="flex items-center justify-between px-4 py-3 sm:hidden">
          <span className="text-sm font-semibold text-cream">
            Pulse <span className="text-cream/40">·</span>{' '}
            <span className="text-cream/70">{activeLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-cream transition hover:bg-white/10"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {menuOpen && (
          <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-4 animate-slide-down sm:hidden">
            <div className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavButton
                  key={item.key}
                  label={item.label}
                  active={view === item.key}
                  onClick={() => go(item.key)}
                  className="text-left"
                />
              ))}
            </div>
            <AccountSelector className="w-full" />
          </div>
        )}

        {/* Desktop/tablet bar */}
        <div className="hidden flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex">
          <div className="flex flex-wrap gap-1">
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.key}
                label={item.label}
                active={view === item.key}
                onClick={() => go(item.key)}
              />
            ))}
          </div>
          <AccountSelector />
        </div>
      </nav>

      <div key={view} className="animate-fade-in-up">
        <Page />
      </div>
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
