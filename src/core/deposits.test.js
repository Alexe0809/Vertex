import { describe, it, expect } from 'vitest';
import { computeDepositFinalAmount, computeDepositProfit,
         depositElapsedMonths } from './deposits.js';

describe('computeDepositFinalAmount', () => {

  it('простой процент: 10000 под 14% на 12 мес = 11400', () => {
    const deposit = { amount: 10000, rate: 14, termMonths: 12, capitalization: false };
    expect(computeDepositFinalAmount(deposit)).toBeCloseTo(11400, 2);
  });

  it('капитализация: 10000 под 12% на 12 мес = 11268.25', () => {
    // 10000 * (1 + 0.12/12)^12 — проверь на калькуляторе!
    const deposit = { amount: 10000, rate: 12, termMonths: 12, capitalization: true };
    expect(computeDepositFinalAmount(deposit)).toBeCloseTo(11268.25, 2);
  });

});
describe('computeDepositProfit', () => {

  it('сумма прибыли: 10000 под 14% на 12 мес = 1400', () => {
    const deposit = { amount: 10000, rate: 14, termMonths: 12, capitalization: false };
    expect(computeDepositProfit(deposit)).toBeCloseTo(1400, 2);
  });

});
describe('depositElapsedMonths', () => {

  it('Сколько поршло месяцев с открытия депозита по данный момент: открыт 01.01.2026, сегодня 01.06.2026 => 6 мес', () => {
    const deposit = { amount: 10000, rate: 14, termMonths: 12, startDate: '2026-01-01' };
    const asOfDate = '2026-06-01';
    expect(depositElapsedMonths(deposit, asOfDate)).toBeCloseTo(4.96, 1) ;
  });

});