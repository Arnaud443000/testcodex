export interface Deposit {
  id: string;
  accountId: string;
  date: string;
  /** Positive = dépôt, négatif = retrait. */
  amount: number;
  note?: string;
}
