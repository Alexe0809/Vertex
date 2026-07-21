import { describe, it, expect } from 'vitest';
import {
  depositElapsedMonths,
  isDepositMatured,
  computeDepositAccruedValue,
  computeDepositFinalAmount,
  computeDepositProfit,
  computeDepositsTotal,
  computeDepositsTotalProfit,
} from '../deposits';
import type { Deposit } from '../types';

/** Базовый вклад: 10 000 BYN под 14% на 12 месяцев, без капитализации. */
const simple: Deposit = {
  id: 'd1',
  amount: 10000,
  currency: 'BYN',
  rate: 14,
  termMonths: 12,
  startDate: '2026-01-01',
  capitalization: false,
};

const compound: Deposit = { ...simple, id: 'd2', rate: 12, capitalization: true };

describe('depositElapsedMonths', () => {
  it('в день открытия прошло 0 месяцев', () => {
    expect(depositElapsedMonths(simple, '2026-01-01')).toBe(0);
  });

  it('с 1 января по 1 июня — около 5 месяцев', () => {
    expect(depositElapsedMonths(simple, '2026-06-01')).toBeCloseTo(5, 0);
  });

  it('после окончания срока обрезается сроком вклада', () => {
    expect(depositElapsedMonths(simple, '2028-01-01')).toBe(12);
  });

  it('дата открытия в будущем даёт 0, а не отрицательное', () => {
    expect(depositElapsedMonths(simple, '2025-06-01')).toBe(0);
  });

  it('битая дата не ломает расчёт (защита от NaN)', () => {
    expect(depositElapsedMonths({ ...simple, startDate: 'не дата' })).toBe(0);
  });
});

describe('isDepositMatured', () => {
  it('в середине срока — ещё не закрыт', () => {
    expect(isDepositMatured(simple, '2026-06-01')).toBe(false);
  });
  it('после срока — закрыт', () => {
    expect(isDepositMatured(simple, '2027-02-01')).toBe(true);
  });
});

describe('computeDepositFinalAmount', () => {
  it('простой процент: 10000 под 14% на год → 11400', () => {
    expect(computeDepositFinalAmount(simple)).toBeCloseTo(11400, 2);
  });

  it('капитализация: 10000 под 12% на год → 11268.25', () => {
    expect(computeDepositFinalAmount(compound)).toBeCloseTo(11268.25, 2);
  });

  it('капитализация выгоднее простого процента при равной ставке', () => {
    const a = computeDepositFinalAmount({ ...simple, capitalization: true });
    const b = computeDepositFinalAmount(simple);
    expect(a).toBeGreaterThan(b);
  });
});

describe('computeDepositProfit', () => {
  it('прибыль = финальная сумма минус тело', () => {
    expect(computeDepositProfit(simple)).toBeCloseTo(1400, 2);
  });
});

describe('computeDepositAccruedValue', () => {
  it('в день открытия равна телу вклада', () => {
    expect(computeDepositAccruedValue(simple, '2026-01-01')).toBeCloseTo(10000, 2);
  });

  it('к концу срока сходится с финальной суммой', () => {
    // Берём дату заведомо после срока: счётчик месяцев упрётся в termMonths.
    expect(computeDepositAccruedValue(simple, '2027-03-01')).toBeCloseTo(
      computeDepositFinalAmount(simple), 2,
    );
  });

  it('после окончания срока не растёт дальше', () => {
    const atEnd = computeDepositAccruedValue(simple, '2027-03-01');
    const muchLater = computeDepositAccruedValue(simple, '2030-01-01');
    expect(muchLater).toBeCloseTo(atEnd, 6);
  });

  it('документированная неточность: календарный год ≈ 11.99 "средних" месяца', () => {
    // Месяц считается как 365.25/12 дней, поэтому в календарную годовщину
    // накоплено чуть меньше финальной суммы. Расхождение < 0.01% — допустимо,
    // но зафиксировано тестом, чтобы изменение формулы было замечено.
    const atAnniversary = computeDepositAccruedValue(simple, '2027-01-01');
    const final = computeDepositFinalAmount(simple);
    expect(final - atAnniversary).toBeLessThan(1);
    expect(atAnniversary).toBeLessThan(final);
  });
});

describe('computeDepositsTotal', () => {
  const rates = { USD: 3.0, EUR: 3.5 };
  const usdDeposit: Deposit = { ...simple, id: 'd3', currency: 'USD', amount: 1000 };
  const closed: Deposit = { ...simple, id: 'd4', closed: true };

  it('переводит валютные вклады в BYN по курсу', () => {
    const total = computeDepositsTotal([usdDeposit], rates, { principalOnly: true });
    expect(total).toBeCloseTo(3000, 2);
  });

  it('закрытые вклады не учитываются (защита от двойного счёта)', () => {
    expect(computeDepositsTotal([closed], rates)).toBe(0);
  });

  it('режим principalOnly игнорирует накопленные проценты', () => {
    const asOf = '2026-07-01';
    const withInterest = computeDepositsTotal([simple], rates, { asOf });
    const bodyOnly = computeDepositsTotal([simple], rates, { asOf, principalOnly: true });
    expect(withInterest).toBeGreaterThan(bodyOnly);
    expect(bodyOnly).toBeCloseTo(10000, 2);
  });

  it('неизвестная валюта не роняет расчёт (курс 1:1)', () => {
    const exotic: Deposit = { ...simple, currency: 'CNY' };
    expect(computeDepositsTotal([exotic], rates, { principalOnly: true })).toBeCloseTo(10000, 2);
  });
});

describe('computeDepositsTotalProfit', () => {
  it('считает только проценты, без тела вклада', () => {
    const profit = computeDepositsTotalProfit([simple], {}, '2027-03-01');
    expect(profit).toBeCloseTo(1400, 2);
  });
});