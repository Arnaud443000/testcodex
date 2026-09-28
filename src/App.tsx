import { HashRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AccountsProvider } from './lib/accounts'
import { DashboardPage } from './pages/DashboardPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
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
                <Route path="/trades" element={<PlaceholderPage title="Trades" subtitle="Every trade, with the process behind it" step={1} />} />
                <Route path="/calendar" element={<PlaceholderPage title="Calendar" subtitle="P&L day by day" step={1} />} />
                <Route path="/analytics" element={<PlaceholderPage title="Analytics" subtitle="Performance by setup, asset, day and hour" step={1} />} />
                <Route path="/behavior" element={<PlaceholderPage title="Behavior" subtitle="What your process says about your results" step={2} />} />
                <Route path="/journal" element={<PlaceholderPage title="Journal" subtitle="Daily reflection" step={2} />} />
                <Route path="/goals" element={<PlaceholderPage title="Goals" subtitle="Monthly targets" step={2} />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>
          </main>
        </div>
      </HashRouter>
    </AccountsProvider>
  )
}
