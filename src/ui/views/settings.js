
import { state, save, logAction } from '../../state.js';
import { icon } from '../../icons.js';
import { fmtDateTime } from '../../utils.js';
import { escapeHtml, toast } from '../dom.js';

let _renderAll = () => {};   // колбэк, заполняется при рендере
export function renderSettings(root, deps) {
  const { setActions, renderAll, exportBackup, resetAllData } = deps;
  _renderAll = renderAll;
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
}
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
    save(); _renderAll();
  }));
  container.querySelectorAll('[data-delticker-key]').forEach(b => b.addEventListener('click', function() {
    const key = this.dataset.deltickerKey;
    const idx = parseInt(this.dataset.deltickerIdx, 10);
    const ticker = state.assetTypes[key] && state.assetTypes[key].tickers[idx];
    if (ticker === undefined) return;
    if (!confirm(`Удалить тикер «${ticker}»?`)) return;
    state.assetTypes[key].tickers.splice(idx, 1);
    logAction('delete_ticker', `Удалён тикер: ${ticker}`);
    save(); _renderAll();
  }));
  container.querySelectorAll('[data-addticker]').forEach(b => b.addEventListener('click', function() {
    const key = this.dataset.addticker;
    const input = document.getElementById('newTicker_'+key);
    const val = input.value.trim();
    if (!val) { toast('Введите тикер', 'danger'); return; }
    if (state.assetTypes[key].tickers.includes(val)) { toast('Такой тикер уже есть', 'danger'); return; }
    state.assetTypes[key].tickers.push(val);
    logAction('add_ticker', `Добавлен тикер: ${val}`);
    save(); _renderAll();
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
  save(); _renderAll();
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
    save(); _renderAll();
  }));
}

function addCategory(kind) {
  const input = document.getElementById(kind === 'income' ? 'newCatIncome' : 'newCatExpense');
  const v = input.value.trim();
  if (!v) return;
  if (state.categories[kind].includes(v)) { toast('Такая категория уже есть', 'danger'); return; }
  state.categories[kind].push(v);
  logAction('add_category', `Добавлена категория (${kind}): ${v}`);
  save(); _renderAll();
}