import { state } from '../state.js';
import { rateFor } from './rates.js';
import { computeDepositsTotal } from './deposits.js';

export function computeAssetQuantity(assetId) {
  let qty = 0;
  state.transactions.forEach(t => {
    if (t.assetId === assetId) {
      if (t.assetClass === 'cash') {
        if (t.type === 'income') qty += t.quantity;
        else if (t.type === 'expense') qty -= t.quantity;
      } else {
        if (t.quantity !== undefined && t.quantity !== null) {
          if (t.type === 'income') qty += t.quantity;
          else if (t.type === 'expense') qty -= t.quantity;
        }
      }
    }
  });
  return qty;
}
// XIRR (с защитой от некорректных данных)
export function computeXIRR(cashflows, guess=0.1) {
  if (cashflows.length < 2) return null;
  cashflows = cashflows.slice().sort((a,b) => new Date(a.date) - new Date(b.date));
  const hasNeg = cashflows.some(cf => cf.amount < 0);
  const hasPos = cashflows.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const firstDate = new Date(cashflows[0].date);
  const days = cashflows.map(cf => (new Date(cf.date) - firstDate) / (1000*60*60*24));
  function npv(rate) {
    let total = 0;
    for (let i=0; i<cashflows.length; i++) {
      const d = days[i] / 365.25;
      total += cashflows[i].amount / Math.pow(1 + rate, d);
    }
    return total;
  }
  function npvDerivative(rate) {
    let deriv = 0;
    for (let i=0; i<cashflows.length; i++) {
      const d = days[i] / 365.25;
      deriv -= cashflows[i].amount * d / Math.pow(1 + rate, d + 1);
    }
    return deriv;
  }

  let rate = guess;
  let converged = false;
  for (let iter=0; iter<100; iter++) {
    const f = npv(rate);
    const df = npvDerivative(rate);
    if (Math.abs(df) < 1e-10) break;
    let newRate = rate - f / df;
    if (newRate < -0.999) newRate = -0.999;
    if (newRate > 50) newRate = 50;
    if (Math.abs(newRate - rate) < 1e-7) { rate = newRate; converged = true; break; }
    rate = newRate;
  }
  if (converged && isFinite(rate) && Math.abs(npv(rate)) < 1) return rate;

  let lo = -0.999, hi = 50;
  let fLo = npv(lo), fHi = npv(hi);
  if (fLo * fHi > 0) {
    return isFinite(rate) ? rate : null;
  }
  for (let i=0; i<200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if ((fLo < 0) === (fMid < 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// ОБНОВЛЁННАЯ ФУНКЦИЯ refreshAssets (ИСПРАВЛЕНА ДВОЙНАЯ КОНВЕРТАЦИЯ)
export function refreshAssets() {
  const usdRate = state.rates.USD || 1;
  state.assets.forEach(a => {
    a.quantity = computeAssetQuantity(a.id);
    if (a.class === 'cash') {
      a.priceBYN = rateFor(a.unit) || 1;
      a.invested = a.quantity;
      a.investedUSD = a.quantity / usdRate;
      a.withdrawn = 0;
      a.currentValue = a.quantity * a.priceBYN;
      a.currentValueUSD = a.currentValue / usdRate;
      a.profit = 0;
      a.profitUSD = 0;
      a.roi = 0;
      a.cagr = 0;
      a.xirr = 0;
      a.xirrProvisional = false;
    } else {
      const market = state.marketPrices[a.id];
      if (market && market.priceUSD !== undefined && market.priceUSD !== null) {
        a.priceUSD = market.priceUSD;
        a.priceBYN = market.priceUSD * usdRate;
        a.updatedAt = market.lastUpdated || new Date().toISOString();
      } else {
        const lastTx = state.transactions.filter(t => t.assetId === a.id).sort((x,y) => y.date.localeCompare(x.date))[0];
        if (lastTx && lastTx.quantity && lastTx.quantity > 0 && lastTx.pricePerUnit) {
          const priceBYN = lastTx.pricePerUnit;
          a.priceBYN = priceBYN;
          a.priceUSD = priceBYN / usdRate;
          a.updatedAt = new Date().toISOString();
        } else {
          a.priceUSD = 0;
          a.priceBYN = 0;
        }
      }
      let invested = 0, withdrawn = 0;
      let firstBuyDate = null;
      const cashflows = [];
      state.transactions.forEach(t => {
        if (t.assetId === a.id) {
          const amountBYN = t.quantity * t.pricePerUnit;
          if (t.type === 'income') {
            invested += amountBYN;
            if (!firstBuyDate || t.date < firstBuyDate) firstBuyDate = t.date;
            cashflows.push({ date: t.date, amount: -amountBYN });
          } else if (t.type === 'expense') {
            withdrawn += amountBYN;
            cashflows.push({ date: t.date, amount: amountBYN });
          }
        }
      });
      if (a.quantity > 0) {
        const currentVal = a.quantity * a.priceBYN;
        cashflows.push({ date: new Date().toISOString().slice(0,10), amount: currentVal });
      }
      a.invested = invested;
      a.investedUSD = invested / usdRate;
      a.withdrawn = withdrawn;
      a.withdrawnUSD = withdrawn / usdRate;
      a.currentValue = a.quantity * a.priceBYN;
      a.currentValueUSD = a.quantity * a.priceUSD;
      a.profit = withdrawn + a.currentValue - invested;
      a.profitUSD = (withdrawn / usdRate) + a.currentValueUSD - (invested / usdRate);
      a.roi = invested > 0 ? (a.profit / invested * 100) : 0;

      a.cagr = null;
      if (firstBuyDate && invested > 0) {
        const first = new Date(firstBuyDate);
        const now = new Date();
        const years = (now - first) / (365.25 * 24 * 3600 * 1000);
        const growthBasis = (a.currentValue + withdrawn) / invested;
        if (years >= (7/365.25) && growthBasis > 0) {
          a.cagr = (Math.pow(growthBasis, 1/years) - 1) * 100;
        }
      }

      a.xirr = null;
      a.xirrProvisional = false;
      if (cashflows.length > 1 && firstBuyDate) {
        const first = new Date(firstBuyDate);
        const now = new Date();
        const daysSinceFirst = (now - first) / (1000 * 60 * 60 * 24);
        if (daysSinceFirst >= 30) {
          const filtered = cashflows.filter(cf => Math.abs(cf.amount) > 0.001);
          if (filtered.length > 1) {
            const xirr = computeXIRR(filtered);
            if (xirr !== null) {
              a.xirr = xirr * 100;
              if (daysSinceFirst < 90) {
                a.xirrProvisional = true;
              }
            }
          }
        }
      }
    }
  });
}

export function assetValueBYN(a) {
  return (Number(a.quantity) || 0) * (Number(a.priceBYN) || 0);
}

export function computePortfolioTotals() {
  refreshAssets();
  const byClass = {};
  const classKeys = ['cash', ...Object.keys(state.assetTypes)];
  classKeys.forEach(c => byClass[c] = 0);
  let total = 0;
  state.assets.forEach(a => {
    const v = assetValueBYN(a);
    byClass[a.class] = (byClass[a.class] || 0) + v;
    total += v;
  });
  return { byClass, total };
}

export function computeTotalCapital(forceAccrued) {
  const portfolio = computePortfolioTotals().total;
  const depositsTotal = computeDepositsTotal(forceAccrued);
  return portfolio + depositsTotal;
}
