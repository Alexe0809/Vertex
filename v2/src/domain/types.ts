/**
 * Доменные типы Vertex.
 * Единый источник правды о форме данных — всё остальное приложение
 * опирается на эти типы, а TypeScript следит, чтобы никто их не нарушил.
 */

/** Валюты, с которыми работает приложение. */
export type Currency = 'BYN' | 'USD' | 'EUR' | 'RUB' | 'CNY';

/** Классы активов. */
export type AssetClass = 'cash' | 'crypto' | 'stocks' | 'metals' | 'deposit' | 'lent';

/** Типы транзакций (двойная запись для переводов). */
export type TxKind = 'income' | 'expense' | 'invest' | 'divest' | 'transfer';

/** Курсы валют к BYN. BYN всегда 1. */
export type Rates = Record<string, number>;

export interface Transaction {
  id: string;
  date: string;          // ISO: YYYY-MM-DD
  kind: TxKind;
  amount: number;        // в валюте транзакции
  currency: Currency;
  rate: number;          // курс к BYN на момент операции
  category?: string;
  note?: string;
  assetId?: string;
  linkedId?: string;     // вторая нога перевода
}

export interface Asset {
  id: string;
  name: string;
  ticker?: string;
  class: AssetClass;
  currency: Currency;
  quantity: number;      // производное поле: пересчитывается из транзакций
  priceBYN: number;
  invested?: number;
  divested?: number;
  roi?: number;
  xirr?: number | null;
}

export interface Deposit {
  id: string;
  bank?: string;
  amount: number;
  currency: Currency;
  rate: number;          // годовая ставка в процентах, напр. 14.14
  termMonths: number;
  startDate: string;     // ISO
  capitalization: boolean;
  closed?: boolean;
  closeValue?: number;
}

export interface Snapshot {
  id: string;
  date: string;
  totalBYN: number;
  byClass: Partial<Record<AssetClass, number>>;
}

/** Денежный поток для XIRR: отрицательный — вложение, положительный — возврат. */
export interface CashFlow {
  date: string;
  amount: number;
}