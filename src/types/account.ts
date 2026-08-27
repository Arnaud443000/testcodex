export type AccountType = 'Personnel' | 'Prop firm' | 'Démo';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  broker: string;
  currency: string;
  initialCapital: number;
}
