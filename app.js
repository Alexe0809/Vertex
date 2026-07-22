/* =========================================================
   Vertex — Личный бюджет (ПОЛНЫЙ ФАЙЛ, без модулей)
   Все баги исправлены. Работает через file:// и http://
   Использует глобальный Chart (из CDN)
   ========================================================= */

import { NAV, DEFAULT_ASSET_TYPES, ASSET_CLASS_COLORS, getColorForClass, STORAGE_KEY} from './src/config.js';
import { ICONS, icon } from './src/icons.js';
import { state, setState, load, save, logAction, migrateState, defaultState } from './src/state.js';
import { rateFor } from './src/core/rates.js';
import { autoUpdateRates } from './src/core/rates-api.js';
import { autoUpdatePrices } from './src/core/prices-api.js';
import { depositElapsedMonths, isDepositMatured, computeDepositAccruedValue,
         computeDepositFinalAmount, computeDepositProfit,
         computeDepositsTotal, computeDepositsTotalProfit } from './src/core/deposits.js';
import { computeAssetQuantity, computeXIRR, refreshAssets, assetValueBYN,
         computePortfolioTotals, computeTotalCapital } from './src/core/portfolio.js';
import { fmt, fmtUSD, fmtPct, fmtDate, fmtDateTime, round2, monthKey, uid, txAmountBYN } from './src/utils.js';
import { toast, openModal, closeModal, initModals, escapeHtml} from './src/ui/dom.js';
import { renderSidebar, renderMobileNav, renderTicker, initGreeting } from './src/ui/shell.js';
import { renderDashboard } from './src/ui/views/dashboard.js';
import { renderTransactions, openTxModal, deleteTx } from './src/ui/views/transactions.js';
import { renderPortfolio, openEditAssetModal, deleteAsset, openAssetHistory } from './src/ui/views/portfolio.js';
import { renderReports } from './src/ui/views/reports.js';
import { renderSettings } from './src/ui/views/settings.js';
import { renderPrices } from './src/ui/views/prices.js';
import { renderForecast } from './src/ui/views/forecast.js';
  
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
RENDERERS.prices = (root) => renderPrices(root, { setActions, renderAll, getClassLabel, toast });

// ============================================================
// VIEW: PORTFOLIO (с процентами напротив активов, XIRR с пометкой,
// для КЭША добавлены доли валют, в депозитах добавлена колонка "Накоплено сейчас")
// ============================================================

RENDERERS.portfolio = (root) => renderPortfolio(root, {
  setActions, renderAll, getClassLabel, takeSnapshot, closeDeposit
});

// ======= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ПОРТФЕЛЯ =======


RENDERERS.transactions = (root) => renderTransactions(root, {
  setActions, renderAll, getClassLabel, todayISO, syncTransferLeg, downloadFile
});

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
RENDERERS.reports = (root) => renderReports(root, {
  setActions, renderAll, lastNMonthKeys, computeMonthFlow, Chart, charts,
  exportBriefReport, exportFullReport, exportHtmlReport, showAIReport
});
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
RENDERERS.forecast = (root) => renderForecast(root, { setActions, renderAll, toast, computeAvgMonthlySavings, linearForecast, Chart, charts });

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
RENDERERS.settings = (root) => renderSettings(root, {
  setActions, renderAll, exportBackup, resetAllData
});


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
initGreeting();
renderAll();
autoUpdateRates((res) => { renderAll(); toast('Курсы обновлены: ' + res.source); });
autoUpdatePrices((r) => {
  renderAll();
  toast('Цены обновлены: ' + r.updated + (r.failed.length ? ', не найдены: ' + r.failed.join(', ') : ''));
});
