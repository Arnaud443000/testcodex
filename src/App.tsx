import { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { TradesPage } from './pages/TradesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';

type View = 'dashboard' | 'trades' | 'analytics';

const NAV_ITEMS: { key: View; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'trades', label: 'Trades' },
  { key: 'analytics', label: 'Analytics' },
];

const PAGES: Record<View, () => React.JSX.Element> = {
  dashboard: DashboardPage,
  trades: TradesPage,
  analytics: AnalyticsPage,
};

function App() {
  const [view, setView] = useState<View>('dashboard');
  const Page = PAGES[view];

  return (
    <div>
      <nav className="flex justify-center border-b border-white/10 bg-surface/40">
        <div className="flex gap-1 px-4 py-3">
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
      </nav>
      <Page />
    </div>
  );
}

export default App;
