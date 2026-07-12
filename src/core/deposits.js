import { state } from '../state.js';
import { rateFor } from './rates.js';   // соседи по папке — путь './'

export const AVG_DAYS_PER_MONTH = 30.4368;
export function depositElapsedMonths(deposit, asOfDate) {
  const start = new Date(deposit.startDate);
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  let elapsed = (asOf - start) / (1000 * 60 * 60 * 24 * AVG_DAYS_PER_MONTH);
  if (!isFinite(elapsed) || elapsed < 0) elapsed = 0;
  return Math.min(elapsed, deposit.termMonths);
}
export function isDepositMatured(deposit) {
  return depositElapsedMonths(deposit, new Date()) >= deposit.termMonths;
}
export function computeDepositAccruedValue(deposit, asOfDate) {
  const rate = deposit.rate / 100;
  const months = depositElapsedMonths(deposit, asOfDate);
  const principal = deposit.amount;
  if (deposit.capitalization) {
    // Банковская капитализация дискретна: проценты присоединяются раз в месяц,
    // за неполный текущий месяц начисляется простой процент на накопленную базу.
    const monthlyRate = rate / 12;
    const whole = Math.floor(months);
    const frac = months - whole;
    return principal * Math.pow(1 + monthlyRate, whole) * (1 + monthlyRate * frac);
  } else {
    return principal * (1 + rate * months / 12);
  }
}
export function computeDepositFinalAmount(deposit) {
  const rate = deposit.rate / 100;
  const months = deposit.termMonths;
  const principal = deposit.amount;
  if (deposit.capitalization) {
    const monthlyRate = rate / 12;
    return principal * Math.pow(1 + monthlyRate, months);
  } else {
    return principal * (1 + rate * months / 12);
  }
}
export function computeDepositProfit(deposit) {
  return computeDepositFinalAmount(deposit) - deposit.amount;
}
// ИСПРАВЛЕНО: используем computeDepositAccruedValue вместо финальной суммы
export function computeDepositsTotal(forceAccrued) {
  // Режим «только вложенное»: депозиты по телу, без накопленных процентов.
  // forceAccrued=true игнорирует настройку (для снимков — они всегда по факту).
  const principalOnly = !forceAccrued && state.settings && state.settings.depositsPrincipalOnly;
  let total = 0;
  state.deposits.forEach(d => {
    if (d.closed) return; // деньги уже вернулись в кэш — иначе будет двойной счёт
    const val = principalOnly ? d.amount : computeDepositAccruedValue(d);
    total += val * rateFor(d.currency);
  });
  return total;
}
export function computeDepositsTotalProfit() {
  let totalProfit = 0;
  state.deposits.forEach(d => {
    if (d.closed) return;
    const profit = computeDepositAccruedValue(d) - d.amount;
    totalProfit += profit * rateFor(d.currency);
  });
  return totalProfit;
}
