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
      <div class="brand-mark"><svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><defs><linearGradient id="vgoldMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5EBD3"/><stop offset="0.5" stop-color="#E6D7B8"/><stop offset="1" stop-color="#AE8B4E"/></linearGradient></defs><path d="M13 21 L25 45 L31 33" fill="none" stroke="url(#vgoldMark)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/><path d="M25 19 L37 45 L51 19" fill="none" stroke="url(#vgoldMark)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div>
        <div class="brand-text">Vertex</div>
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

/* Разделы, которые живут в нижнем таб-баре (iOS HIG: не больше 5 вкладок).
   Остальное уезжает в лист «Ещё». */
const TAB_IDS = ['dashboard', 'transactions', 'portfolio', 'reports'];

const isMobile = () => window.matchMedia('(max-width:880px)').matches;

export function renderMobileNav(goTo) {
  const el = document.getElementById('mobileNav');
  if (!el) return;
  const tabs = TAB_IDS.map(id => NAV.find(n => n.id === id)).filter(Boolean);
  const rest = NAV.filter(n => !TAB_IDS.includes(n.id));
  const restActive = rest.some(n => n.id === state.ui.view);

  el.innerHTML = `
    ${tabs.map(n => `
      <button class="tab ${state.ui.view === n.id ? 'active' : ''}" data-go="${n.id}"
              aria-label="${n.label}" ${state.ui.view === n.id ? 'aria-current="page"' : ''}>
        ${icon(n.icon)}<span>${n.label}</span>
      </button>`).join('')}
    <button class="tab ${restActive ? 'active' : ''}" data-sheet="1" aria-label="Ещё разделы" aria-haspopup="dialog">
      ${icon('more')}<span>Ещё</span>
    </button>
  `;
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTo(b.dataset.go)));
  el.querySelector('[data-sheet]').addEventListener('click', () => openNavSheet(goTo));

  renderNavSheet(goTo, rest);
}

/* ---- Лист «Ещё»: нижний sheet со вторичной навигацией ---- */
function renderNavSheet(goTo, rest) {
  const list = document.getElementById('navSheetList');
  if (!list) return;
  list.innerHTML = rest.map(n => `
    <button class="sheet-item ${state.ui.view === n.id ? 'active' : ''}" data-go="${n.id}">
      ${icon(n.icon)}
      <span class="sheet-item-text"><span class="sheet-item-title">${n.label}</span><span class="sheet-item-sub">${n.sub}</span></span>
    </button>`).join('');
  list.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    closeNavSheet();
    goTo(b.dataset.go);
  }));
}

export function openNavSheet() {
  const el = document.getElementById('navSheet');
  if (!el) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('active'));
  document.body.classList.add('no-scroll');
}

export function closeNavSheet() {
  const el = document.getElementById('navSheet');
  if (!el || el.hidden) return;
  el.classList.remove('active');
  document.body.classList.remove('no-scroll');
  setTimeout(() => { el.hidden = true; }, 220);
}

export function initNavSheet() {
  const el = document.getElementById('navSheet');
  if (!el) return;
  el.addEventListener('click', e => { if (e.target === el) closeNavSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNavSheet(); });
}

/* ---- Мобильная шапка: марка, название раздела, действия раздела ---- */
export function renderMobileHeader() {
  const el = document.getElementById('mobileHeader');
  if (!el) return;
  // Перед перерисовкой уводим узел действий из шапки, иначе innerHTML его оторвёт.
  parkActions();
  const navItem = NAV.find(n => n.id === state.ui.view) || NAV[0];
  el.innerHTML = `
    <div class="mh-brand" aria-hidden="true"><svg viewBox="0 0 64 64" width="22" height="22"><defs><linearGradient id="vgoldMh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5EBD3"/><stop offset="0.5" stop-color="#E6D7B8"/><stop offset="1" stop-color="#AE8B4E"/></linearGradient></defs><path d="M13 21 L25 45 L31 33" fill="none" stroke="url(#vgoldMh)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/><path d="M25 19 L37 45 L51 19" fill="none" stroke="url(#vgoldMh)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1 class="mh-title">${navItem.label}</h1>
    <div class="mh-actions" id="mhActions"></div>
  `;
  syncActionsPlacement();
}

/* Кнопки раздела (#pageActions) живут в шапке на телефоне
   и в строке тикера на десктопе — переносим сам узел, не пересоздавая. */
function parkActions() {
  const actions = document.getElementById('pageActions');
  const bar = document.querySelector('.ticker-bar');
  if (actions && bar && actions.parentElement !== bar) bar.appendChild(actions);
}

export function syncActionsPlacement() {
  const actions = document.getElementById('pageActions');
  if (!actions) return;
  const target = isMobile()
    ? document.getElementById('mhActions')
    : document.querySelector('.ticker-bar');
  if (target && actions.parentElement !== target) target.appendChild(actions);
}

/* Смена ориентации / поворот телефона / ресайз окна */
export function initResponsiveShell() {
  window.matchMedia('(max-width:880px)').addEventListener('change', syncActionsPlacement);
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


export function initGreeting() {
  const el = document.getElementById('greetLine');
  if (!el) return;
  const h = new Date().getHours();
  const word = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  el.innerHTML = `${word}, Alexe <span class="wave">👋</span>`;
}