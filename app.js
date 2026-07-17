/* =========================================================
   Ledger — Личный бюджет (ПОЛНЫЙ ФАЙЛ, без модулей)
   Все баги исправлены. Работает через file:// и http://
   Использует глобальный Chart (из CDN)
   ========================================================= */

import { NAV, DEFAULT_ASSET_TYPES, ASSET_CLASS_COLORS, getColorForClass, STORAGE_KEY} from './src/config.js';
import { ICONS, icon } from './src/icons.js';
import { state, setState, load, save, logAction, migrateState, defaultState } from './src/state.js';
import { rateFor } from './src/core/rates.js';
import { depositElapsedMonths, isDepositMatured, computeDepositAccruedValue,
         computeDepositFinalAmount, computeDepositProfit,
         computeDepositsTotal, computeDepositsTotalProfit } from './src/core/deposits.js';
import { computeAssetQuantity, computeXIRR, refreshAssets, assetValueBYN,
         computePortfolioTotals, computeTotalCapital } from './src/core/portfolio.js';
import { fmt, fmtUSD, fmtPct, fmtDate, fmtDateTime, round2, monthKey, uid, txAmountBYN } from './src/utils.js';
import { toast, openModal, closeModal, initModals, escapeHtml} from './src/ui/dom.js';
import { renderSidebar, renderMobileNav, renderTicker} from './src/ui/shell.js';
import { renderDashboard } from './src/ui/views/dashboard.js';

const Chart = window.Chart || null;
if (!Chart) console.warn('Chart.js не загрузился (нет сети/CDN) — графики будут скрыты, остальное работает.');

// ======= STATE =======
let charts = {};

function getClassLabel(cls) {
  if (cls === 'cash') return 'Кэш';
  return state.assetTypes[cls] ? state.assetTypes[cls].label : cls;
}

// ======= FORMATTERS =======
function todayISO() { return new Date().toISOString().slice(0,10); }



// ======= РАБОТА С АКТИВАМИ =======


function ensureCashAsset(currency) {
  let cashAsset = state.assets.find(a => a.class === 'cash' && a.unit === currency);
  if (!cashAsset) {
    cashAsset = { id: uid(), name: `Наличные (${currency})`, class: 'cash', unit: currency, priceBYN: rateFor(currency), notes: '', updatedAt: new Date().toISOString() };
    state.assets.push(cashAsset);
    logAction('add_asset_auto', `Создан кэш-актив: ${cashAsset.name}`);
  }
  return cashAsset;
}

// Связанная кассовая проводка при покупке/продаже актива.
// Принцип двойной записи: покупка BTC = кэш уменьшился, актив увеличился.
// Без этого капитал задваивается (зарплата остаётся в кэше И появляется актив).
function syncTransferLeg(mainTx, enabled) {
  let leg = mainTx.linkedTransferId ? state.transactions.find(x => x.id === mainTx.linkedTransferId) : null;
  if (!enabled) {
    if (leg) state.transactions = state.transactions.filter(x => x.id !== leg.id);
    delete mainTx.linkedTransferId;
    return;
  }
  const cashAsset = ensureCashAsset(mainTx.currency);
  const legType = mainTx.type === 'income' ? 'expense' : 'income'; // покупка актива = списание кэша
  const fields = {
    date: mainTx.date,
    type: legType,
    category: legType === 'expense' ? 'Покупка актива (перевод)' : 'Продажа актива (перевод)',
    amount: mainTx.amount,
    currency: mainTx.currency,
    rate: mainTx.rate,
    description: `${legType === 'expense' ? 'Оплата покупки' : 'Выручка от продажи'}: ${mainTx.assetName}`,
    assetId: cashAsset.id, assetName: cashAsset.name, assetClass: 'cash', assetUnit: mainTx.currency,
    quantity: mainTx.amount, pricePerUnit: 1, txType: 'transfer', linkId: mainTx.id
  };
  if (leg) {
    Object.assign(leg, fields);
  } else {
    leg = Object.assign({ id: uid(), createdAt: new Date().toISOString() }, fields);
    state.transactions.push(leg);
    mainTx.linkedTransferId = leg.id;
  }
}

// ======= ДЕПОЗИТЫ (исправлены: теперь считаем по факту) =======

// Закрытие депозита: тело возвращается в кэш как перевод (не доход),
// а начисленные проценты признаются доходом («Проценты/доход»).
function closeDeposit(depositId) {
  const d = state.deposits.find(x => x.id === depositId);
  if (!d || d.closed) return;
  const accrued = round2(computeDepositAccruedValue(d));
  const interest = round2(accrued - d.amount);
  const matured = isDepositMatured(d);
  const warn = matured ? '' : '\n\nВнимание: срок ещё не истёк — банк может пересчитать проценты по ставке досрочного расторжения. При необходимости скорректируйте сумму процентов вручную (через редактирование транзакции дохода).';
  if (!confirm(`Закрыть депозит ${fmt(d.amount,2)} ${d.currency}?\nТело вклада: ${fmt(d.amount,2)} ${d.currency}\nНачисленные проценты: ${fmt(interest,2)} ${d.currency}${warn}`)) return;

  // находим/создаём кэш-актив нужной валюты
  let cashAsset = state.assets.find(a => a.class === 'cash' && a.unit === d.currency);
  if (!cashAsset) {
    cashAsset = { id: uid(), name: `Наличные (${d.currency})`, class: 'cash', unit: d.currency, priceBYN: rateFor(d.currency), notes: '', updatedAt: new Date().toISOString() };
    state.assets.push(cashAsset);
  }
  const today = todayISO();
  const fx = rateFor(d.currency);
  // 1) возврат тела — перевод, не попадает в доходы
  state.transactions.push({
    id: uid(), date: today, type: 'income', category: 'Возврат депозита',
    amount: d.amount, currency: d.currency, rate: fx,
    description: `Возврат тела депозита (${fmt(d.rate,1)}%, ${d.termMonths} мес.)`,
    createdAt: new Date().toISOString(),
    assetId: cashAsset.id, assetName: cashAsset.name, assetClass: 'cash', assetUnit: d.currency,
    quantity: d.amount, pricePerUnit: 1, txType: 'transfer', depositId: d.id
  });
  // 2) проценты — реальный доход
  if (interest !== 0) {
    state.transactions.push({
      id: uid(), date: today, type: 'income', category: 'Проценты/доход',
      amount: Math.abs(interest), currency: d.currency, rate: fx,
      description: `Проценты по депозиту ${fmt(d.amount,2)} ${d.currency}`,
      createdAt: new Date().toISOString(),
      assetId: cashAsset.id, assetName: cashAsset.name, assetClass: 'cash', assetUnit: d.currency,
      quantity: Math.abs(interest), pricePerUnit: 1, txType: 'income_expense', depositId: d.id
    });
  }
  d.closed = true;
  d.closeDate = today;
  d.closeValue = accrued;
  logAction('close_deposit', `Закрыт депозит ${fmt(d.amount,2)} ${d.currency}, проценты ${fmt(interest,2)}`);
  save(); renderAll();
  toast('Депозит закрыт, средства зачислены в кэш');
}

// ======= МЕСЯЧНЫЕ ПОТОКИ (исключаем депозиты) =======

// Бухгалтерская логика:
//  - доход/расход = только реальные денежные потоки (зарплата, еда, ...);
//  - покупка/продажа актива — это перемещение капитала (кэш <-> актив), а не доход/расход,
//    поэтому они учитываются отдельно как invested/divested;
//  - txType 'deposit' и 'transfer' (автосвязанные проводки) исключаются из потоков.
function computeMonthFlow(key) {
  let income = 0, expense = 0, invested = 0, divested = 0;
  state.transactions.forEach(t => {
    if (monthKey(t.date) !== key) return;
    if (t.txType === 'deposit' || t.txType === 'transfer') return;
    const v = txAmountBYN(t);
    if (t.assetClass && t.assetClass !== 'cash') {
      // операция с инвестиционным активом: income = покупка, expense = продажа
      if (t.type === 'income') invested += v;
      else if (t.type === 'expense') divested += v;
      return;
    }
    if (t.type === 'income') income += v;
    else if (t.type === 'expense') expense += v;
  });
  return { income, expense, net: income - expense, invested, divested };
}

function lastNMonthKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = n-1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(dt.toISOString().slice(0,7));
  }
  return out;
}

function computeAvgMonthlySavings(n) {
  const keys = lastNMonthKeys(n);
  const present = keys.filter(k => state.transactions.some(t => monthKey(t.date) === k));
  if (present.length === 0) return 0;
  const sum = present.reduce((s, k) => s + computeMonthFlow(k).net, 0);
  return sum / present.length;
}

function computeAvgMonthlyExpense(n) {
  const keys = lastNMonthKeys(n);
  const present = keys.filter(k => state.transactions.some(t => monthKey(t.date) === k));
  if (present.length === 0) return 0;
  const sum = present.reduce((s, k) => s + computeMonthFlow(k).expense, 0);
  return sum / present.length;
}

function linearForecast(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  points.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
  const denom = (n * sxx - sx * sx);
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function goTo(viewId) {
  state.ui.view = viewId;
  save();
  renderAll();
  window.scrollTo(0,0);
}

const RENDERERS = {};

function renderAll() {
  renderSidebar(goTo);
  renderMobileNav(goTo);
  renderTicker(computeMonthFlow(new Date().toISOString().slice(0,7)));
  const navItem = NAV.find(n => n.id === state.ui.view) || NAV[0];
  document.getElementById('pageTitle').textContent = navItem.label;
  document.getElementById('pageSub').textContent = navItem.sub;
  const viewsEl = document.getElementById('views');
  if (RENDERERS[state.ui.view]) RENDERERS[state.ui.view](viewsEl);
}

function setActions(html) {
  document.getElementById('pageActions').innerHTML = html;
}

// ======= VIEW: PRICES (ручной ввод) =======
RENDERERS.prices = function(root) {
  setActions(`<button class="btn btn-accent" id="savePricesBtn">${icon('save')}Сохранить цены</button>`);
  refreshAssets();

  root.innerHTML = `
    <div class="card">
      <div class="card-title">Ручной ввод цен активов</div>
      <div class="card-sub">Введите текущую цену в USD для каждого актива и нажмите «Сохранить цены».</div>
      <div id="pricesTableWrap" style="margin-top:12px;">
        <div style="text-align:center;padding:20px;color:var(--text-dim);">Загрузка...</div>
      </div>
    </div>
  `;

  function renderPricesEditor() {
    const wrap = document.getElementById('pricesTableWrap');
    const usdRate = state.rates.USD || 1;
    const assets = state.assets.filter(a => a.class !== 'cash');
    if (assets.length === 0) {
      wrap.innerHTML = `<div class="empty">${icon('inbox')}<div class="empty-title">Нет инвестиционных активов</div><div class="empty-sub">Добавьте покупки активов, чтобы редактировать их цены.</div></div>`;
      return;
    }
    let html = `<div class="table-wrap"><table>
      <thead><tr><th>Актив</th><th>Тип</th><th>Кол-во</th><th style="text-align:right">Цена (USD)</th><th style="text-align:right">Цена (BYN)</th><th>Обновлено</th></tr></thead>
      <tbody>`;
    assets.forEach(a => {
      const market = state.marketPrices[a.id] || {};
      const priceUSD = market.priceUSD || a.priceUSD || 0;
      const priceBYN = priceUSD * usdRate;
      const lastUpdated = market.lastUpdated ? fmtDateTime(market.lastUpdated) : '—';
      html += `<tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${getClassLabel(a.class)}</td>
        <td class="mono">${fmt(a.quantity,4)}</td>
        <td><input type="number" step="0.0001" class="price-input" data-id="${a.id}" value="${priceUSD}" style="width:120px;background:var(--bg-elev);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);text-align:right;"></td>
        <td class="mono" style="text-align:right">${fmt(priceBYN,4)}</td>
        <td class="hint">${lastUpdated}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    wrap.innerHTML = html;
  }

  renderPricesEditor();

  // ИСПРАВЛЕНО: раньше обработчик вешался внутри renderPricesEditor и дублировался после каждого сохранения
  document.getElementById('savePricesBtn').addEventListener('click', function() {
    const wrap = document.getElementById('pricesTableWrap');
    const usdRateNow = state.rates.USD || 1;
    const inputs = wrap.querySelectorAll('.price-input');
    let updated = 0;
    inputs.forEach(input => {
      const assetId = input.dataset.id;
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        state.marketPrices[assetId] = {
          priceUSD: val,
          price: val * usdRateNow,
          lastUpdated: new Date().toISOString()
        };
        updated++;
      }
    });
    if (updated > 0) {
      save();
      refreshAssets();
      toast(`Цены обновлены для ${updated} активов`);
      renderAll();
    } else {
      toast('Нет изменений для сохранения', 'danger');
    }
  });
};

// ============================================================
// VIEW: PORTFOLIO (с процентами напротив активов, XIRR с пометкой,
// для КЭША добавлены доли валют, в депозитах добавлена колонка "Накоплено сейчас")
// ============================================================
RENDERERS.portfolio = function(root) {
  setActions(`<button class="btn" id="actSnapshot2">${icon('camera')}Снимок</button>`);
  refreshAssets();
  const usdRate = state.rates.USD || 1;
  const { byClass, total: portfolioTotal } = computePortfolioTotals();
  const depositsTotal = computeDepositsTotal();
  const depositsTotalProfit = computeDepositsTotalProfit();
  const totalCapital = computeTotalCapital();
  const classKeys = ['cash', ...Object.keys(state.assetTypes)];
  const grouped = classKeys.map(cls => {
    const items = state.assets.filter(a => a.class === cls && state.transactions.some(t => t.assetId === a.id));
    if (items.length === 0) return null;
    const label = getClassLabel(cls);
    const color = getColorForClass(cls);
    const categoryTotal = items.reduce((s,a) => s + assetValueBYN(a), 0);
    if (cls === 'cash') {
      items.forEach(a => {
        a.shareInCash = categoryTotal > 0 ? (assetValueBYN(a) / categoryTotal * 100) : 0;
      });
    }
    items.forEach(a => {
      a.categoryShare = categoryTotal > 0 ? (assetValueBYN(a) / categoryTotal * 100) : 0;
    });
    items.sort((a,b) => b.categoryShare - a.categoryShare);
    const catInvested = items.reduce((s,a) => s + (a.invested || 0), 0);
    const catWithdrawn = items.reduce((s,a) => s + (a.withdrawn || 0), 0);
    const catCurrent = items.reduce((s,a) => s + (a.currentValue || 0), 0);
    const catProfit = catWithdrawn + catCurrent - catInvested;
    const catROI = catInvested > 0 ? (catProfit / catInvested * 100) : 0;
    const catInvestedUSD = items.reduce((s,a) => s + (a.investedUSD || 0), 0);
    const catCurrentUSD = items.reduce((s,a) => s + (a.currentValueUSD || 0), 0);
    const catProfitUSD = items.reduce((s,a) => s + (a.profitUSD || 0), 0);
    return { cls, label, color, items, categoryTotal, catInvested, catWithdrawn, catCurrent, catProfit, catROI, catInvestedUSD, catCurrentUSD, catProfitUSD };
  }).filter(g => g !== null);

  let totalInvested = 0, totalWithdrawn = 0, totalCurrent = 0;
  state.assets.forEach(a => {
    if (a.class !== 'cash') {
      totalInvested += a.invested || 0;
      totalWithdrawn += a.withdrawn || 0;
      totalCurrent += a.currentValue || 0;
    }
  });
  const totalProfit = totalWithdrawn + totalCurrent - totalInvested;
  const totalROI = totalInvested > 0 ? (totalProfit / totalInvested * 100) : 0;

  let depositsHtml = '';
  if (state.deposits.length > 0) {
    depositsHtml = `
      <div class="section-divider"><span class="label">Депозиты</span><div class="line"></div></div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-head">
          <div class="card-title">💰 Депозиты</div>
          <div style="display:flex;gap:16px;font-size:13px;color:var(--text-dim);align-items:center;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;">
              <input type="checkbox" id="depPrincipalToggle" ${state.settings.depositsPrincipalOnly ? 'checked' : ''} style="accent-color:var(--accent);">
              Только вложенное (без %)
            </label>
            <span>${state.settings.depositsPrincipalOnly ? 'Общая сумма (вложено)' : 'Общая сумма (факт)'}: <span class="mono">${fmt(depositsTotal,2)} BYN</span></span>
            <span>Общая прибыль (факт): <span class="mono" style="color:${depositsTotalProfit>=0?'var(--positive)':'var(--negative)'};">${fmt(depositsTotalProfit,2)} BYN</span></span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Валюта</th><th>Сумма</th><th>Ставка</th><th>Срок (мес.)</th><th>Капитализация</th><th>Дата открытия</th><th>Статус</th><th style="text-align:right">${state.settings.depositsPrincipalOnly ? 'Вложено' : 'Накоплено сейчас'}</th><th style="text-align:right">Прибыль (за весь срок)</th><th></th></tr></thead>
            <tbody>
              ${state.deposits.map(d => {
                const accrued = d.closed ? (d.closeValue || 0) : (state.settings.depositsPrincipalOnly ? d.amount : computeDepositAccruedValue(d));
                const final = computeDepositFinalAmount(d);
                const profit = d.closed ? ((d.closeValue || d.amount) - d.amount) : (final - d.amount);
                const profitColor = profit >= 0 ? 'var(--positive)' : 'var(--negative)';
                const matured = isDepositMatured(d);
                const accruedColor = accrued >= d.amount ? 'var(--positive)' : 'var(--negative)';
                let statusHtml;
                if (d.closed) statusHtml = `<span class="tag"><span class="dot" style="background:var(--info)"></span>Закрыт ${fmtDate(d.closeDate)}</span>`;
                else if (matured) statusHtml = '<span class="tag"><span class="dot" style="background:var(--positive)"></span>Срок истёк</span>';
                else statusHtml = '<span class="tag"><span class="dot" style="background:var(--text-faint)"></span>Активен</span>';
                return `<tr>
                  <td>${d.currency}</td>
                  <td class="mono">${fmt(d.amount,2)}</td>
                  <td class="mono">${fmt(d.rate,1)}%</td>
                  <td class="mono">${d.termMonths}</td>
                  <td>${d.capitalization ? 'Да' : 'Нет'}</td>
                  <td class="hint">${fmtDate(d.startDate)}</td>
                  <td>${statusHtml}</td>
                  <td class="amt" style="color:${accruedColor};">${fmt(accrued,2)}</td>
                  <td class="amt" style="color:${profitColor};">${fmt(profit,2)}</td>
                  <td>${d.closed ? '' : `<button class="btn btn-sm" data-closedep="${d.id}">Закрыть</button>`}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  root.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:18px">
      ${classKeys.map(cls => {
        const v = byClass[cls] || 0;
        if (v === 0 && !state.assets.some(a => a.class === cls)) return '';
        const label = getClassLabel(cls);
        const color = getColorForClass(cls);
        return `<div class="card"><div class="kpi">
          <div class="kpi-label" style="display:flex;align-items:center;gap:7px"><span class="dot" style="background:${color}"></span>${label}</div>
          <div class="kpi-value">${fmt(v,2)}</div>
          <div class="kpi-delta" style="color:var(--text-faint)">${fmt(totalCapital>0?v/totalCapital*100:0,1)}% капитала</div>
        </div></div>`;
      }).join('')}
      ${state.deposits.length > 0 ? `<div class="card"><div class="kpi">
        <div class="kpi-label" style="display:flex;align-items:center;gap:7px"><span class="dot" style="background:${ASSET_CLASS_COLORS.deposit}"></span>Депозиты</div>
        <div class="kpi-value">${fmt(depositsTotal,2)}</div>
        <div class="kpi-delta" style="color:var(--text-faint)">${fmt(totalCapital>0?depositsTotal/totalCapital*100:0,1)}% капитала</div>
      </div></div>` : ''}
    </div>

    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="card">
        <div class="card-title">Сводка по инвестициям (без депозитов)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:6px;">
          <div><div class="hint">Вложено (BYN)</div><div class="mono">${fmt(totalInvested,2)}</div></div>
          <div><div class="hint">Выведено (BYN)</div><div class="mono">${fmt(totalWithdrawn,2)}</div></div>
          <div><div class="hint">Текущая стоимость (BYN)</div><div class="mono">${fmt(totalCurrent,2)}</div></div>
          <div><div class="hint">Прибыль (BYN)</div><div class="mono" style="color:${totalProfit>=0?'var(--positive)':'var(--negative)'};">${fmt(totalProfit,2)}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:6px;">
          <div><div class="hint">Вложено ($)</div><div class="mono">${fmt(totalInvested/usdRate,2)}</div></div>
          <div><div class="hint">Выведено ($)</div><div class="mono">${fmt(totalWithdrawn/usdRate,2)}</div></div>
          <div><div class="hint">Текущая стоимость ($)</div><div class="mono">${fmt(totalCurrent/usdRate,2)}</div></div>
          <div><div class="hint">Прибыль ($)</div><div class="mono" style="color:${totalProfit>=0?'var(--positive)':'var(--negative)'};">${fmt(totalProfit/usdRate,2)}</div></div>
        </div>
        <div style="margin-top:8px;"><span class="hint">Общий ROI</span> <span style="font-weight:600;color:${totalROI>=0?'var(--positive)':'var(--negative)'};">${fmtPct(totalROI)}</span></div>
        <div class="hint" style="margin-top:6px;">USD-показатели пересчитаны по текущему курсу (${fmt(usdRate,4)}), исторический курс на дату сделки не учитывается — валютный эффект входит в прибыль.</div>
      </div>
      <div class="card">
        <div class="card-title">Топ активов по ROI</div>
        ${state.assets.filter(a => a.class !== 'cash' && a.invested > 0).sort((a,b)=>b.roi - a.roi).slice(0,5).map(a => `
          <div class="list-row"><div>${escapeHtml(a.name)}</div><div style="text-align:right;color:${a.roi>=0?'var(--positive)':'var(--negative)'};">${fmtPct(a.roi)}</div></div>
        `).join('') || '<div class="hint">Нет данных</div>'}
      </div>
    </div>

    ${grouped.map(g => `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-head">
          <div class="card-title" style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:${g.color}"></span>${g.label}</div>
          <div style="display:flex;gap:16px;font-size:12px;color:var(--text-dim);">
            ${g.cls === 'cash'
              ? `<span>Всего: ${fmt(g.categoryTotal,2)} BYN</span>`
              : `
                <span>Вложено (USD): ${fmt(g.catInvestedUSD,2)}</span>
                <span>Прибыль (USD): <span style="color:${g.catProfitUSD>=0?'var(--positive)':'var(--negative)'};">${fmt(g.catProfitUSD,2)}</span></span>
                <span>ROI: <span style="color:${g.catROI>=0?'var(--positive)':'var(--negative)'};">${fmtPct(g.catROI)}</span></span>
              `
            }
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тикер</th>
                <th>Кол-во</th>
                <th>Ед.</th>
                ${g.cls === 'cash' ? `
                  <th style="text-align:right">Доля в кэше</th>
                ` : `
                  <th style="text-align:right">Доля в активе</th>
                  <th style="text-align:right">Вложено (USD)</th>
                  <th style="text-align:right">Текущая стоимость (BYN)</th>
                  <th style="text-align:right">Текущая стоимость (USD)</th>
                  <th style="text-align:right">Прибыль (USD)</th>
                  <th style="text-align:right">ROI</th>
                  <th style="text-align:right">XIRR</th>
                  <th style="text-align:right">CAGR</th>
                `}
                <th>Обновлено</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
            ${g.items.map(a => {
              if (a.class === 'cash') {
                return `<tr>
                  <td>${escapeHtml(a.name)}</td>
                  <td class="mono">${fmt(a.quantity,2)} ${a.unit}</td>
                  <td>${escapeHtml(a.unit||'')}</td>
                  <td class="amt">${fmt(a.shareInCash || 0, 1)}%</td>
                  <td class="hint">${a.updatedAt ? fmtDate(a.updatedAt) : '—'}</td>
                  <td><div class="row-actions">
                    <button class="icon-btn" data-edit="${a.id}">${icon('edit')}</button>
                    <button class="icon-btn" data-history="${a.id}">${icon('clock')}</button>
                    <button class="icon-btn" data-del="${a.id}">${icon('trash')}</button>
                  </div></td>
                </tr>`;
              } else {
                const profitColor = a.profit>=0 ? 'var(--positive)' : 'var(--negative)';
                const cagrDisplay = (a.cagr !== null && a.cagr !== undefined) ? fmtPct(a.cagr) : '—';
                let xirrDisplay = '—';
                let xirrColor = 'var(--text-faint)';
                if (a.xirr !== null && a.xirr !== undefined) {
                  xirrDisplay = fmtPct(a.xirr);
                  xirrColor = a.xirr >= 0 ? 'var(--positive)' : 'var(--negative)';
                  if (a.xirrProvisional) {
                    xirrDisplay = xirrDisplay + '*';
                  }
                }
                const investedUSD = a.investedUSD || 0;
                const profitUSD = a.profitUSD || 0;
                return `<tr>
                  <td>${escapeHtml(a.name)}</td>
                  <td class="mono">${fmt(a.quantity, a.class === 'crypto' ? 6 : 4)}</td>
                  <td>${escapeHtml(a.unit||'')}</td>
                  <td class="amt">${fmt(a.categoryShare || 0, 1)}%</td>
                  <td class="amt">${fmt(investedUSD,2)}</td>
                  <td class="amt">${fmt(a.currentValue||0,2)}</td>
                  <td class="amt">${fmt(a.currentValueUSD||0,2)}</td>
                  <td class="amt" style="color:${profitColor};">${fmt(profitUSD,2)}</td>
                  <td class="amt" style="color:${profitColor};">${fmtPct(a.roi||0)}</td>
                  <td class="amt" style="color:${xirrColor};">${xirrDisplay}</td>
                  <td class="amt">${cagrDisplay}</td>
                  <td class="hint">${a.updatedAt ? fmtDate(a.updatedAt) : '—'}</td>
                  <td><div class="row-actions">
                    <button class="icon-btn" data-edit="${a.id}">${icon('edit')}</button>
                    <button class="icon-btn" data-history="${a.id}">${icon('clock')}</button>
                    <button class="icon-btn" data-del="${a.id}">${icon('trash')}</button>
                  </div></td>
                </tr>`;
              }
            }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('')}

    ${depositsHtml}

    <div class="section-divider"><span class="label">История снимков</span><div class="line"></div></div>
    <div class="card">
      ${state.snapshots.length === 0 ? `<div class="empty">${icon('clock')}<div class="empty-title">Снимков пока нет</div></div>` :
      `<div class="table-wrap"><table>
        <thead><tr><th>Дата</th><th style="text-align:right">Капитал, BYN</th><th></th></tr></thead>
        <tbody>
        ${state.snapshots.slice().sort((a,b) => b.date.localeCompare(a.date)).map(s => `
          <tr><td class="mono">${fmtDate(s.date)}</td><td class="amt">${fmt(s.totalBYN,2)}</td>
          <td><div class="row-actions"><button class="icon-btn" data-delsnap="${s.id}">${icon('trash')}</button></div></td></tr>
        `).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;

  document.getElementById('actSnapshot2').addEventListener('click', takeSnapshot);
  root.querySelectorAll('[data-closedep]').forEach(b => b.addEventListener('click', () => closeDeposit(b.dataset.closedep)));
  const depToggle = root.querySelector('#depPrincipalToggle');
  if (depToggle) depToggle.addEventListener('change', () => {
    state.settings.depositsPrincipalOnly = depToggle.checked;
    save(); renderAll();
    toast(depToggle.checked ? 'Депозиты: только вложенное' : 'Депозиты: с накопленными %');
  });
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditAssetModal(b.dataset.edit)));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteAsset(b.dataset.del)));
  root.querySelectorAll('[data-history]').forEach(b => b.addEventListener('click', () => openAssetHistory(b.dataset.history)));
  root.querySelectorAll('[data-delsnap]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Удалить этот снимок?')) return;
    state.snapshots = state.snapshots.filter(s => s.id !== b.dataset.delsnap);
    save(); renderAll();
  }));
};

// ======= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОРТФЕЛЯ =======
function openEditAssetModal(assetId) {
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) return;
  const classKeys = ['cash', ...Object.keys(state.assetTypes)];
  openModal(`
    <div class="modal-head"><div class="modal-title">Редактировать актив</div><button class="icon-btn" id="mClose">${icon('x')}</button></div>
    <div class="field"><label>Название</label><input id="eAssetName" value="${escapeHtml(asset.name)}" /></div>
    <div class="field"><label>Тип</label><select id="eAssetClass">${classKeys.map(cls => `<option value="${cls}" ${asset.class === cls ? 'selected' : ''}>${getClassLabel(cls)}</option>`).join('')}</select></div>
    <div class="field"><label>Единица</label><input id="eAssetUnit" value="${escapeHtml(asset.unit||'')}" /></div>
    <div class="field"><label>Заметка</label><textarea id="eAssetNotes" rows="2">${escapeHtml(asset.notes||'')}</textarea></div>
    <div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Отмена</button><button class="btn btn-accent" id="eSave">Сохранить</button></div>
  `);
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  document.getElementById('eSave').addEventListener('click', () => {
    const name = document.getElementById('eAssetName').value.trim();
    const cls = document.getElementById('eAssetClass').value;
    const unit = document.getElementById('eAssetUnit').value.trim();
    const notes = document.getElementById('eAssetNotes').value.trim();
    if (!name) { toast('Введите название', 'danger'); return; }
    const conflict = state.assets.find(a => a.id !== asset.id && a.name === name && a.class === cls);
    if (conflict) { toast('Актив с таким именем и типом уже существует', 'danger'); return; }
    asset.name = name; asset.class = cls; asset.unit = unit; asset.notes = notes;
    asset.updatedAt = new Date().toISOString();
    logAction('edit_asset', `Изменён актив: ${name}`);
    save(); closeModal(); renderAll();
    toast('Актив обновлён');
  });
}

function deleteAsset(assetId) {
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) return;
  const hasTxs = state.transactions.some(t => t.assetId === assetId);
  if (hasTxs && !confirm(`Актив «${asset.name}» используется в транзакциях. Удаление удалит его из всех транзакций. Продолжить?`)) return;
  if (hasTxs) state.transactions.forEach(t => { if (t.assetId === assetId) delete t.assetId; });
  state.assets = state.assets.filter(a => a.id !== assetId);
  logAction('delete_asset', `Удалён актив: ${asset.name}`);
  save(); renderAll();
  toast('Актив удалён', 'danger');
}

function openAssetHistory(assetId) {
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset) { toast('Актив не найден', 'danger'); return; }
  const txs = state.transactions.filter(t => t.assetId === assetId).sort((a,b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  if (txs.length === 0) { toast('Нет транзакций', 'danger'); return; }
  let html = `
    <div class="modal-head"><div class="modal-title">История операций: ${escapeHtml(asset.name)}</div><button class="icon-btn" id="mClose">${icon('x')}</button></div>
    <div style="max-height:400px;overflow-y:auto;"><table style="width:100%;font-size:13px;">
      <thead><tr><th>Дата</th><th>Тип</th><th>Кол-во</th><th>Цена за ед.</th><th>Сумма</th><th>Валюта</th></tr></thead>
      <tbody>
        ${txs.map(t => `<tr>
          <td class="mono">${fmtDate(t.date)}</td>
          <td style="color:${t.type==='income'?'var(--positive)':'var(--negative)'};">${t.type==='income'?'Покупка':'Продажа'}</td>
          <td class="mono">${fmt(t.quantity,4)}</td>
          <td class="mono">${fmt(t.pricePerUnit,4)}</td>
          <td class="mono">${fmt(t.amount,2)}</td>
          <td>${t.currency}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="modal-foot"><button class="btn btn-ghost" id="mCancel">Закрыть</button></div>
  `;
  openModal(html);
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
}

// ======= VIEW: TRANSACTIONS (без экспорта CSV) =======
RENDERERS.transactions = function(root) {
  setActions(`<button class="btn btn-accent" id="actAddTx">${icon('plus')}Новая запись</button>`);
  const f = state.ui.txFilter;
  const allCats = ['all', ...state.categories.income, ...state.categories.expense];
  const uniqCats = [...new Set(allCats)];
  let list = state.transactions.slice();
  if (f.type !== 'all') list = list.filter(t => t.type === f.type);
  if (f.category !== 'all') list = list.filter(t => t.category === f.category);
  if (f.q) list = list.filter(t => (t.description||'').toLowerCase().includes(f.q.toLowerCase()) || t.category.toLowerCase().includes(f.q.toLowerCase()) || (t.assetName||'').toLowerCase().includes(f.q.toLowerCase()));
  list.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  // В доходы/расходы не включаем переводы, депозиты и операции с инвест-активами — это движение капитала
  const isRealFlow = t => t.txType !== 'transfer' && t.txType !== 'deposit' && (!t.assetClass || t.assetClass === 'cash');
  const totalIncome = list.filter(t => t.type === 'income' && isRealFlow(t)).reduce((s,t) => s + txAmountBYN(t), 0);
  const totalExpense = list.filter(t => t.type === 'expense' && isRealFlow(t)).reduce((s,t) => s + txAmountBYN(t), 0);
  root.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:18px">
      <div class="card"><div class="kpi"><div class="kpi-label">Доходы (фильтр)</div><div class="kpi-value" style="color:var(--positive)">${fmt(totalIncome,2)}</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-label">Расходы (фильтр)</div><div class="kpi-value" style="color:var(--negative)">${fmt(totalExpense,2)}</div></div></div>
    </div>
    <div class="card">
      <div class="filters">
        <select id="fType"><option value="all" ${f.type==='all'?'selected':''}>Все</option><option value="income" ${f.type==='income'?'selected':''}>Доход</option><option value="expense" ${f.type==='expense'?'selected':''}>Расход</option></select>
        <select id="fCat">${uniqCats.map(c => `<option value="${escapeHtml(c)}" ${f.category===c?'selected':''}>${c==='all'?'Все категории':escapeHtml(c)}</option>`).join('')}</select>
        <input type="search" id="fQ" placeholder="Поиск..." value="${escapeHtml(f.q)}">
        <button class="btn btn-ghost btn-sm" id="fReset">Сбросить</button>
      </div>
      <div class="table-wrap">
        ${list.length === 0 ? `<div class="empty">${icon('inbox')}<div class="empty-title">Записей не найдено</div></div>` :
        `<table>
          <thead><tr><th>Дата</th><th>Тип</th><th>Категория</th><th>Актив</th><th>Описание</th><th style="text-align:right">Сумма</th><th style="text-align:right">≈ BYN</th><th></th></tr></thead>
          <tbody>
          ${list.map(t => {
            let extra = '';
            if (t.assetName) {
              if (t.assetClass === 'cash') extra = `💰 ${escapeHtml(t.assetName)}`;
              else extra = `📈 ${escapeHtml(t.assetName)} (${fmt(t.quantity,4)})`;
            }
            return `<tr>
              <td class="mono">${fmtDate(t.date)}</td>
              <td><span class="tag"><span class="dot" style="background:${t.type==='income'?'var(--positive)':'var(--negative)'}"></span>${t.txType === 'transfer' ? 'Перевод' : (t.type==='income'?'Доход':'Расход')}${t.txType === 'deposit' ? ' 💰' : ''}${t.txType === 'transfer' ? ' ⇄' : ''}</span></td>
              <td>${escapeHtml(t.category)}</td>
              <td>${extra || '—'}</td>
              <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.description||'')}">${escapeHtml(t.description||'—')}</td>
              <td class="amt ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'}${fmt(t.amount,2)} ${t.currency}</td>
              <td class="amt">${fmt(txAmountBYN(t),2)}</td>
              <td><div class="row-actions"><button class="icon-btn" data-edit="${t.id}">${icon('edit')}</button><button class="icon-btn" data-del="${t.id}">${icon('trash')}</button></div></td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`}
      </div>
    </div>
  `;
  document.getElementById('actAddTx').addEventListener('click', () => openTxModal());
  document.getElementById('fType').addEventListener('change', e => { f.type = e.target.value; save(); renderAll(); });
  document.getElementById('fCat').addEventListener('change', e => { f.category = e.target.value; save(); renderAll(); });
  // Дебаунс + восстановление фокуса: раньше каждый символ вызывал полный ререндер и поле теряло фокус
  let qTimer = null;
  document.getElementById('fQ').addEventListener('input', e => {
    f.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      save(); renderAll();
      const el = document.getElementById('fQ');
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 300);
  });
  document.getElementById('fReset').addEventListener('click', () => { state.ui.txFilter = { type:'all', category:'all', q:'' }; save(); renderAll(); });

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTxModal(b.dataset.edit)));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteTx(b.dataset.del)));
};

// ======= МОДАЛЬНОЕ ОКНО ТРАНЗАКЦИИ =======
function openTxModal(editId) {
  const editing = editId ? state.transactions.find(t => t.id === editId) : null;
  if (editing && editing.txType === 'transfer') {
    toast('Это связанная кассовая проводка — редактируйте основную операцию (с активом или депозитом), она обновится автоматически.', 'danger');
    return;
  }
  const defaultType = editing ? editing.txType : 'income';
  const txType = defaultType || 'income';
  const cats = state.categories;
  const assetClass = editing ? editing.assetClass : 'cash';
  const assetTicker = editing ? editing.assetName : '';
  const assetUnit = editing ? editing.assetUnit : '';
  const quantity = editing ? editing.quantity : '';
  const pricePerUnit = editing ? editing.pricePerUnit : '';
  const currency = editing ? editing.currency : 'BYN';
  const depositData = editing && editing.depositData ? editing.depositData : null;

  const showIncomeExpense = (txType === 'income' || txType === 'expense');
  const showDeposit = (txType === 'deposit');

  const classKeys = ['cash', ...Object.keys(state.assetTypes)];
  const classSelectHtml = classKeys.map(cls => `<option value="${cls}" ${cls === assetClass ? 'selected' : ''}>${getClassLabel(cls)}</option>`).join('');
  let tickers = [];
  if (assetClass !== 'cash' && state.assetTypes[assetClass]) {
    tickers = state.assetTypes[assetClass].tickers || [];
  }
  const tickerSelectHtml = tickers.map(t => `<option value="${escapeHtml(t)}" ${t === assetTicker ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const isCash = assetClass === 'cash';

  openModal(`
    <div class="modal-head"><div class="modal-title">${editing ? 'Изменить запись' : 'Новая запись'}</div><button class="icon-btn" id="mClose">${icon('x')}</button></div>
    <div class="seg" id="txTypeSeg">
      <button type="button" data-type="income" class="${txType === 'income' ? 'active' : ''}">Доход</button>
      <button type="button" data-type="expense" class="${txType === 'expense' ? 'active' : ''}">Расход</button>
      <button type="button" data-type="deposit" class="${txType === 'deposit' ? 'active' : ''}">Вклад</button>
    </div>
    <div style="height:13px"></div>

    <div class="field-row">
      <div class="field"><label>Дата</label><input type="date" id="txDate" value="${editing ? editing.date : todayISO()}"></div>
      <div class="field"><label>Категория</label><select id="txCategory"></select></div>
    </div>
    <div class="field"><label>Описание</label><textarea id="txDesc" rows="2">${editing ? escapeHtml(editing.description||'') : ''}</textarea></div>

    <div id="incomeExpenseBlock" style="${showIncomeExpense ? '' : 'display:none'}">
      <div class="field-row">
        <div class="field"><label>Сумма</label><input type="number" step="0.01" class="mono" id="txAmount" value="${editing ? editing.amount : ''}" placeholder="0.00"></div>
        <div class="field"><label>Валюта</label><select id="txCurrency" class="mono">${['BYN','USD','EUR','RUB'].map(c => `<option value="${c}" ${(editing && editing.currency === c) || c === currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Курс к BYN</label><input type="number" step="0.0001" class="mono" id="txRate" value="${editing ? editing.rate : ''}" placeholder="напр. 3.40"></div>
      <div class="section-divider"><span class="label">Привязка к активу</span><div class="line"></div></div>
      <div class="field"><label>Тип актива</label><select id="txAssetClass">${classSelectHtml}</select></div>
      <div id="tickerField" style="${isCash ? 'display:none' : ''}">
        <div class="field"><label>Тикер</label><select id="txAssetTicker"><option value="">— выберите —</option>${tickerSelectHtml}</select></div>
        <div class="field"><label>Единица</label><input id="txAssetUnit" value="${editing ? escapeHtml(assetUnit) : ''}" placeholder="BTC / шт / г"></div>
      </div>
      <div id="investFields" style="${isCash ? 'display:none' : ''}">
        <div class="field-row">
          <div class="field"><label>Количество</label><input type="number" step="any" class="mono" id="txQty" value="${quantity}" placeholder="0.00"></div>
          <div class="field"><label>Цена за единицу, BYN</label><input type="number" step="any" class="mono" id="txPricePerUnit" value="${pricePerUnit}" placeholder="0.00"></div>
        </div>
        <div class="hint">Сумма = Количество × Цена (в BYN) / курс</div>
        <div class="field" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="txLinkCash" ${editing ? (editing.linkedTransferId ? 'checked' : '') : 'checked'} style="width:auto;">
            Провести через кэш (при покупке — списать, при продаже — зачислить)
          </label>
          <div class="hint">Двойная запись: без этого капитал задваивается — деньги остаются в кэше и одновременно появляется актив.</div>
        </div>
      </div>
      <div id="cashHint" style="${isCash ? '' : 'display:none'}" class="hint">Для кэша укажите только сумму.</div>
    </div>

    <div id="depositBlock" style="${showDeposit ? '' : 'display:none'}">
      <div class="field-row">
        <div class="field"><label>Сумма вклада</label><input type="number" step="0.01" class="mono" id="depAmount" value="${depositData ? depositData.amount : ''}" placeholder="0.00"></div>
        <div class="field"><label>Валюта</label><select id="depCurrency" class="mono">${['BYN','USD','EUR','RUB'].map(c => `<option value="${c}" ${depositData && depositData.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Годовая ставка (%)</label><input type="number" step="0.01" class="mono" id="depRate" value="${depositData ? depositData.rate : ''}" placeholder="10.0"></div>
        <div class="field"><label>Срок (месяцев)</label><input type="number" step="1" class="mono" id="depTerm" value="${depositData ? depositData.termMonths : ''}" placeholder="12"></div>
      </div>
      <div class="field"><label><input type="checkbox" id="depCapitalization" ${depositData && depositData.capitalization ? 'checked' : ''}> Капитализация процентов</label></div>
      <div class="field"><label>Дата открытия</label><input type="date" id="depStartDate" value="${depositData ? depositData.startDate : todayISO()}"></div>
      <div class="hint">Деньги будут списаны с кэша в указанной валюте.</div>
    </div>

    <div class="modal-foot">
      ${editing ? `<button class="btn btn-danger" id="txDelete">Удалить</button>` : ''}
      <button class="btn btn-ghost" id="mCancel">Отмена</button>
      <button class="btn btn-accent" id="txSave">${editing ? 'Сохранить' : 'Добавить'}</button>
    </div>
  `);

  let curType = txType === 'deposit' ? 'expense' : txType;
  function fillCats() {
    const sel = document.getElementById('txCategory');
    const catsList = curType === 'income' ? cats.income : cats.expense;
    sel.innerHTML = catsList.map(c => `<option value="${escapeHtml(c)}" ${editing && editing.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }
  fillCats();

  document.querySelectorAll('#txTypeSeg button').forEach(b => {
    b.addEventListener('click', function() {
      const type = this.dataset.type;
      document.querySelectorAll('#txTypeSeg button').forEach(x => x.classList.toggle('active', x === this));
      curType = type === 'deposit' ? 'expense' : type;
      fillCats();
      document.getElementById('incomeExpenseBlock').style.display = (type === 'income' || type === 'expense') ? '' : 'none';
      document.getElementById('depositBlock').style.display = type === 'deposit' ? '' : 'none';
    });
  });

  function syncRateField(useStoredRate) {
    const cur = document.getElementById('txCurrency').value;
    const rateInput = document.getElementById('txRate');
    if (cur === 'BYN') { rateInput.value = 1; rateInput.disabled = true; }
    else { rateInput.disabled = false; rateInput.value = (useStoredRate && editing) ? editing.rate : rateFor(cur); }
  }
  document.getElementById('txCurrency').addEventListener('change', () => syncRateField(false));
  syncRateField(true);

  document.getElementById('txAssetClass').addEventListener('change', function() {
    const cls = this.value;
    const isCash = cls === 'cash';
    const tickerSelect = document.getElementById('txAssetTicker');
    const tickerField = document.getElementById('tickerField');
    const investFields = document.getElementById('investFields');
    const cashHint = document.getElementById('cashHint');
    if (isCash) {
      tickerField.style.display = 'none';
      investFields.style.display = 'none';
      cashHint.style.display = '';
    } else {
      tickerField.style.display = '';
      investFields.style.display = '';
      cashHint.style.display = 'none';
      const tickers = (state.assetTypes[cls] && state.assetTypes[cls].tickers) || [];
      tickerSelect.innerHTML = '<option value="">— выберите —</option>' + tickers.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      if (tickers.includes(assetTicker)) tickerSelect.value = assetTicker;
    }
  });
  document.getElementById('txAssetClass').dispatchEvent(new Event('change'));

  function calcAmount() {
    const cls = document.getElementById('txAssetClass').value;
    if (cls === 'cash') {
      document.getElementById('txAmount').disabled = false;
      return;
    }
    const qty = parseFloat(document.getElementById('txQty').value);
    const price = parseFloat(document.getElementById('txPricePerUnit').value);
    const currency = document.getElementById('txCurrency').value;
    const rate = currency === 'BYN' ? 1 : (parseFloat(document.getElementById('txRate').value) || 1);
    if (!isNaN(qty) && !isNaN(price) && qty > 0 && price > 0) {
      const amount = qty * price / rate;
      document.getElementById('txAmount').value = amount.toFixed(2);
      document.getElementById('txAmount').disabled = true;
    } else {
      document.getElementById('txAmount').disabled = false;
    }
  }
  document.getElementById('txQty').addEventListener('input', calcAmount);
  document.getElementById('txPricePerUnit').addEventListener('input', calcAmount);
  document.getElementById('txCurrency').addEventListener('change', calcAmount);
  document.getElementById('txRate').addEventListener('input', calcAmount);
  document.getElementById('txAssetClass').addEventListener('change', calcAmount);

  if (editing && editing.assetName && editing.assetClass !== 'cash') {
    calcAmount();
  }

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  if (editing) document.getElementById('txDelete').addEventListener('click', () => { closeModal(); deleteTx(editing.id); });

  document.getElementById('txSave').addEventListener('click', () => {
    const date = document.getElementById('txDate').value;
    const category = document.getElementById('txCategory').value;
    const description = document.getElementById('txDesc').value.trim();
    const txType = document.querySelector('#txTypeSeg .active').dataset.type;

    if (!date || !category) { toast('Заполните дату и категорию', 'danger'); return; }

    if (txType === 'deposit') {
      const amount = parseFloat(document.getElementById('depAmount').value);
      const currency = document.getElementById('depCurrency').value;
      const rate = parseFloat(document.getElementById('depRate').value);
      const termMonths = parseInt(document.getElementById('depTerm').value);
      const capitalization = document.getElementById('depCapitalization').checked;
      const startDate = document.getElementById('depStartDate').value;

      if (!amount || amount <= 0) { toast('Введите сумму депозита', 'danger'); return; }
      if (!rate || rate <= 0) { toast('Введите ставку', 'danger'); return; }
      if (!termMonths || termMonths <= 0) { toast('Введите срок', 'danger'); return; }
      if (!startDate) { toast('Выберите дату открытия', 'danger'); return; }

      const cashAsset = state.assets.find(a => a.class === 'cash' && a.unit === currency);
      // считаем остаток по транзакциям (a.quantity может быть устаревшим)
      let available = cashAsset ? computeAssetQuantity(cashAsset.id) : 0;
      // при редактировании старое списание нужно вернуть в доступный остаток
      if (editing && editing.txType === 'deposit' && editing.currency === currency) {
        available += editing.quantity || 0;
      }
      if (available < amount) {
        toast(`Недостаточно средств в кэше (${currency}). Доступно: ${fmt(available,2)}`, 'danger');
        return;
      }

      const depositData = { amount, currency, rate, termMonths, capitalization, startDate };

      if (editing && editing.txType === 'deposit') {
        // ИСПРАВЛЕНО: раньше редактирование создавало дубликат депозита и транзакции
        const dep = editing.depositId
          ? state.deposits.find(d => d.id === editing.depositId)
          : state.deposits.find(d => editing.depositData && d.amount === editing.depositData.amount && d.currency === editing.depositData.currency && d.startDate === editing.depositData.startDate);
        Object.assign(editing, {
          date: startDate, category, amount, currency, rate: rateFor(currency),
          description: description || `Открытие депозита на ${fmt(amount,2)} ${currency}`,
          assetId: cashAsset ? cashAsset.id : null,
          assetName: cashAsset ? cashAsset.name : null,
          assetClass: 'cash', assetUnit: currency,
          quantity: amount, pricePerUnit: 1, depositData
        });
        if (dep) {
          Object.assign(dep, { amount, currency, rate, termMonths, capitalization, startDate });
          editing.depositId = dep.id;
        }
        logAction('edit_deposit', `Изменён депозит на ${fmt(amount,2)} ${currency}`);
        save(); closeModal(); renderAll();
        toast('Депозит обновлён');
        return;
      }

      const deposit = {
        id: uid(),
        amount, currency, rate, termMonths, capitalization, startDate,
        createdAt: new Date().toISOString()
      };
      state.deposits.push(deposit);

      const tx = {
        id: uid(),
        date: startDate,
        type: 'expense',
        category: category,
        amount: amount,
        currency: currency,
        rate: rateFor(currency),
        description: description || `Открытие депозита на ${fmt(amount,2)} ${currency}`,
        createdAt: new Date().toISOString(),
        assetId: cashAsset ? cashAsset.id : null,
        assetName: cashAsset ? cashAsset.name : null,
        assetClass: 'cash',
        assetUnit: currency,
        quantity: amount,
        pricePerUnit: 1,
        txType: 'deposit',
        depositId: deposit.id,
        depositData
      };
      state.transactions.push(tx);

      logAction('add_deposit', `Открыт депозит на ${fmt(amount,2)} ${currency}`);
      save();
      closeModal();
      renderAll();
      toast('Депозит открыт');
      return;
    }

    // Обработка доходов/расходов
    const currency = document.getElementById('txCurrency').value;
    const rate = currency === 'BYN' ? 1 : (parseFloat(document.getElementById('txRate').value) || 1);
    let amount = parseFloat(document.getElementById('txAmount').value);
    const assetClass = document.getElementById('txAssetClass').value;
    const ticker = document.getElementById('txAssetTicker').value.trim();
    const assetUnit = document.getElementById('txAssetUnit').value.trim();
    let qty = parseFloat(document.getElementById('txQty').value);
    let price = parseFloat(document.getElementById('txPricePerUnit').value);

    if (isNaN(amount) || amount <= 0) { toast('Введите сумму', 'danger'); return; }

    let finalAssetName = '', finalQty = 0, finalPrice = 0, finalAssetUnit = assetUnit, assetId = null, finalAssetClass = assetClass;

    if (assetClass === 'cash') {
      finalAssetUnit = currency;
      finalAssetName = `Наличные (${currency})`;
      finalQty = amount;
      finalPrice = 1;
      let existing = state.assets.find(a => a.class === 'cash' && a.unit === currency);
      if (existing) {
        assetId = existing.id;
        finalAssetName = existing.name;
      } else {
        const newAsset = { id: uid(), name: finalAssetName, class: 'cash', unit: currency, priceBYN: rate, notes: '', updatedAt: new Date().toISOString() };
        state.assets.push(newAsset);
        assetId = newAsset.id;
        logAction('add_asset_auto', `Создан кэш-актив: ${finalAssetName}`);
      }
    } else {
      if (!ticker) { toast('Выберите тикер', 'danger'); return; }
      if (isNaN(qty) || qty <= 0) { toast('Укажите количество', 'danger'); return; }
      if (isNaN(price) || price <= 0) { toast('Укажите цену', 'danger'); return; }
      let existingAsset = state.assets.find(a => a.class === assetClass && a.name.toLowerCase() === ticker.toLowerCase());
      if (curType === 'expense') {
        if (!existingAsset) { toast('Актив не найден в портфеле. Сначала купите его (Доход).', 'danger'); return; }
        const available = computeAssetQuantity(existingAsset.id);
        let oldQtyEffect = 0;
        if (editing && editing.assetId === existingAsset.id) {
          if (editing.type === 'income') oldQtyEffect = editing.quantity || 0;
          else oldQtyEffect = -(editing.quantity || 0);
        }
        const effectiveAvailable = available - oldQtyEffect;
        if (qty > effectiveAvailable) { toast(`Недостаточно актива. Доступно: ${fmt(effectiveAvailable,4)}`, 'danger'); return; }
        assetId = existingAsset.id;
        finalAssetName = existingAsset.name;
        finalAssetUnit = existingAsset.unit;
      } else {
        if (existingAsset) {
          assetId = existingAsset.id;
          finalAssetName = existingAsset.name;
          finalAssetUnit = existingAsset.unit;
        } else {
          const newAsset = { id: uid(), name: ticker, class: assetClass, unit: assetUnit, priceBYN: 0, notes: '', updatedAt: new Date().toISOString() };
          state.assets.push(newAsset);
          assetId = newAsset.id;
          finalAssetName = newAsset.name;
          finalAssetUnit = newAsset.unit;
          logAction('add_asset_auto', `Создан актив: ${ticker} (${assetClass})`);
        }
      }
      amount = qty * price / rate;
      finalQty = qty;
      finalPrice = price;
    }

    const linkCashEl = document.getElementById('txLinkCash');
    const linkCash = assetClass !== 'cash' && !!(linkCashEl && linkCashEl.checked);

    // Проверка остатка кэша при покупке актива «через кэш»
    if (linkCash && curType === 'income') {
      const cash = state.assets.find(a => a.class === 'cash' && a.unit === currency);
      let avail = cash ? computeAssetQuantity(cash.id) : 0;
      if (editing && editing.linkedTransferId) {
        const oldLeg = state.transactions.find(x => x.id === editing.linkedTransferId);
        if (oldLeg && cash && oldLeg.assetId === cash.id) {
          avail += oldLeg.type === 'expense' ? (oldLeg.quantity || 0) : -(oldLeg.quantity || 0);
        }
      }
      if (amount > avail + 1e-9) {
        toast(`Недостаточно кэша (${currency}): доступно ${fmt(avail,2)}. Пополните кэш или снимите галочку «Провести через кэш».`, 'danger');
        return;
      }
    }

    let savedTx;
    if (editing) {
      Object.assign(editing, { date, type: curType, category, amount, currency, rate, description, assetId, assetName: finalAssetName, assetClass: finalAssetClass, assetUnit: finalAssetUnit, quantity: finalQty, pricePerUnit: finalPrice, txType: 'income_expense' });
      savedTx = editing;
      logAction('edit_tx', `Изменена запись: ${category}, ${amount} ${currency}`);
      toast('Запись обновлена');
    } else {
      savedTx = { id: uid(), date, type: curType, category, amount, currency, rate, description, createdAt: new Date().toISOString(), assetId, assetName: finalAssetName, assetClass: finalAssetClass, assetUnit: finalAssetUnit, quantity: finalQty, pricePerUnit: finalPrice, txType: 'income_expense' };
      state.transactions.push(savedTx);
      logAction('add_tx', `Добавлена запись: ${category}, ${amount} ${currency}`);
      toast('Запись добавлена');
    }
    syncTransferLeg(savedTx, linkCash);
    save(); closeModal(); renderAll();
  });
}

// ======= deleteTx (ИСПРАВЛЕНА — депозит удаляется только после подтверждения) =======
function deleteTx(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  let depositToRemove = null;
  if (t.txType === 'deposit') {
    depositToRemove = (t.depositId && state.deposits.find(d => d.id === t.depositId)) ||
      (t.depositData && state.deposits.find(d =>
        d.amount === t.depositData.amount &&
        d.currency === t.depositData.currency &&
        d.startDate === t.depositData.startDate
      )) || null;
  }
  // связанная кассовая проводка (в любую сторону)
  const idsToRemove = new Set([id]);
  if (t.linkedTransferId) idsToRemove.add(t.linkedTransferId);
  if (t.txType === 'transfer' && t.linkId) idsToRemove.add(t.linkId);
  const pairNote = idsToRemove.size > 1 ? '\nСвязанная кассовая проводка будет удалена вместе с ней.' : '';
  if (!confirm(`Удалить запись «${t.category}» на ${fmt(t.amount,2)} ${t.currency}?${pairNote}`)) return;
  if (depositToRemove) {
    state.deposits = state.deposits.filter(d => d !== depositToRemove);
  }
  state.transactions = state.transactions.filter(x => !idsToRemove.has(x.id) && !(x.linkedTransferId && idsToRemove.has(x.linkedTransferId)));
  // подчистить осиротевшие ссылки
  state.transactions.forEach(x => {
    if (x.linkedTransferId && !state.transactions.some(y => y.id === x.linkedTransferId)) delete x.linkedTransferId;
  });
  logAction('delete_tx', `Удалена запись: ${t.category}, ${t.amount} ${t.currency}`);
  save(); renderAll();
  toast('Запись удалена', 'danger');
}

// (exportTransactionsCsv оставлен для возможного использования, но нигде не вызывается)
function exportTransactionsCsv(list) {
  const rows = [['Дата','Тип','Категория','Актив','Описание','Сумма','Валюта','Сумма BYN','Кол-во','Цена']];
  list.forEach(t => {
    const typeLabel = t.txType==='transfer' ? 'Перевод' : (t.txType==='deposit' ? 'Депозит' : (t.type==='income'?'Доход':'Расход'));
    rows.push([t.date, typeLabel, t.category, t.assetName||'', (t.description||'').replace(/[\n,]/g,' '), t.amount, t.currency, txAmountBYN(t).toFixed(2), t.quantity||'', t.pricePerUnit||'']);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile('transactions_'+todayISO()+'.csv', csv, 'text/csv;charset=utf-8');
  toast('CSV экспортирован');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ======= DASHBOARD (без кнопки снимка, ИСПРАВЛЕНО ОТОБРАЖЕНИЕ ПРИБЫЛИ) =======
// app.js
RENDERERS.dashboard = (root) => renderDashboard(root, {
  setActions, computeMonthFlow, computeAvgMonthlyExpense,
  computeAvgMonthlySavings, getClassLabel, Chart, charts, goTo
});

// ======= ОТЧЁТ ДЛЯ ИИ =======
// Максимально полный текстовый слепок бюджета для анализа в ChatGPT/Claude.
function buildAIReportText() {
  refreshAssets();
  const usdRate = state.rates.USD || 1;
  const { byClass, total: portfolioTotal } = computePortfolioTotals();
  const depFact = computeDepositsTotal(true);
  const capital = portfolioTotal + depFact;
  const L = [];
  L.push('Ты — опытный финансовый консультант. Ниже полный слепок моего личного бюджета (валюта учёта — белорусский рубль BYN).');
  L.push('Проанализируй: 1) структуру и диверсификацию, 2) риски (валютные, концентрация, ликвидность), 3) доходность по классам активов, 4) динамику капитала и норму сбережений, 5) размер подушки безопасности. Дай конкретные рекомендации, что изменить. Задай уточняющие вопросы, если данных не хватает.');
  L.push('');
  L.push('# ОБЩЕЕ');
  L.push('Дата отчёта: ' + todayISO());
  L.push('Курсы к BYN: USD ' + fmt(usdRate,4) + ', EUR ' + fmt(state.rates.EUR||0,4) + ', RUB ' + fmt(state.rates.RUB||0,4) + (state.rates.CNY ? ', CNY ' + fmt(state.rates.CNY,4) : ''));
  L.push('Общий капитал: ' + fmt(capital,2) + ' BYN (' + fmt(capital/usdRate,2) + ' USD)');
  L.push('');
  L.push('# СТРУКТУРА КАПИТАЛА');
  Object.entries(byClass).forEach(([cls, v]) => {
    if (v > 0.005) L.push('- ' + getClassLabel(cls) + ': ' + fmt(v,2) + ' BYN (' + fmt(capital>0?v/capital*100:0,1) + '%)');
  });
  if (depFact > 0) L.push('- Депозиты: ' + fmt(depFact,2) + ' BYN (' + fmt(capital>0?depFact/capital*100:0,1) + '%)');
  L.push('');
  L.push('# АКТИВЫ (детально)');
  L.push('Актив | Класс | Кол-во | Цена (USD) | Вложено BYN | Стоимость BYN | Прибыль BYN | ROI | XIRR | CAGR');
  state.assets.forEach(a => {
    if (a.class === 'cash') {
      L.push(a.name + ' | Кэш | ' + fmt(a.quantity,2) + ' ' + a.unit + ' | — | — | ' + fmt(a.currentValue||0,2) + ' | — | — | — | —');
    } else {
      L.push(a.name + ' | ' + getClassLabel(a.class) + ' | ' + fmt(a.quantity, a.class==='crypto'?6:4) + ' ' + (a.unit||'') +
        ' | ' + fmt(a.priceUSD||0,2) + ' | ' + fmt(a.invested||0,2) + ' | ' + fmt(a.currentValue||0,2) +
        ' | ' + fmt(a.profit||0,2) + ' | ' + fmtPct(a.roi||0) +
        ' | ' + (a.xirr!==null&&a.xirr!==undefined ? fmtPct(a.xirr) : '—') +
        ' | ' + (a.cagr!==null&&a.cagr!==undefined ? fmtPct(a.cagr) : '—'));
    }
  });
  L.push('');
  L.push('# ДЕПОЗИТЫ');
  if (state.deposits.length === 0) L.push('Нет.');
  state.deposits.forEach(d => {
    const accrued = d.closed ? (d.closeValue||0) : computeDepositAccruedValue(d);
    L.push('- ' + fmt(d.amount,2) + ' ' + d.currency + ' под ' + fmt(d.rate,2) + '% на ' + d.termMonths + ' мес., капитализация: ' + (d.capitalization?'да':'нет') +
      ', открыт ' + fmtDate(d.startDate) + (d.closed ? ', ЗАКРЫТ ' + fmtDate(d.closeDate) : '') +
      '. Накоплено сейчас: ' + fmt(accrued,2) + ', к концу срока: ' + fmt(computeDepositFinalAmount(d),2));
  });
  L.push('');
  L.push('# ДИНАМИКА КАПИТАЛА (снимки)');
  const snaps = state.snapshots.slice().sort((a,b)=>a.date.localeCompare(b.date));
  if (snaps.length === 0) L.push('Нет снимков.');
  snaps.forEach((s,i) => {
    const prev = i>0 ? snaps[i-1].totalBYN : null;
    const chg = prev ? ' (' + fmtPct((s.totalBYN-prev)/prev*100) + ' к предыдущему)' : '';
    L.push('- ' + s.date + ': ' + fmt(s.totalBYN,2) + ' BYN' + chg);
  });
  L.push('');
  L.push('# ДЕНЕЖНЫЕ ПОТОКИ ПО МЕСЯЦАМ (последние 12)');
  L.push('Месяц | Доход | Расход | Чистые | Инвестировано');
  lastNMonthKeys(12).forEach(k => {
    const f = computeMonthFlow(k);
    if (f.income || f.expense || f.invested) L.push(k + ' | ' + fmt(f.income,2) + ' | ' + fmt(f.expense,2) + ' | ' + fmt(f.net,2) + ' | ' + fmt(f.invested,2));
  });
  L.push('');
  L.push('# ДОХОДЫ/РАСХОДЫ ПО КАТЕГОРИЯМ (последние 12 мес)');
  const keys12 = lastNMonthKeys(12);
  const inc = {}, exp = {};
  state.transactions.forEach(t => {
    if (!keys12.includes(monthKey(t.date))) return;
    if (t.txType === 'deposit' || t.txType === 'transfer') return;
    if (t.assetClass && t.assetClass !== 'cash') return;
    const v = txAmountBYN(t);
    if (t.type === 'income') inc[t.category] = (inc[t.category]||0)+v;
    else if (t.type === 'expense') exp[t.category] = (exp[t.category]||0)+v;
  });
  L.push('Доходы: ' + (Object.entries(inc).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+fmt(v,2)).join('; ') || 'нет данных'));
  L.push('Расходы: ' + (Object.entries(exp).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+fmt(v,2)).join('; ') || 'нет данных'));
  L.push('');
  L.push('# ПРИМЕЧАНИЯ');
  L.push('- Транзакций в журнале: ' + state.transactions.length + '. Часть позиций заведена стартовыми записями (перенос из Excel), поэтому помесячная история может быть неполной.');
  state.assets.filter(a=>a.notes).forEach(a => L.push('- ' + a.name + ': ' + a.notes));
  return L.join('\n');
}

function showAIReport() {
  const text = buildAIReportText();
  openModal(`
    <div class="modal-head"><div class="modal-title">🤖 Отчёт для ИИ</div><button class="icon-btn" onclick="closeModal()">${icon('x')}</button></div>
    <div class="hint" style="margin-bottom:10px;">Скопируй текст и вставь в ChatGPT или Claude — в начале уже есть промпт с задачей для анализа.</div>
    <textarea id="aiReportText" readonly style="width:100%;height:320px;background:var(--bg-elev);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:10px;font-family:var(--font-mono);font-size:11.5px;resize:vertical;">${escapeHtml(text)}</textarea>
    <div class="modal-foot">
      <button class="btn" id="aiReportDownload">${icon('download')} Скачать .txt</button>
      <button class="btn btn-accent" id="aiReportCopy">Скопировать</button>
    </div>
  `);
  document.getElementById('aiReportCopy').addEventListener('click', () => {
    const ta = document.getElementById('aiReportText');
    const done = () => toast('Отчёт скопирован');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); document.execCommand('copy'); done(); });
    else { ta.select(); document.execCommand('copy'); done(); }
  });
  document.getElementById('aiReportDownload').addEventListener('click', () => {
    const blob = new Blob([document.getElementById('aiReportText').value], {type:'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'budget_report_' + todayISO() + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ======= REPORTS (только меню "Отчёты", без кнопок CSV-фильтра) =======
RENDERERS.reports = function(root) {
  setActions(`
    <div class="btn-group" style="position:relative;display:inline-block;">
      <button class="btn btn-accent" id="exportReportsDropdownBtn">${icon('download')} Отчёты</button>
      <div id="exportReportsDropdownMenu" style="display:none;position:absolute;top:100%;right:0;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:4px 0;min-width:180px;z-index:50;">
        <button class="btn-export-option" data-export="brief" style="display:block;width:100%;padding:8px 16px;background:none;border:none;color:var(--text);text-align:left;font-size:13px;cursor:pointer;font-family:var(--font-body);">Краткий отчёт (CSV)</button>
        <button class="btn-export-option" data-export="full" style="display:block;width:100%;padding:8px 16px;background:none;border:none;color:var(--text);text-align:left;font-size:13px;cursor:pointer;font-family:var(--font-body);">Полный отчёт (CSV)</button>
        <button class="btn-export-option" data-export="html" style="display:block;width:100%;padding:8px 16px;background:none;border:none;color:var(--text);text-align:left;font-size:13px;cursor:pointer;font-family:var(--font-body);">Отчёт с графиками (HTML)</button>
        <button class="btn-export-option" data-export="ai" style="display:block;width:100%;padding:8px 16px;background:none;border:none;color:var(--accent);text-align:left;font-size:13px;cursor:pointer;font-family:var(--font-body);">🤖 Отчёт для ИИ (ChatGPT/Claude)</button>
      </div>
    </div>
  `);
  const n = state.ui.reportMonths || 6;
  const keys = lastNMonthKeys(n);
  const monthLabels = keys.map(k => { const [y,m]=k.split('-'); return new Date(y,m-1,1).toLocaleDateString('ru-RU',{month:'short',year:'2-digit'}); });
  const incomeSeries = keys.map(k => computeMonthFlow(k).income);
  const expenseSeries = keys.map(k => computeMonthFlow(k).expense);
  const savingsSeries = keys.map(k => computeMonthFlow(k).net);

  const inRange = state.transactions.filter(t => keys.includes(monthKey(t.date)));
  const byCatExpense = {};
  inRange.filter(t=>t.type==='expense').forEach(t => { byCatExpense[t.category] = (byCatExpense[t.category]||0) + txAmountBYN(t); });
  const byCatIncome = {};
  inRange.filter(t=>t.type==='income').forEach(t => { byCatIncome[t.category] = (byCatIncome[t.category]||0) + txAmountBYN(t); });
  const catExpenseSorted = Object.entries(byCatExpense).sort((a,b)=>b[1]-a[1]);
  const catIncomeSorted = Object.entries(byCatIncome).sort((a,b)=>b[1]-a[1]);
  const totalExp = catExpenseSorted.reduce((s,[,v])=>s+v,0);
  const totalInc = catIncomeSorted.reduce((s,[,v])=>s+v,0);

  const assetRoiData = state.assets.filter(a => a.class !== 'cash' && a.invested > 0).map(a => ({ name: a.name, roi: a.roi })).sort((a,b) => b.roi - a.roi);

  root.innerHTML = `
    <div class="filters">
      <span class="hint">Период:</span>
      <select id="repMonths">${[3,6,12,24].map(v => `<option value="${v}" ${n===v?'selected':''}>${v} мес.</option>`).join('')}</select>
    </div>
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="card"><div class="card-title">Денежный поток</div><canvas id="chartCashFlow" height="120"></canvas></div>
      <div class="card"><div class="card-title">Доходность активов</div>${assetRoiData.length > 0 ? `<canvas id="chartAssetRoi" height="120"></canvas>` : `<div class="empty">Нет данных</div>`}</div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-title">Доходы и расходы по месяцам</div><canvas id="chartFlow" height="90"></canvas></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Расходы по категориям</div>
        <div class="card-sub">За последние ${n} мес. · итого ${fmt(totalExp,2)} BYN</div>
        ${catExpenseSorted.length===0 ? `<div class="empty">Нет расходов</div>` : `
        <canvas id="chartCatExpense" height="180"></canvas>
        <div style="margin-top:14px">${catExpenseSorted.map(([cat,v]) => `<div class="list-row"><div>${escapeHtml(cat)}</div><div style="text-align:right"><div class="mono">${fmt(v,2)}</div><div class="hint">${fmt(totalExp>0?v/totalExp*100:0,1)}%</div></div></div>`).join('')}</div>`}
      </div>
      <div class="card">
        <div class="card-title">Доходы по категориям</div>
        <div class="card-sub">За последние ${n} мес. · итого ${fmt(totalInc,2)} BYN</div>
        ${catIncomeSorted.length===0 ? `<div class="empty">Нет доходов</div>` : `
        <canvas id="chartCatIncome" height="180"></canvas>
        <div style="margin-top:14px">${catIncomeSorted.map(([cat,v]) => `<div class="list-row"><div>${escapeHtml(cat)}</div><div style="text-align:right"><div class="mono">${fmt(v,2)}</div><div class="hint">${fmt(totalInc>0?v/totalInc*100:0,1)}%</div></div></div>`).join('')}</div>`}
      </div>
    </div>
  `;

  document.getElementById('repMonths').addEventListener('change', e => { state.ui.reportMonths = parseInt(e.target.value); save(); renderAll(); });

  const dropdownBtn = document.getElementById('exportReportsDropdownBtn');
  const dropdownMenu = document.getElementById('exportReportsDropdownMenu');
  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
  });
  // ИСПРАВЛЕНО: раньше при каждом рендере вкладки добавлялся новый глобальный слушатель (утечка)
  if (window.__reportsDocClick) document.removeEventListener('click', window.__reportsDocClick);
  window.__reportsDocClick = () => {
    const menu = document.getElementById('exportReportsDropdownMenu');
    if (menu) menu.style.display = 'none';
  };
  document.addEventListener('click', window.__reportsDocClick);
  dropdownMenu.querySelectorAll('.btn-export-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.export;
      if (type === 'brief') exportBriefReport();
      else if (type === 'full') exportFullReport();
      else if (type === 'html') exportHtmlReport();
      else if (type === 'ai') showAIReport();
      dropdownMenu.style.display = 'none';
    });
  });

  // Графики
  setTimeout(() => {
    if (!Chart) return;
    const canvasCash = document.getElementById('chartCashFlow');
    if (canvasCash) {
      if (charts.cashFlow) charts.cashFlow.destroy();
      charts.cashFlow = new Chart(canvasCash, {
        type: 'bar',
        data: { labels: monthLabels, datasets: [
          { label: 'Доход', data: incomeSeries, backgroundColor: '#4FAE7C', borderRadius: 4 },
          { label: 'Расход', data: expenseSeries, backgroundColor: '#D9685F', borderRadius: 4 },
          { label: 'Сбережения', data: savingsSeries, backgroundColor: '#D4A24C', borderRadius: 4 }
        ]},
        options: { responsive: true, maintainAspectRatio: true, scales: { x: { ticks: { color: '#8891A8' }, grid: { display: false } }, y: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } } }, plugins: { legend: { labels: { color: '#8891A8', font: { size: 10 } } } } }
      });
    }
    const canvasRoi = document.getElementById('chartAssetRoi');
    if (canvasRoi && assetRoiData.length > 0) {
      if (charts.assetRoi) charts.assetRoi.destroy();
      const sorted = assetRoiData.slice().sort((a,b) => b.roi - a.roi);
      charts.assetRoi = new Chart(canvasRoi, {
        type: 'bar',
        data: { labels: sorted.map(a => a.name), datasets: [{ data: sorted.map(a => a.roi), backgroundColor: sorted.map(a => a.roi >= 0 ? '#4FAE7C' : '#D9685F'), borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: true, scales: { x: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } }, y: { ticks: { color: '#8891A8' }, grid: { display: false } } }, plugins: { legend: { display: false } } }
      });
    }
    const canvasFlow = document.getElementById('chartFlow');
    if (canvasFlow) {
      if (charts.flow) charts.flow.destroy();
      charts.flow = new Chart(canvasFlow, {
        type: 'bar',
        data: { labels: monthLabels, datasets: [
          { label: 'Доход', data: incomeSeries, backgroundColor: '#4FAE7C', borderRadius: 4 },
          { label: 'Расход', data: expenseSeries, backgroundColor: '#D9685F', borderRadius: 4 }
        ]},
        options: { responsive: true, maintainAspectRatio: true, scales: { x: { ticks: { color: '#8891A8' }, grid: { display: false } }, y: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } } }, plugins: { legend: { labels: { color: '#8891A8' } } } }
      });
    }
    const canvasExpense = document.getElementById('chartCatExpense');
    if (canvasExpense && catExpenseSorted.length > 0) {
      if (charts.catExpense) charts.catExpense.destroy();
      charts.catExpense = new Chart(canvasExpense, {
        type: 'doughnut',
        data: { labels: catExpenseSorted.map(c => c[0]), datasets: [{ data: catExpenseSorted.map(c => c[1]), backgroundColor: ['#D9685F','#D4A24C','#9B7FD4','#6E8FD9','#4FAE7C','#E0C36B','#8891A8'], borderColor: '#161D2E', borderWidth: 2 }] },
        options: { plugins: { legend: { display: false } }, cutout: '62%' }
      });
    }
    const canvasIncome = document.getElementById('chartCatIncome');
    if (canvasIncome && catIncomeSorted.length > 0) {
      if (charts.catIncome) charts.catIncome.destroy();
      charts.catIncome = new Chart(canvasIncome, {
        type: 'doughnut',
        data: { labels: catIncomeSorted.map(c => c[0]), datasets: [{ data: catIncomeSorted.map(c => c[1]), backgroundColor: ['#4FAE7C','#6E8FD9','#D4A24C','#9B7FD4','#E0C36B','#D9685F','#8891A8'], borderColor: '#161D2E', borderWidth: 2 }] },
        options: { plugins: { legend: { display: false } }, cutout: '62%' }
      });
    }
  }, 50);
};

// ======= ФУНКЦИИ ЭКСПОРТА ОТЧЁТОВ (ИСПРАВЛЕНЫ CSV) =======
function exportBriefReport() {
  const usdRate = state.rates.USD || 1;
  const totalCapital = computeTotalCapital();
  const totalCapitalUSD = totalCapital / usdRate;
  const thisMonthKey = new Date().toISOString().slice(0,7);
  const flow = computeMonthFlow(thisMonthKey);
  const avgExpense3 = computeAvgMonthlyExpense(3);
  const cushion = avgExpense3 > 0 ? (totalCapital / avgExpense3) : null;
  const savingsRate = flow.income > 0 ? ((flow.income - flow.expense) / flow.income * 100) : 0;

  let totalInvested = 0, totalWithdrawn = 0, totalCurrent = 0;
  state.assets.forEach(a => {
    if (a.class !== 'cash') {
      totalInvested += a.invested || 0;
      totalWithdrawn += a.withdrawn || 0;
      totalCurrent += a.currentValue || 0;
    }
  });
  const totalProfit = totalWithdrawn + totalCurrent - totalInvested;
  const totalROI = totalInvested > 0 ? (totalProfit / totalInvested * 100) : 0;

  let rows = [
    ['Метрика', 'Значение'],
    ['Капитал (BYN)', fmt(totalCapital,2)],
    ['Капитал (USD)', fmt(totalCapitalUSD,2)],
    ['Доход за месяц', fmt(flow.income,2)],
    ['Расход за месяц', fmt(flow.expense,2)],
    ['Сбережения за месяц', fmt(flow.net,2)],
    ['Норма сбережений (%)', fmt(savingsRate,1)],
    ['Подушка (мес.)', cushion !== null ? fmt(cushion,1) : '—'],
    ['Вложено (BYN)', fmt(totalInvested,2)],
    ['Выведено (BYN)', fmt(totalWithdrawn,2)],
    ['Текущая стоимость (BYN)', fmt(totalCurrent,2)],
    ['Прибыль (BYN)', fmt(totalProfit,2)],
    ['ROI (%)', fmt(totalROI,1)],
    ['Кол-во активов', state.assets.length],
    ['Кол-во транзакций', state.transactions.length],
    ['Депозитов', state.deposits.length],
  ];

  const topAssets = state.assets.filter(a => a.class !== 'cash' && a.invested > 0).sort((a,b) => b.roi - a.roi).slice(0,3);
  rows.push(['Топ-1 актив', topAssets[0] ? topAssets[0].name + ' ('+fmtPct(topAssets[0].roi)+')' : '—']);
  rows.push(['Топ-2 актив', topAssets[1] ? topAssets[1].name + ' ('+fmtPct(topAssets[1].roi)+')' : '—']);
  rows.push(['Топ-3 актив', topAssets[2] ? topAssets[2].name + ' ('+fmtPct(topAssets[2].roi)+')' : '—']);

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile('ledger_brief_report.csv', csv, 'text/csv;charset=utf-8');
  toast('Краткий отчёт скачан');
}

function exportFullReport() {
  const usdRate = state.rates.USD || 1;
  let rows = [];

  rows.push(['=== ТРАНЗАКЦИИ ===']);
  rows.push(['Дата','Тип','Категория','Актив','Описание','Сумма','Валюта','Сумма BYN','Кол-во','Цена за ед. BYN']);
  state.transactions.forEach(t => {
    rows.push([
      t.date,
      t.txType==='transfer' ? 'Перевод' : (t.txType==='deposit' ? 'Депозит' : (t.type==='income'?'Доход':'Расход')),
      t.category,
      t.assetName||'',
      (t.description||'').replace(/[\n,]/g,' '),
      fmt(t.amount,2),
      t.currency,
      fmt(txAmountBYN(t),2),
      fmt(t.quantity||0,4),
      fmt(t.pricePerUnit||0,4)
    ]);
  });

  rows.push(['=== АКТИВЫ ===']);
  rows.push(['Тикер','Тип','Кол-во','Ед.','% в типе','Вложено (BYN)','Вложено (USD)','Текущая стоимость (BYN)','Текущая стоимость (USD)','Прибыль (BYN)','Прибыль (USD)','ROI','XIRR','CAGR','Обновлено']);
  state.assets.forEach(a => {
    const catTotal = state.assets.filter(x => x.class === a.class).reduce((s,x) => s + assetValueBYN(x), 0);
    const share = catTotal > 0 ? (assetValueBYN(a) / catTotal * 100) : 0;
    const xirrDisplay = (a.xirr !== null && a.xirr !== undefined) ? (a.xirrProvisional ? fmtPct(a.xirr)+'*' : fmtPct(a.xirr)) : '—';
    rows.push([
      a.name,
      getClassLabel(a.class),
      fmt(a.quantity,4),
      a.unit||'',
      fmt(share,1),
      fmt(a.invested||0,2),
      fmt(a.investedUSD||0,2),
      fmt(a.currentValue||0,2),
      fmt(a.currentValueUSD||0,2),
      fmt(a.profit||0,2),
      fmt(a.profitUSD||0,2),
      fmtPct(a.roi||0),
      xirrDisplay,
      (a.cagr!==null && a.cagr!==undefined) ? fmtPct(a.cagr) : '—',
      a.updatedAt ? fmtDate(a.updatedAt) : '—'
    ]);
  });

  rows.push(['=== ДЕПОЗИТЫ ===']);
  rows.push(['Валюта','Сумма','Ставка','Срок мес.','Капитализация','Дата открытия','Статус','Прибыль (за весь срок)']);
  state.deposits.forEach(d => {
    const final = computeDepositFinalAmount(d);
    const profit = final - d.amount;
    const matured = isDepositMatured(d);
    rows.push([
      d.currency,
      fmt(d.amount,2),
      fmt(d.rate,1),
      d.termMonths,
      d.capitalization ? 'Да' : 'Нет',
      fmtDate(d.startDate),
      matured ? 'Погашен' : 'Активен',
      fmt(profit,2)
    ]);
  });

  rows.push(['=== ОБЩИЕ МЕТРИКИ ===']);
  const flow = computeMonthFlow(new Date().toISOString().slice(0,7));
  rows.push(['Капитал (BYN)', fmt(computeTotalCapital(),2)]);
  rows.push(['Капитал (USD)', fmt(computeTotalCapital()/usdRate,2)]);
  rows.push(['Доход за месяц', fmt(flow.income,2)]);
  rows.push(['Расход за месяц', fmt(flow.expense,2)]);
  rows.push(['Сбережения за месяц', fmt(flow.net,2)]);

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile('ledger_full_report.csv', csv, 'text/csv;charset=utf-8');
  toast('Полный отчёт скачан');
}

// ======= exportHtmlReport (ИСПРАВЛЕНА — добавлены CSS-переменные для цветов) =======
function exportHtmlReport() {
  const usdRate = state.rates.USD || 1;
  const totalCapital = computeTotalCapital();
  const totalCapitalUSD = totalCapital / usdRate;
  const flow = computeMonthFlow(new Date().toISOString().slice(0,7));
  const avgExpense3 = computeAvgMonthlyExpense(3);
  const cushion = avgExpense3 > 0 ? (totalCapital / avgExpense3) : null;

  const snapshots = state.snapshots.slice().sort((a,b) => a.date.localeCompare(b.date));
  const capLabels = snapshots.map(s => fmtDate(s.date));
  const capData = snapshots.map(s => s.totalBYN);

  const monthKeys = lastNMonthKeys(6).reverse();
  const monthLabels = monthKeys.map(k => { const [y,m]=k.split('-'); return new Date(y,m-1,1).toLocaleDateString('ru-RU',{month:'short',year:'2-digit'}); });
  const incomeData = monthKeys.map(k => computeMonthFlow(k).income);
  const expenseData = monthKeys.map(k => computeMonthFlow(k).expense);

  const byClass = computePortfolioTotals().byClass;
  const classNames = Object.keys(byClass).filter(cls => byClass[cls] > 0);
  const pieLabels = classNames.map(cls => getClassLabel(cls));
  const pieData = classNames.map(cls => byClass[cls]);

  const assetRows = state.assets.filter(a => a.class !== 'cash' && a.invested > 0)
    .sort((a,b) => b.roi - a.roi)
    .map(a => {
      const catTotal = state.assets.filter(x => x.class === a.class).reduce((s,x) => s + assetValueBYN(x), 0);
      const share = catTotal > 0 ? (assetValueBYN(a) / catTotal * 100) : 0;
      const xirrDisplay = (a.xirr !== null && a.xirr !== undefined) ? (a.xirrProvisional ? fmtPct(a.xirr)+'*' : fmtPct(a.xirr)) : '—';
      return {
        name: a.name,
        share: share,
        investedUSD: a.investedUSD || 0,
        currentUSD: a.currentValueUSD || 0,
        profitUSD: a.profitUSD || 0,
        roi: a.roi || 0,
        xirrDisplay: xirrDisplay,
        cagr: (a.cagr !== null && a.cagr !== undefined) ? fmtPct(a.cagr) : '—',
        updated: a.updatedAt ? fmtDate(a.updatedAt) : '—'
      };
    });

  const htmlContent = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Финансовый отчёт</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --positive: #4FAE7C;
      --negative: #D9685F;
    }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0b0e14; color: #e8edf5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1, h2 { color: #b0caff; }
    .card { background: rgba(255,255,255,0.05); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .kpi-item { background: rgba(255,255,255,0.04); padding: 12px; border-radius: 8px; text-align: center; }
    .kpi-item .label { font-size: 11px; color: #8891A8; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-item .value { font-size: 22px; font-weight: 600; font-family: monospace; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #8891A8; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .mono { font-family: monospace; }
    .positive { color: #4FAE7C; }
    .negative { color: #D9685F; }
    .chart-box { padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; }
    canvas { max-height: 200px; width: 100% !important; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
    .xirr-provisional { color: #f2c94a; }
  </style>
</head>
<body>
<div class="container">
  <h1>📊 Финансовый отчёт</h1>
  <p style="color:#8891A8;">Дата генерации: ${new Date().toLocaleString()}</p>

  <div class="kpi">
    <div class="kpi-item"><div class="label">Капитал (BYN)</div><div class="value">${fmt(totalCapital,2)}</div></div>
    <div class="kpi-item"><div class="label">Капитал (USD)</div><div class="value">${fmt(totalCapitalUSD,2)}</div></div>
    <div class="kpi-item"><div class="label">Доход за месяц</div><div class="value positive">+${fmt(flow.income,2)}</div></div>
    <div class="kpi-item"><div class="label">Расход за месяц</div><div class="value negative">−${fmt(flow.expense,2)}</div></div>
    <div class="kpi-item"><div class="label">Сбережения</div><div class="value">${fmt(flow.net,2)}</div></div>
    <div class="kpi-item"><div class="label">Подушка</div><div class="value">${cushion!==null ? fmt(cushion,1)+' мес.' : '—'}</div></div>
  </div>

  <div class="grid">
    <div class="card"><h3>Рост капитала</h3><div class="chart-box"><canvas id="chartCapital"></canvas></div></div>
    <div class="card"><h3>Доходы / Расходы</h3><div class="chart-box"><canvas id="chartFlow"></canvas></div></div>
  </div>
  <div class="card"><h3>Распределение активов</h3><div class="chart-box"><canvas id="chartPie" height="150"></canvas></div></div>

  <div class="card">
    <h3>Активы (по ROI)</h3>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Тикер</th><th style="text-align:right">% в типе</th><th style="text-align:right">Вложено ($)</th><th style="text-align:right">Текущая ($)</th><th style="text-align:right">Прибыль ($)</th><th style="text-align:right">ROI</th><th style="text-align:right">XIRR</th><th style="text-align:right">CAGR</th><th>Обновлено</th></tr></thead>
        <tbody>
          ${assetRows.map(a => `
            <tr>
              <td>${escapeHtml(a.name)}</td>
              <td class="mono" style="text-align:right">${fmt(a.share,1)}%</td>
              <td class="mono" style="text-align:right">${fmt(a.investedUSD,2)}</td>
              <td class="mono" style="text-align:right">${fmt(a.currentUSD,2)}</td>
              <td class="mono" style="text-align:right;color:${a.profitUSD>=0?'var(--positive)':'var(--negative)'};">${fmt(a.profitUSD,2)}</td>
              <td class="mono" style="text-align:right;color:${a.roi>=0?'var(--positive)':'var(--negative)'};">${fmtPct(a.roi)}</td>
              <td class="mono" style="text-align:right;${a.xirrDisplay.includes('*') ? 'color:#f2c94a;' : 'color:'+(a.roi>=0?'var(--positive)':'var(--negative)')};">${a.xirrDisplay}</td>
              <td class="mono" style="text-align:right">${a.cagr}</td>
              <td class="hint">${a.updated}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>

  ${state.deposits.length > 0 ? `
  <div class="card">
    <h3>Депозиты</h3>
    <table>
      <thead><tr><th>Валюта</th><th>Сумма</th><th>Ставка</th><th>Срок</th><th>Капитализация</th><th>Дата открытия</th><th>Статус</th><th style="text-align:right">Прибыль</th></tr></thead>
      <tbody>
        ${state.deposits.map(d => `
          <tr>
            <td>${d.currency}</td>
            <td class="mono">${fmt(d.amount,2)}</td>
            <td class="mono">${fmt(d.rate,1)}%</td>
            <td class="mono">${d.termMonths}</td>
            <td>${d.capitalization ? 'Да' : 'Нет'}</td>
            <td class="hint">${fmtDate(d.startDate)}</td>
            <td>${isDepositMatured(d) ? 'Погашен' : 'Активен'}</td>
            <td class="mono" style="text-align:right;color:${computeDepositProfit(d)>=0?'var(--positive)':'var(--negative)'};">${fmt(computeDepositProfit(d),2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <p style="color:#8891A8; margin-top:20px;">Отчёт сгенерирован автоматически. Данные на ${new Date().toLocaleString()}.</p>
</div>

<script>
  const capLabels = ${JSON.stringify(capLabels)};
  const capData = ${JSON.stringify(capData)};
  const monthLabels = ${JSON.stringify(monthLabels)};
  const incomeData = ${JSON.stringify(incomeData)};
  const expenseData = ${JSON.stringify(expenseData)};
  const pieLabels = ${JSON.stringify(pieLabels)};
  const pieData = ${JSON.stringify(pieData)};

  new Chart(document.getElementById('chartCapital'), {
    type: 'line',
    data: { labels: capLabels, datasets: [{ label: 'Капитал, BYN', data: capData, borderColor: '#D4A24C', backgroundColor: 'rgba(212,162,76,0.1)', fill: true, tension: 0.2, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } }, x: { ticks: { color: '#8891A8' }, grid: { display: false } } } }
  });

  new Chart(document.getElementById('chartFlow'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: 'Доход', data: incomeData, backgroundColor: '#4FAE7C', borderRadius: 4 },
        { label: 'Расход', data: expenseData, backgroundColor: '#D9685F', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: { y: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } }, x: { ticks: { color: '#8891A8' }, grid: { display: false } } },
      plugins: { legend: { labels: { color: '#8891A8' } } }
    }
  });

  if (pieLabels.length) {
    new Chart(document.getElementById('chartPie'), {
      type: 'doughnut',
      data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: ['#D4A24C','#4FAE7C','#D9685F','#6E8FD9','#9B7FD4','#E0C36B','#8891A8'], borderColor: '#161D2E', borderWidth: 2 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: '#8891A8', font: { size: 10 } } } }, cutout: '60%' }
    });
  }
</script>
</body>
</html>
  `;

  downloadFile('ledger_report_with_charts.html', htmlContent, 'text/html;charset=utf-8');
  toast('HTML-отчёт скачан');
}

// ======= FORECAST =======
RENDERERS.forecast = function(root) {
  setActions(`<button class="btn btn-accent" id="actAddGoal">${icon('plus')}Новая цель</button>`);
  const snaps = state.snapshots.slice().sort((a,b) => a.date.localeCompare(b.date));
  const currentTotal = computeTotalCapital();
  const avgSavings3 = computeAvgMonthlySavings(3);
  const avgSavings6 = computeAvgMonthlySavings(6);

  let forecastNote = '', projLabels = [], projValues = [], lastRealIdx = -1;
  if (snaps.length >= 2) {
    const first = new Date(snaps[0].date).getTime();
    const pts = snaps.map(s => ({ x: (new Date(s.date).getTime() - first) / 86400000, y: s.totalBYN }));
    const lr = linearForecast(pts);
    projLabels = snaps.map(s => fmtDate(s.date));
    projValues = snaps.map(s => s.totalBYN);
    lastRealIdx = projValues.length - 1;
    if (lr) {
      const lastX = pts[pts.length - 1].x;
      for (let i = 1; i <= 6; i++) {
        const fx = lastX + i*30;
        const fy = lr.intercept + lr.slope * fx;
        const fd = new Date(first + fx * 86400000);
        projLabels.push(fmtDate(fd.toISOString()));
        projValues.push(Math.max(0, fy));
      }
      forecastNote = `Линейная регрессия по ${snaps.length} снимкам — тренд ${lr.slope >= 0 ? '+' : ''}${fmt(lr.slope * 30, 2)} BYN/мес.`;
    }
  } else {
    const monthly = avgSavings3 || avgSavings6 || 0;
    projLabels = ['Сейчас']; projValues = [currentTotal]; lastRealIdx = 0;
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setMonth(d.getMonth() + i);
      projLabels.push(d.toLocaleDateString('ru-RU', {month:'short', year:'2-digit'}));
      projValues.push(currentTotal + monthly * i);
    }
    forecastNote = snaps.length < 2 ? `Недостаточно снимков портфеля для тренда — прогноз построен по среднемесячной разнице доходов/расходов (${fmt(monthly,2)} BYN/мес). Сделайте 2+ снимка на вкладке «Портфель» для более точного прогноза.` : '';
  }

  root.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:18px">
      <div class="card"><div class="kpi"><div class="kpi-label">Капитал сейчас (BYN)</div><div class="kpi-value">${fmt(currentTotal,2)}</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-label">Сред. баланс/мес (3 мес.)</div><div class="kpi-value" style="color:${avgSavings3>=0?'var(--positive)':'var(--negative)'}">${avgSavings3>=0?'+':''}${fmt(avgSavings3,2)}</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-label">Сред. баланс/мес (6 мес.)</div><div class="kpi-value" style="color:${avgSavings6>=0?'var(--positive)':'var(--negative)'}">${avgSavings6>=0?'+':''}${fmt(avgSavings6,2)}</div></div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="card-title">Проекция капитала</div>
      <div class="card-sub">${forecastNote || 'Сплошная линия — факт по снимкам, пунктир — прогноз на 6 месяцев вперёд'}</div>
      <canvas id="chartForecast" height="100"></canvas>
    </div>
    <div class="section-divider"><span class="label">Цели</span><div class="line"></div></div>
    <div class="grid grid-2" id="goalsGrid">
      ${state.goals.length === 0 ? `<div class="card"><div class="empty">${icon('target')}<div class="empty-title">Целей пока нет</div></div></div>` :
      state.goals.map(g => {
        const pct = g.targetBYN > 0 ? Math.min(100, currentTotal / g.targetBYN * 100) : 0;
        const monthly = avgSavings3 !== 0 ? avgSavings3 : avgSavings6;
        const remaining = g.targetBYN - currentTotal;
        let etaText;
        if (remaining <= 0) etaText = 'Цель достигнута';
        else if (monthly > 0) { const months = remaining / monthly; etaText = `≈ ${fmt(months,1)} мес.`; }
        else etaText = 'Недостаточно данных';
        return `<div class="card">
          <div class="card-head"><div><div class="card-title">${escapeHtml(g.name)}</div><div class="card-sub">Цель: ${fmt(g.targetBYN,2)} BYN ${g.deadline ? '· до '+fmtDate(g.deadline) : ''}</div></div>
            <div class="row-actions"><button class="icon-btn" data-editgoal="${g.id}">${icon('edit')}</button><button class="icon-btn" data-delgoal="${g.id}">${icon('trash')}</button></div></div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          <div class="hint" style="margin-top:8px">${fmt(pct,1)}% · ${etaText}</div>
          ${g.note ? `<div class="hint" style="margin-top:4px">${escapeHtml(g.note)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
  document.getElementById('actAddGoal').addEventListener('click', () => openGoalModal());
  root.querySelectorAll('[data-editgoal]').forEach(b => b.addEventListener('click', () => openGoalModal(b.dataset.editgoal)));
  root.querySelectorAll('[data-delgoal]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Удалить цель?')) return;
    state.goals = state.goals.filter(g => g.id !== b.dataset.delgoal);
    logAction('delete_goal', 'Удалена цель'); save(); renderAll();
  }));

  charts.forecast && charts.forecast.destroy();
  const splitIdx = lastRealIdx;
  const solidData = projValues.map((v,i) => i <= splitIdx ? v : null);
  const dashedData = projValues.map((v,i) => i >= splitIdx ? v : null);
  if (Chart && document.getElementById('chartForecast')) {
    charts.forecast = new Chart(document.getElementById('chartForecast'), {
      type: 'line',
      data: { labels: projLabels, datasets: [
        { label: 'Факт', data: solidData, borderColor: '#D4A24C', backgroundColor: 'rgba(212,162,76,.12)', fill: true, tension: .25, pointRadius: 3 },
        { label: 'Прогноз', data: dashedData, borderColor: '#8891A8', borderDash: [6,4], fill: false, tension: .25, pointRadius: 2 }
      ]},
      options: { scales: { x: { ticks: { color: '#8891A8', maxRotation:0, autoSkip:true }, grid: { display: false } }, y: { ticks: { color: '#8891A8' }, grid: { color: '#1D2540' } } }, plugins: { legend: { labels: { color: '#8891A8' } } } }
    });
  }
};

function openGoalModal(editId) {
  const editing = editId ? state.goals.find(g => g.id === editId) : null;
  openModal(`
    <div class="modal-head"><div class="modal-title">${editing ? 'Изменить цель' : 'Новая цель'}</div><button class="icon-btn" id="mClose">${icon('x')}</button></div>
    <div class="field"><label>Название</label><input id="gName" value="${editing ? escapeHtml(editing.name) : ''}"></div>
    <div class="field-row"><div class="field"><label>Сумма цели, BYN</label><input type="number" step="0.01" class="mono" id="gTarget" value="${editing ? editing.targetBYN : ''}"></div>
      <div class="field"><label>Срок</label><input type="date" id="gDeadline" value="${editing && editing.deadline ? editing.deadline : ''}"></div></div>
    <div class="field"><label>Заметка</label><textarea id="gNote" rows="2">${editing ? escapeHtml(editing.note||'') : ''}</textarea></div>
    <div class="modal-foot">${editing ? `<button class="btn btn-danger" id="gDelete">Удалить</button>` : ''}<button class="btn btn-ghost" id="mCancel">Отмена</button><button class="btn btn-accent" id="gSave">${editing ? 'Сохранить' : 'Добавить'}</button></div>
  `);
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  if (editing) document.getElementById('gDelete').addEventListener('click', () => { closeModal(); state.goals = state.goals.filter(g => g.id !== editing.id); save(); renderAll(); });
  document.getElementById('gSave').addEventListener('click', () => {
    const name = document.getElementById('gName').value.trim();
    const targetBYN = parseFloat(document.getElementById('gTarget').value);
    const deadline = document.getElementById('gDeadline').value;
    const note = document.getElementById('gNote').value.trim();
    if (!name || !targetBYN || targetBYN <= 0) { toast('Заполните название и сумму', 'danger'); return; }
    if (editing) { Object.assign(editing, { name, targetBYN, deadline, note }); logAction('edit_goal', `Изменена цель: ${name}`); }
    else { state.goals.push({ id: uid(), name, targetBYN, deadline, note }); logAction('add_goal', `Добавлена цель: ${name}`); }
    save(); closeModal(); renderAll();
    toast('Цель сохранена');
  });
}

// ======= SETTINGS =======
RENDERERS.settings = function(root) {
  setActions('');
  root.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Курсы валют к BYN</div>
        ${['USD','EUR','RUB'].map(c => `
          <div class="field-row" style="align-items:center">
            <div class="field" style="flex:none;width:60px"><label>&nbsp;</label><div class="mono" style="padding-top:9px;font-weight:600">${c}</div></div>
            <div class="field"><label>1 ${c} =</label><input type="number" step="0.0001" class="mono" id="rate_${c}" value="${state.rates[c]}"></div>
          </div>`).join('')}
        <div class="field" style="margin-top:6px;">
          <label>Ожидаемая доходность капитала, % годовых (для FIRE-прогноза)</label>
          <input type="number" step="0.1" class="mono" id="expectedReturnPct" value="${state.settings ? state.settings.expectedReturnPct : 5}">
          <div class="hint">Реальная (за вычетом инфляции) долгосрочная доходность. Для диверсифицированного портфеля обычно 3–7%.</div>
        </div>
        <button class="btn btn-accent btn-sm" id="saveRates">Сохранить</button>
      </div>
      <div class="card">
        <div class="card-title">Категории</div>
        <div class="field-row">
          <div class="field"><label>Доходы</label><div id="catIncomeList"></div><div style="display:flex;gap:6px;margin-top:6px"><input id="newCatIncome" placeholder="Новая категория"><button class="btn btn-sm" id="addCatIncome">${icon('plus')}</button></div></div>
          <div class="field"><label>Расходы</label><div id="catExpenseList"></div><div style="display:flex;gap:6px;margin-top:6px"><input id="newCatExpense" placeholder="Новая категория"><button class="btn btn-sm" id="addCatExpense">${icon('plus')}</button></div></div>
        </div>
      </div>
    </div>

    <div class="section-divider"><span class="label">Управление активами</span><div class="line"></div></div>
    <div class="card">
      <div class="card-title">Типы активов и тикеры</div>
      <div id="assetTypesEditor"></div>
      <div style="margin-top:12px;display:flex;gap:8px"><input id="newAssetTypeName" placeholder="Название нового типа" style="flex:1;background:var(--bg-elev);border:1px solid var(--border);border-radius:7px;padding:8px 12px;color:var(--text);"><button class="btn btn-accent" id="addAssetType">Добавить тип</button></div>
    </div>

    <div class="section-divider"><span class="label">Бэкапы и данные</span><div class="line"></div></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">Резервная копия</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-accent" id="btnExportBackup">${icon('download')}Скачать бэкап (.json)</button><button class="btn" id="btnImportBackup">${icon('upload')}Восстановить из файла</button></div>
      </div>
      <div class="card">
        <div class="card-title">Опасная зона</div>
        <button class="btn btn-danger" id="btnReset">${icon('trash')}Очистить все данные</button>
      </div>
    </div>

    <div class="section-divider"><span class="label">Журнал действий</span><div class="line"></div></div>
    <div class="card">
      ${state.log.length === 0 ? `<div class="empty">${icon('clock')}<div class="empty-title">Журнал пуст</div></div>` :
      `<div class="table-wrap" style="max-height:360px;overflow-y:auto"><table>
        <thead><tr><th>Время</th><th>Действие</th></tr></thead>
        <tbody>${state.log.slice(0,200).map(l => `<tr><td class="mono" style="color:var(--text-faint)">${fmtDateTime(l.ts)}</td><td>${escapeHtml(l.summary)}</td></tr>`).join('')}</tbody>
      </table></div>`}
    </div>
  `;
  renderCatList('catIncomeList','income');
  renderCatList('catExpenseList','expense');
  document.getElementById('addCatIncome').addEventListener('click', ()=>addCategory('income'));
  document.getElementById('addCatExpense').addEventListener('click', ()=>addCategory('expense'));
  document.getElementById('saveRates').addEventListener('click', () => {
    ['USD','EUR','RUB'].forEach(c => { const v = parseFloat(document.getElementById('rate_'+c).value); if (!isNaN(v) && v > 0) state.rates[c] = v; });
    const er = parseFloat(document.getElementById('expectedReturnPct').value);
    if (!state.settings) state.settings = { expectedReturnPct: 5 };
    if (!isNaN(er) && er >= 0 && er <= 100) state.settings.expectedReturnPct = er;
    logAction('edit_rates', 'Обновлены курсы и параметры'); save(); toast('Настройки сохранены');
  });
  document.getElementById('btnExportBackup').addEventListener('click', exportBackup);
  document.getElementById('btnImportBackup').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('btnReset').addEventListener('click', resetAllData);
  renderAssetTypesEditor();
  document.getElementById('addAssetType').addEventListener('click', addNewAssetType);
};

function renderAssetTypesEditor() {
  const container = document.getElementById('assetTypesEditor');
  let html = '';
  Object.keys(state.assetTypes).forEach(key => {
    const type = state.assetTypes[key];
    html += `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${escapeHtml(type.label)}</strong>
          <div><button class="btn btn-sm btn-danger" data-deltype="${key}">Удалить тип</button></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
          ${type.tickers.map((t, ti) => `<span class="tag" style="display:inline-flex;gap:4px;">${escapeHtml(t)}<button class="icon-btn" data-delticker-key="${key}" data-delticker-idx="${ti}" style="padding:1px;">${icon('x')}</button></span>`).join('')}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input id="newTicker_${key}" placeholder="Новый тикер" style="flex:1;background:var(--bg-elev);border:1px solid var(--border);border-radius:7px;padding:6px 10px;color:var(--text);font-size:13px;">
          <button class="btn btn-sm btn-accent" data-addticker="${key}">Добавить</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  container.querySelectorAll('[data-deltype]').forEach(b => b.addEventListener('click', function() {
    const key = this.dataset.deltype;
    if (!confirm(`Удалить тип «${state.assetTypes[key].label}»?`)) return;
    if (state.assets.some(a => a.class === key) && !confirm('Есть активы этого типа. Всё равно удалить?')) return;
    delete state.assetTypes[key];
    logAction('delete_asset_type', `Удалён тип: ${key}`);
    save(); renderAll();
  }));
  container.querySelectorAll('[data-delticker-key]').forEach(b => b.addEventListener('click', function() {
    const key = this.dataset.deltickerKey;
    const idx = parseInt(this.dataset.deltickerIdx, 10);
    const ticker = state.assetTypes[key] && state.assetTypes[key].tickers[idx];
    if (ticker === undefined) return;
    if (!confirm(`Удалить тикер «${ticker}»?`)) return;
    state.assetTypes[key].tickers.splice(idx, 1);
    logAction('delete_ticker', `Удалён тикер: ${ticker}`);
    save(); renderAll();
  }));
  container.querySelectorAll('[data-addticker]').forEach(b => b.addEventListener('click', function() {
    const key = this.dataset.addticker;
    const input = document.getElementById('newTicker_'+key);
    const val = input.value.trim();
    if (!val) { toast('Введите тикер', 'danger'); return; }
    if (state.assetTypes[key].tickers.includes(val)) { toast('Такой тикер уже есть', 'danger'); return; }
    state.assetTypes[key].tickers.push(val);
    logAction('add_ticker', `Добавлен тикер: ${val}`);
    save(); renderAll();
  }));
}

function addNewAssetType() {
  const input = document.getElementById('newAssetTypeName');
  const label = input.value.trim();
  if (!label) { toast('Введите название', 'danger'); return; }
  const key = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (state.assetTypes[key]) { toast('Тип с таким ключом уже существует', 'danger'); return; }
  state.assetTypes[key] = { label, tickers: [] };
  logAction('add_asset_type', `Добавлен тип: ${label}`);
  input.value = '';
  save(); renderAll();
  toast('Тип добавлен');
}

function renderCatList(elId, kind) {
  const el = document.getElementById(elId);
  el.innerHTML = state.categories[kind].map(c => `
    <div class="tag" style="margin:0 5px 5px 0;display:inline-flex">${escapeHtml(c)} <button class="icon-btn" style="padding:1px" data-rmcat="${kind}|${escapeHtml(c)}">${icon('x')}</button></div>
  `).join('');
  el.querySelectorAll('[data-rmcat]').forEach(b => b.addEventListener('click', () => {
    const [k, cat] = b.dataset.rmcat.split('|');
    state.categories[k] = state.categories[k].filter(x => x !== cat);
    save(); renderAll();
  }));
}

function addCategory(kind) {
  const input = document.getElementById(kind === 'income' ? 'newCatIncome' : 'newCatExpense');
  const v = input.value.trim();
  if (!v) return;
  if (state.categories[kind].includes(v)) { toast('Такая категория уже есть', 'danger'); return; }
  state.categories[kind].push(v);
  logAction('add_category', `Добавлена категория (${kind}): ${v}`);
  save(); renderAll();
}

function exportBackup() {
  const payload = JSON.stringify(state, null, 2);
  downloadFile('ledger_backup_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json', payload, 'application/json');
  logAction('backup_export', 'Создан бэкап');
  save();
  toast('Бэкап скачан');
}

document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      // ==== Файл-добавление: { "merge": true, "transactions": [...] } ====
      // Дописывает транзакции к текущим данным, ничего не заменяя.
      if (data.merge === true && Array.isArray(data.transactions)) {
        const mark = data.importTag || ('import_' + todayISO());
        const already = state.transactions.some(t => t.importTag === mark);
        if (already && !confirm('Похоже, этот файл уже импортировался. Добавить записи ещё раз (появятся дубли)?')) return;
        if (!confirm(`Будет добавлено записей: ${data.transactions.length}. Текущие данные сохранятся. Продолжить?`)) return;
        const now = new Date().toISOString();
        let added = 0;
        data.transactions.forEach(r => {
          if (!r || !r.date || typeof r.amount !== 'number') return;
          const tx = Object.assign({}, r);
          tx.id = uid();
          if (!tx.createdAt) tx.createdAt = now;
          tx.importTag = mark;
          state.transactions.push(tx);
          added++;
        });
        logAction('merge_import', `Добавлено записей из файла ${file.name}: ${added}`);
        save(); renderAll();
        toast('Добавлено записей: ' + added);
        return;
      }

      // ==== Обычный бэкап: полная замена ====
      if (!data.transactions || !data.assets) throw new Error('bad format');
      if (!confirm('Текущие данные будут заменены содержимым файла. Продолжить?')) return;
      setState(migrateState(data));
      logAction('backup_import', `Восстановлено из файла: ${file.name}`);
      save(); renderAll();
      toast('Данные восстановлены');
    } catch(err) { toast('Файл повреждён', 'danger'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function resetAllData() {
  if (!confirm('Удалить ВСЕ данные?')) return;
  if (!confirm('Это действие нельзя отменить. Точно?')) return;
  setState(defaultState());
  save(); renderAll();
  toast('Все данные очищены', 'danger');
}

function takeSnapshot() {
  const { byClass } = computePortfolioTotals();
  const totalCapital = computeTotalCapital(true); // снимок всегда по факту, с процентами
  if (state.assets.length === 0 && state.deposits.length === 0) {
    toast('Нет активов или депозитов', 'danger');
    return;
  }
  state.snapshots.push({ id: uid(), date: todayISO(), totalBYN: totalCapital, byClass: { ...byClass } });
  logAction('snapshot', `Снимок портфеля: ${fmt(totalCapital,2)} BYN`);
  save(); renderAll();
  toast('Снимок сохранён');
}

// Мост для inline-onclick в HTML модалки.
// TODO(этап 2): заменить на addEventListener и удалить
window.closeModal = closeModal;

// ======= INIT =======
load();
initModals();
renderAll();