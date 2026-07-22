// ======= VIEW: PRICES — ручной ввод цен активов =======
import { state, save } from '../../state.js';
import { icon } from '../../icons.js';
import { fmt, fmtDateTime } from '../../utils.js';
import { escapeHtml } from '../dom.js';
import { refreshAssets } from '../../core/portfolio.js';

export function renderPrices(root, deps) {
  const { setActions, renderAll, getClassLabel, toast } = deps;
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
}