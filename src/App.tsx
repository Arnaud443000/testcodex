import { HashRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { useT } from './i18n'
import { AccountsProvider } from './lib/accounts'
import { DashboardPage } from './pages/DashboardPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { TradeFormPage } from './pages/TradeFormPage'
import { TradesPage } from './pages/TradesPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  const t = useT()
  return (
    <AccountsProvider>
      <HashRouter>
        <div className="app-shell flex h-full">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div className="flex-1 overflow-y-auto px-7 py-6">
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/trades" element={<TradesPage />} />
                <Route path="/trades/new" element={<TradeFormPage />} />
                <Route path="/trades/:id" element={<TradeDetailPage />} />
                <Route path="/trades/:id/edit" element={<TradeFormPage key="edit" />} />
                <Route path="/calendar" element={<PlaceholderPage title={t.pages.calendar.title} subtitle={t.pages.calendar.subtitle} step={1} />} />
                <Route path="/analytics" element={<PlaceholderPage title={t.pages.analytics.title} subtitle={t.pages.analytics.subtitle} step={1} />} />
                <Route path="/behavior" element={<PlaceholderPage title={t.pages.behavior.title} subtitle={t.pages.behavior.subtitle} step={2} />} />
                <Route path="/journal" element={<PlaceholderPage title={t.pages.journal.title} subtitle={t.pages.journal.subtitle} step={2} />} />
                <Route path="/goals" element={<PlaceholderPage title={t.pages.goals.title} subtitle={t.pages.goals.subtitle} step={2} />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
          </main>
        </div>
      </HashRouter>
    </AccountsProvider>
  )
}
