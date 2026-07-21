import type { Deposit, Rates } from './types';

/** Средняя длина месяца: 365.25 / 12 — учитывает високосные годы. */
export const AVG_DAYS_PER_MONTH = 30.4368;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * AVG_DAYS_PER_MONTH;

/**
 * Сколько месяцев вклад пролежал на дату `asOf`.
 * Обрезается сверху сроком вклада: после окончания проценты не растут.
 */
export function depositElapsedMonths(deposit: Deposit, asOf: Date | string = new Date()): number {
  const start = new Date(deposit.startDate).getTime();
  const now = new Date(asOf).getTime();
  let elapsed = (now - start) / MS_PER_MONTH;
  if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
  return Math.min(elapsed, deposit.termMonths);
}

/** Закончился ли срок вклада. */
export function isDepositMatured(deposit: Deposit, asOf: Date | string = new Date()): boolean {
  return depositElapsedMonths(deposit, asOf) >= deposit.termMonths;
}

/**
 * Накопленная сумма на дату (тело + начисленные проценты).
 * Капитализация дискретна: проценты присоединяются раз в месяц,
 * за неполный месяц — простой процент на накопленную базу.
 */
export function computeDepositAccruedValue(deposit: Deposit, asOf: Date | string = new Date()): number {
  const rate = deposit.rate / 100;
  const months = depositElapsedMonths(deposit, asOf);
  const principal = deposit.amount;

  if (deposit.capitalization) {
    const monthlyRate = rate / 12;
    const whole = Math.floor(months);
    const frac = months - whole;
    return principal * Math.pow(1 + monthlyRate, whole) * (1 + monthlyRate * frac);
  }
  return principal * (1 + (rate * months) / 12);
}

/** Сумма на конец срока. */
export function computeDepositFinalAmount(deposit: Deposit): number {
  const rate = deposit.rate / 100;
  const { termMonths: months, amount: principal } = deposit;

  if (deposit.capitalization) {
    return principal * Math.pow(1 + rate / 12, months);
  }
  return principal * (1 + (rate * months) / 12);
}

/** Прибыль за весь срок. */
export function computeDepositProfit(deposit: Deposit): number {
  return computeDepositFinalAmount(deposit) - deposit.amount;
}

export interface DepositsTotalOptions {
  /** Считать только тело вклада, без накопленных процентов. */
  principalOnly?: boolean;
  asOf?: Date | string;
}

/**
 * Суммарная стоимость открытых вкладов в BYN.
 * Закрытые исключаются: их деньги уже вернулись в кэш (иначе двойной счёт).
 */
export function computeDepositsTotal(
  deposits: readonly Deposit[],
  rates: Rates,
  options: DepositsTotalOptions = {},
): number {
  const { principalOnly = false, asOf = new Date() } = options;

  return deposits.reduce((total, d) => {
    if (d.closed) return total;
    const value = principalOnly ? d.amount : computeDepositAccruedValue(d, asOf);
    return total + value * rateFor(d.currency, rates);
  }, 0);
}

/** Суммарные накопленные проценты по открытым вкладам, в BYN. */
export function computeDepositsTotalProfit(
  deposits: readonly Deposit[],
  rates: Rates,
  asOf: Date | string = new Date(),
): number {
  return deposits.reduce((total, d) => {
    if (d.closed) return total;
    const profit = computeDepositAccruedValue(d, asOf) - d.amount;
    return total + profit * rateFor(d.currency, rates);
  }, 0);
}

/** Курс валюты к BYN. Вынесен сюда, чтобы модуль оставался чистым. */
function rateFor(currency: string, rates: Rates): number {
  if (currency === 'BYN') return 1;
  return rates[currency] ?? 1;
}