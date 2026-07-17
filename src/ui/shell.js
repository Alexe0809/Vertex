// ======= SHELL =======
import { NAV } from '../config.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { fmt } from '../utils.js';
import { computeTotalCapital } from '../core/portfolio.js';

export function renderSidebar(goTo) {
  const el = document.getElementById('sidebar');
  el.innerHTML = `
    <div class="brand">
      <div class="brand-mark">$</div>
      <div>
        <div class="brand-text">Ledger</div>
        <div class="brand-sub">Личный капитал</div>
      </div>
    </div>
    <div class="nav-eyebrow">Навигация</div>
    <div class="nav">
      ${NAV.map(n => `<button class="nav-item ${state.ui.view === n.id ? 'active' : ''}" data-go="${n.id}">${icon(n.icon)}${n.label}</button>`).join('')}
    </div>
    <div class="sidebar-foot">
      <div class="sidebar-foot-row"><span>Записей</span><span>${state.transactions.length}</span></div>
      <div class="sidebar-foot-row"><span>Активов</span><span>${state.assets.length}</span></div>
      <div class="sidebar-foot-row"><span>Депозитов</span><span>${state.deposits.length}</span></div>
    </div>
  `;
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.go)));
}

export function renderMobileNav(goTo) {
  const el = document.getElementById('mobileNav');
  el.innerHTML = NAV.map(n => `<button class="${state.ui.view === n.id ? 'active' : ''}" data-go="${n.id}">${icon(n.icon)}${n.label}</button>`).join('');
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.go)));
}

export function renderTicker(cashflow) {
  const totalCapital = computeTotalCapital();
  const usdRate = state.rates.USD || 1;
  const totalUSD = totalCapital / usdRate;
  const el = document.getElementById('ticker');
  const incomeUSD = cashflow.income / usdRate;
  const expenseUSD = cashflow.expense / usdRate;
  let html = `
    <div class="ticker-chip">
      <div class="ticker-label"><span class="ticker-dot" style="background:var(--accent)"></span>Капитал, BYN</div>
      <div class="ticker-value">${fmt(totalCapital,2)}</div>
    </div>
    <div class="ticker-chip">
      <div class="ticker-label"><span class="ticker-dot" style="background:var(--accent)"></span>Капитал, USD</div>
      <div class="ticker-value">${fmt(totalUSD,2)}</div>
    </div>
    <div class="ticker-chip">
      <div class="ticker-label"><span class="ticker-dot" style="background:var(--positive)"></span>Доход/мес</div>
      <div class="ticker-value" style="color:var(--positive)">${fmt(cashflow.income,0)} BYN / ${fmt(incomeUSD,0)} USD</div>
    </div>
    <div class="ticker-chip">
      <div class="ticker-label"><span class="ticker-dot" style="background:var(--negative)"></span>Расход/мес</div>
      <div class="ticker-value" style="color:var(--negative)">${fmt(cashflow.expense,0)} BYN / ${fmt(expenseUSD,0)} USD</div>
    </div>
    <div class="ticker-chip">
      <div class="ticker-label"><span class="ticker-dot" style="background:var(--info)"></span>Инвестировано/мес</div>
      <div class="ticker-value" style="color:var(--info)">${fmt(cashflow.invested,0)} BYN</div>
    </div>
  `;
  el.innerHTML = html;
}
