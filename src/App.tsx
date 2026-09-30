import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AccountsProvider } from './lib/accounts'
import { PeriodProvider } from './lib/period'
import { ReminderBanner } from './components/ReminderBanner'
import { AlertBanner } from './components/AlertBanner'
import { InsightsProvider } from './lib/insights'
import { PauseProvider } from './lib/pause'
import { PauseSuggestionBanner } from './components/pause/PauseSuggestionBanner'
import { InsightsPage } from './pages/InsightsPage'
import { DisciplinePage } from './pages/DisciplinePage'
import { BehaviorPage } from './pages/BehaviorPage'
import { CalendarPage } from './pages/CalendarPage'
import { DashboardPage } from './pages/DashboardPage'
import { GoalsPage } from './pages/GoalsPage'
import { JournalPage } from './pages/JournalPage'
import { AlertHistoryPage } from './pages/AlertHistoryPage'
import { ComparisonsPage } from './pages/ComparisonsPage'
import { AnalysesPage } from './pages/AnalysesPage'
import { ReplayPage } from './pages/ReplayPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { TradeFormPage } from './pages/TradeFormPage'
import { TradesPage } from './pages/TradesPage'
import { SettingsPage } from './pages/SettingsPage'
import { CoachPage } from './pages/CoachPage'
import { SizingPage } from './pages/SizingPage'
import { EconomicCalendarPage } from './pages/EconomicCalendarPage'
import { NewsAutoRefresh } from './lib/newsAutoRefresh'
import { LockProvider, useLock } from './lib/lock'
import { LockScreen, LockSplash } from './components/LockScreen'
import { LockWarningBanner, PersistBanner } from './components/PersistBanner'
import { EffectsProvider } from './lib/effects'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Lot 22 : tant que la base chiffrée n'est pas ouverte, seul l'écran de déverrouillage existe ; aucun
 * fournisseur de données n'est monté (donc aucune requête). Un nouveau verrouillage démonte toute
 * l'application : les données affichées quittent l'interface.
 */
function LockGate({ children }: { children: ReactNode }) {
  const { status } = useLock()
  if (!status) return <LockSplash />
  if (status.locked) return <LockScreen />
  return <>{children}</>
}

/**
 * Zone de contenu qui défile. Un changement de page la remet en haut (avant le lot 26, elle gardait la position de la
 * page précédente : une page ouverte après une longue page s'affichait décalée, titre hors de vue). Un simple
 * changement de paramètre ou d'ancre dans la même page ne la déplace pas.
 */
function ScrollArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
  }, [pathname])
  return (
    // `relative` : les éléments en position absolue (textes pour lecteur d'écran…) restent dans la zone qui défile ;
    // sans lui, ils allongeaient le document et un scrollIntoView ou un focus clavier décalait toute la coque.
    <div ref={ref} className="relative flex-1 overflow-y-auto px-7 py-6">
      {children}
    </div>
  )
}

export default function App() {
  return (
    <EffectsProvider>
    <LockProvider>
    <LockGate>
    <AccountsProvider>
      <PeriodProvider>
      <HashRouter>
        <InsightsProvider>
        <PauseProvider>
        <div className="app-shell flex h-full">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <ScrollArea>
              {/* Largeur max du contenu : au-delà, les grilles s’étireraient et les cartes se déséquilibreraient. */}
              <div className="mx-auto w-full max-w-[1480px]">
              <PersistBanner />
              <LockWarningBanner />
              <NewsAutoRefresh />
              <AlertBanner />
              <PauseSuggestionBanner />
              <ReminderBanner />
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/trades" element={<TradesPage />} />
                <Route path="/trades/new" element={<TradeFormPage />} />
                <Route path="/trades/:id" element={<TradeDetailPage />} />
                <Route path="/trades/:id/edit" element={<TradeFormPage key="edit" />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/calendar/news" element={<EconomicCalendarPage />} />
                <Route path="/analytics" element={<AnalysesPage />} />
                <Route path="/comparisons" element={<ComparisonsPage />} />
                <Route path="/behavior" element={<BehaviorPage />} />
                <Route path="/discipline" element={<DisciplinePage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/replay" element={<ReplayPage />} />
                <Route path="/alerts" element={<AlertHistoryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/coach" element={<CoachPage />} />
                <Route path="/sizing" element={<SizingPage />} />
              </Routes>
              </div>
            </ScrollArea>
          </main>
        </div>
        </PauseProvider>
        </InsightsProvider>
      </HashRouter>
      </PeriodProvider>
    </AccountsProvider>
    </LockGate>
    </LockProvider>
    </EffectsProvider>
  )
}
