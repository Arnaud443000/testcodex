import { useState } from 'react';
import { TradeForm } from './components/TradeForm';
import { MissedTradeForm } from './components/MissedTradeForm';

function App() {
  const [mode, setMode] = useState<'trade' | 'missed'>('trade');

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-cream">Pulse</h1>
        <button
          type="button"
          onClick={() => setMode(mode === 'trade' ? 'missed' : 'trade')}
          className="text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:text-cream"
        >
          {mode === 'trade' ? 'Trade non pris →' : '← Nouveau trade'}
        </button>
      </header>

      {mode === 'trade' ? <TradeForm /> : <MissedTradeForm />}
    </div>
  );
}

export default App;
