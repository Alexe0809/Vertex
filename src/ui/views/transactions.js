// ======= VIEW: TRANSACTIONS (без экспорта CSV) =======
import { state, save, logAction } from '../../state.js';
import { icon } from '../../icons.js';
import { fmt, fmtDate, txAmountBYN, uid } from '../../utils.js';
import { escapeHtml, openModal, closeModal, toast } from '../dom.js';
import { rateFor } from '../../core/rates.js';
import { computeAssetQuantity } from '../../core/portfolio.js';

export function renderTransactions(root, deps) {
  const { setActions, renderAll, getClassLabel, todayISO, syncTransferLeg, downloadFile } = deps;
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
  document.getElementById('actAddTx').addEventListener('click', () => openTxModal(undefined, deps));
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

  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTxModal(b.dataset.edit, deps)));
  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteTx(b.dataset.del, deps)));
}

// ======= МОДАЛЬНОЕ ОКНО ТРАНЗАКЦИИ =======
export function openTxModal(editId, deps) {
  const { getClassLabel, todayISO, renderAll, syncTransferLeg } = deps;
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
  if (editing) document.getElementById('txDelete').addEventListener('click', () => { closeModal(); deleteTx(editing.id, deps); });

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
export function deleteTx(id, deps) {
  const { renderAll } = deps;
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
