import { state, save } from '../../state.js';
import { icon } from '../../icons.js';
import { fmt, monthKey, txAmountBYN } from '../../utils.js';
import { escapeHtml } from '../dom.js';

export function renderReports(root, deps) {
  const { setActions, renderAll, lastNMonthKeys, computeMonthFlow,
          Chart, charts, exportBriefReport, exportFullReport,
          exportHtmlReport, showAIReport } = deps;
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
}