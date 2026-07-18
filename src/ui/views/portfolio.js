import { state, save, logAction } from '../../state.js';
import { icon } from '../../icons.js';
import { fmt, fmtPct, fmtDate } from '../../utils.js';
import { escapeHtml, openModal, closeModal, toast } from '../dom.js';
import { getColorForClass, ASSET_CLASS_COLORS } from '../../config.js';
import { refreshAssets, computePortfolioTotals, computeTotalCapital, assetValueBYN } from '../../core/portfolio.js';
import { computeDepositsTotal, computeDepositsTotalProfit, computeDepositAccruedValue, depositElapsedMonths, isDepositMatured, computeDepositFinalAmount, computeDepositProfit } from '../../core/deposits.js';

export function renderPortfolio(root, deps) {
  const { setActions, renderAll, getClassLabel, takeSnapshot, closeDeposit } = deps;
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
    root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditAssetModal(b.dataset.edit, deps)));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteAsset(b.dataset.del, deps)));
    root.querySelectorAll('[data-history]').forEach(b => b.addEventListener('click', () => openAssetHistory(b.dataset.history)));
    root.querySelectorAll('[data-delsnap]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Удалить этот снимок?')) return;
      state.snapshots = state.snapshots.filter(s => s.id !== b.dataset.delsnap);
      save(); renderAll();
    }));
}
export function openEditAssetModal(assetId, deps) {
  const { renderAll, getClassLabel} = deps;   // + что реально нужно — проверь тело
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

export function deleteAsset(assetId, deps) {
  const { renderAll } = deps;
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

export function openAssetHistory(assetId) {
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

