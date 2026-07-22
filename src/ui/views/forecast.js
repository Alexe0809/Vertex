// ======= VIEW: FORECAST — проекция капитала и цели =======
import { state, save, logAction } from '../../state.js';
import { icon } from '../../icons.js';
import { fmt, fmtDate, uid } from '../../utils.js';
import { escapeHtml, openModal, closeModal } from '../dom.js';
import { computeTotalCapital } from '../../core/portfolio.js';

export function renderForecast(root, deps) {
  const { setActions, renderAll, toast, computeAvgMonthlySavings, linearForecast, Chart, charts } = deps;
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
  document.getElementById('actAddGoal').addEventListener('click', () => openGoalModal(undefined, deps));
  root.querySelectorAll('[data-editgoal]').forEach(b => b.addEventListener('click', () => openGoalModal(b.dataset.editgoal, deps)));
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
        { label: 'Факт', data: solidData, borderColor: '#C9A96A', backgroundColor: 'rgba(201,169,106,.14)', fill: true, tension: .25, pointRadius: 3 },
        { label: 'Прогноз', data: dashedData, borderColor: '#A29D8F', borderDash: [6,4], fill: false, tension: .25, pointRadius: 2 }
      ]},
      options: { scales: { x: { ticks: { color: '#6E6858', maxRotation:0, autoSkip:true }, grid: { display: false } }, y: { ticks: { color: '#6E6858' }, grid: { color: 'rgba(28,25,18,0.07)' } } }, plugins: { legend: { labels: { color: '#6E6858' } } } }
    });
  }
}

export function openGoalModal(editId, deps) {
  const { renderAll, toast } = deps;
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