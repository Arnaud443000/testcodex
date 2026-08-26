import type { Trade } from '../types/trade';
import { computeTradePnl } from './pnl';

const COLUMNS: { header: string; value: (trade: Trade) => string | number }[] = [
  { header: 'Date', value: (t) => t.date },
  { header: 'Actif', value: (t) => t.asset },
  { header: 'Sens', value: (t) => t.side },
  { header: 'Session', value: (t) => t.session },
  { header: 'Setup', value: (t) => t.setup },
  { header: 'Timeframe', value: (t) => t.timeframe },
  { header: "Prix d'entrée", value: (t) => t.entryPrice },
  { header: 'Prix de sortie', value: (t) => t.exitPrice },
  { header: 'Taille', value: (t) => t.size },
  { header: 'Stop loss', value: (t) => t.stopLoss },
  { header: 'Take profit', value: (t) => t.takeProfit },
  { header: 'Frais', value: (t) => t.fees },
  { header: 'PnL', value: (t) => computeTradePnl(t).toFixed(2) },
  { header: 'Condition de marché', value: (t) => t.marketCondition },
  { header: 'Confiance (1-10)', value: (t) => t.confidenceLevel },
  { header: 'Émotion avant', value: (t) => t.emotionBefore },
  { header: 'Émotion après', value: (t) => t.emotionAfter },
  { header: 'Plan respecté', value: (t) => (t.followedPlan ? 'oui' : 'non') },
  { header: "Note d'exécution (1-5)", value: (t) => t.executionQuality },
  { header: 'Notation (1-5)', value: (t) => t.starRating },
  { header: 'Thèse', value: (t) => t.thesis },
  { header: 'Post-mortem', value: (t) => t.postMortem },
];

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function tradesToCsv(trades: Trade[]): string {
  const header = COLUMNS.map((c) => escapeCsvField(c.header)).join(',');
  const rows = trades.map((trade) =>
    COLUMNS.map((c) => escapeCsvField(c.value(trade))).join(','),
  );
  return [header, ...rows].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
