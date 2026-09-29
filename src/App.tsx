import { HashRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AccountsProvider } from './lib/accounts'
import { PeriodProvider } from './lib/period'
import { ReminderBanner } from './components/ReminderBanner'
import { AlertBanner } from './components/AlertBanner'
import { DisciplinePage } from './pages/DisciplinePage'
import { BehaviorPage } from './pages/BehaviorPage'
import { CalendarPage } from './pages/CalendarPage'
import { DashboardPage } from './pages/DashboardPage'
import { GoalsPage } from './pages/GoalsPage'
import { JournalPage } from './pages/JournalPage'
import { AlertHistoryPage } from './pages/AlertHistoryPage'
import { AnalysesPage } from './pages/AnalysesPage'
import { ReplayPage } from './pages/ReplayPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { TradeFormPage } from './pages/TradeFormPage'
import { TradesPage } from './pages/TradesPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <AccountsProvider>
      <PeriodProvider>
      <HashRouter>
        <div className="app-shell flex h-full">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div className="flex-1 overflow-y-auto px-7 py-6">
              {/* Largeur max du contenu : au-delà, les grilles s’étireraient et les cartes se déséquilibreraient. */}
              <div className="mx-auto w-full max-w-[1480px]">
              <AlertBanner />
              <ReminderBanner />
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/trades" element={<TradesPage />} />
                <Route path="/trades/new" element={<TradeFormPage />} />
                <Route path="/trades/:id" element={<TradeDetailPage />} />
                <Route path="/trades/:id/edit" element={<TradeFormPage key="edit" />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/analytics" element={<AnalysesPage />} />
                <Route path="/behavior" element={<BehaviorPage />} />
                <Route path="/discipline" element={<DisciplinePage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/replay" element={<ReplayPage />} />
                <Route path="/alerts" element={<AlertHistoryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
              </div>
            </div>
          </main>
        </div>
      </HashRouter>
      </PeriodProvider>
    </AccountsProvider>
  )
}
