// src/ui/views/dashboard.js
import { computePortfolioTotals, computeTotalCapital } from '../../core/portfolio.js';
import { computeDepositsTotal } from '../../core/deposits.js';
import { state } from '../../state.js';
import { getColorForClass, ASSET_CLASS_COLORS } from '../../config.js';
import { fmt, fmtUSD, fmtPct, fmtDate } from '../../utils.js';
import { icon } from '../../icons.js';
import { escapeHtml } from '../dom.js';



export function renderDashboard(root, deps) {
  const { setActions, computeMonthFlow, computeAvgMonthlyExpense,
          computeAvgMonthlySavings, getClassLabel, Chart, charts, goTo } = deps;
            setActions('');
            const { byClass, total: portfolioTotal } = computePortfolioTotals();
            const depositsTotal = computeDepositsTotal();
            const totalCapital = computeTotalCapital();
            const usdRate = state.rates.USD || 1;
            const totalUSD = totalCapital / usdRate;
          
            const thisMonthKey = new Date().toISOString().slice(0,7);
            const flow = computeMonthFlow(thisMonthKey);
            const income = flow.income, expense = flow.expense, net = flow.net;
            const savingsRate = income > 0 ? (net / income * 100) : 0;
          
            const avgExpense3 = computeAvgMonthlyExpense(3);
            const cushion = avgExpense3 > 0 ? (totalCapital / avgExpense3) : null;
          
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
          
            const classKeys = ['cash', ...Object.keys(state.assetTypes)];
            const composition = classKeys.map(cls => {
              const v = byClass[cls] || 0;
              return { label: getClassLabel(cls), value: v, color: getColorForClass(cls) };
            }).filter(c => c.value > 0);
            if (depositsTotal > 0) {
              composition.push({ label: 'Депозиты', value: depositsTotal, color: ASSET_CLASS_COLORS.deposit });
            }
            const total = composition.reduce((s,c) => s + c.value, 0);
            let riskLevel = 'Низкий', riskColor = 'var(--positive)';
            if (total > 0) {
              const cryptoShare = (byClass['crypto'] || 0) / total * 100;
              const stocksShare = (byClass['stocks'] || 0) / total * 100;
              if (cryptoShare > 50) { riskLevel = 'Высокий'; riskColor = 'var(--negative)'; }
              else if (cryptoShare > 30 || stocksShare > 40) { riskLevel = 'Умеренный'; riskColor = '#C98F4C'; }
              else { riskLevel = 'Низкий'; riskColor = 'var(--positive)'; }
            }
          
            const topProfitAssets = state.assets
              .filter(a => a.class !== 'cash' && a.invested > 0)
              .sort((a,b) => (b.profitUSD || 0) - (a.profitUSD || 0))
              .slice(0,5);
          
            const fireGoal = state.goals.length > 0 ? state.goals[0].targetBYN : 500000;
            const fireGoalName = state.goals.length > 0 ? state.goals[0].name : 'FIRE';
            const fireProgress = fireGoal > 0 ? (totalCapital / fireGoal * 100) : 0;
            const fireMonthlySavings = computeAvgMonthlySavings(3) || computeAvgMonthlySavings(6);
            const fireRemaining = Math.max(0, fireGoal - totalCapital);
            // Срок с учётом сложного процента: FV = C·(1+r)^t + S_год·((1+r)^t − 1)/r = Цель
            const fireR = (state.settings && typeof state.settings.expectedReturnPct === 'number' ? state.settings.expectedReturnPct : 5) / 100;
            const fireSAnnual = fireMonthlySavings * 12;
            let fireYears = null;
            if (fireRemaining <= 0) fireYears = 0;
            else if (fireR > 0) {
              const denom = totalCapital * fireR + fireSAnnual;
              if (denom > 0) {
                const ratio = (fireGoal * fireR + fireSAnnual) / denom;
                if (ratio > 1) fireYears = Math.log(ratio) / Math.log(1 + fireR);
              }
            } else if (fireSAnnual > 0) {
              fireYears = fireRemaining / fireSAnnual;
            }
            // Правило 4%: капитал для жизни с изъятием 4% в год = 25 годовых расходов
            const fireRecommended = avgExpense3 > 0 ? avgExpense3 * 12 * 25 : null;
          
            const snapshots = state.snapshots.slice().sort((a,b) => a.date.localeCompare(b.date));
            const capLabels = snapshots.map(s => fmtDate(s.date));
            const capData = snapshots.map(s => s.totalBYN);
          
            root.innerHTML = `
              <div class="grid grid-hero">
                <div class="card hero-card">
                  <div class="hero-eyebrow">Текущий капитал</div>
                  <div class="hero-figure">${fmt(totalCapital,2)} <span>BYN</span></div>
                  <div class="hero-figure" style="font-size:28px; margin-top:4px;">${fmtUSD(totalCapital/usdRate)}</div>
                  <div class="hero-row">
                    <div><div class="hero-mini-label">Доход за месяц</div><div class="hero-mini-value" style="color:var(--positive)">+${fmt(income,2)}</div></div>
                    <div><div class="hero-mini-label">Расход за месяц</div><div class="hero-mini-value" style="color:var(--negative)">−${fmt(expense,2)}</div></div>
                    <div><div class="hero-mini-label">Баланс месяца</div><div class="hero-mini-value" style="color:${net>=0?'var(--positive)':'var(--negative)'}">${net>=0?'+':''}${fmt(net,2)}</div></div>
                    <div><div class="hero-mini-label">Инвестировано за месяц</div><div class="hero-mini-value" style="color:var(--info)">${fmt(flow.invested,2)}</div></div>
                  </div>
                </div>
                <div class="card">
                  <div class="card-title">Ключевые метрики</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
                    <div><div class="hint">Норма сбережений</div><div style="font-weight:600;">${fmt(savingsRate,1)}%</div></div>
                    <div><div class="hint">Подушка</div><div style="font-weight:600;">${cushion!==null ? fmt(cushion,1)+' мес.' : '—'}</div></div>
                    <div><div class="hint">ROI портфеля</div><div style="font-weight:600;color:${totalROI>=0?'var(--positive)':'var(--negative)'};">${fmtPct(totalROI)}</div></div>
                    <div><div class="hint">Прибыль</div><div style="font-weight:600;color:${totalProfit>=0?'var(--positive)':'var(--negative)'};">${fmt(totalProfit,2)}</div></div>
                    <div><div class="hint">Риск</div><div style="font-weight:600;color:${riskColor};">${riskLevel}</div></div>
                    <div><div class="hint">FIRE прогресс</div><div style="font-weight:600;">${fmt(fireProgress,1)}% (${escapeHtml(fireGoalName)})</div></div>
                  </div>
                </div>
              </div>
          
              <div class="grid grid-2">
                <div class="card">
                  <div class="card-title">Рост капитала</div>
                  ${capData.length > 0 ? `<canvas id="chartCapitalGrowth" height="150"></canvas>` : `<div class="empty">${icon('inbox')}<div class="empty-title">Нет снимков</div><div class="empty-sub">Сделайте снимок портфеля на вкладке «Портфель»</div></div>`}
                </div>
                <div class="card">
                  <div class="card-title">Распределение активов</div>
                  ${composition.length > 0 ? `<canvas id="chartComposition" height="150"></canvas>` : `<div class="empty">${icon('inbox')}<div class="empty-title">Нет данных</div><div class="empty-sub">Добавьте активы для отображения структуры портфеля</div></div>`}
                </div>
              </div>
          
              <div class="section-divider"><span class="label">Топ 5 активов по прибыли</span><div class="line"></div></div>
              <div class="card">
                ${topProfitAssets.length === 0 ? `<div class="empty">${icon('layers')}<div class="empty-title">Нет данных</div><div class="empty-sub">Инвестиционные активы отсутствуют</div></div>` :
                topProfitAssets.map(a => `
                  <div class="list-row">
                    <div>
                      <div style="font-weight:500;">${escapeHtml(a.name)}</div>
                      <div class="hint">${getClassLabel(a.class)} · ROI ${fmtPct(a.roi||0)}</div>
                    </div>
                    <div style="text-align:right;">
                      <div style="color:${(a.profitUSD||0)>=0?'var(--positive)':'var(--negative)'};">${(a.profitUSD||0)>=0?'+':''}${fmt(a.profitUSD,2)} USD</div>
                      <div class="hint">вложено ${fmt(a.investedUSD,2)} USD</div>
                    </div>
                  </div>
                `).join('')}
              </div>
          
              <div class="section-divider"><span class="label">FIRE калькулятор</span><div class="line"></div></div>
              <div class="card">
                <div class="card-head"><div><div class="card-title">Путь к финансовой независимости</div><div class="card-sub">Цель: ${fmt(fireGoal,0)} BYN (${escapeHtml(fireGoalName)})</div></div><div style="font-size:24px;font-weight:600;">${fmt(fireProgress,1)}%</div></div>
                <div class="progress"><div class="progress-bar" style="width:${Math.min(fireProgress,100)}%;"></div></div>
                <div style="margin-top:12px;display:flex;gap:24px;flex-wrap:wrap;">
                  <div><span class="hint">Текущий капитал</span> ${fmt(totalCapital,2)} BYN</div>
                  <div><span class="hint">Осталось</span> ${fmt(Math.max(0, fireGoal - totalCapital),2)} BYN</div>
                  <div><span class="hint">Срок (при доходности ${fmt(fireR*100,1)}% годовых)</span> ${fireYears!==null ? fmt(fireYears,1)+' лет' : 'недостижимо при текущем темпе'}</div>
                </div>
                ${fireRecommended !== null ? `<div class="hint" style="margin-top:8px;">Правило 4%: при ваших средних расходах (${fmt(avgExpense3,0)} BYN/мес) капитал для жизни с пассивного дохода ≈ <b>${fmt(fireRecommended,0)} BYN</b> (25 годовых расходов). Ожидаемую доходность можно изменить в Настройках.</div>` : ''}
              </div>
          
              <div class="section-divider"><span class="label">Последние транзакции</span><div class="line"></div></div>
              <div class="card">
                <div class="card-head"><div><div class="card-title">Недавние операции</div></div><button class="btn btn-ghost btn-sm" data-go="transactions">Все →</button></div>
                ${state.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)).slice(0,6).map(t => `
                  <div class="list-row">
                    <div><div style="font-weight:500">${escapeHtml(t.category)}${t.assetName ? ' ('+escapeHtml(t.assetName)+')' : ''}</div><div class="hint">${fmtDate(t.date)} · ${escapeHtml(t.description||'—')}</div></div>
                    <div class="amt ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'}${fmt(t.amount,2)} ${t.currency}</div>
                  </div>
                `).join('') || '<div class="empty">Пока нет записей</div>'}
              </div>
            `;
          
            root.querySelector('[data-go="transactions"]').addEventListener('click', () => goTo('transactions'));
          
            setTimeout(() => {
              if (!Chart) return;
              const canvasCap = document.getElementById('chartCapitalGrowth');
              if (canvasCap && capData.length > 0) {
                if (charts.capitalGrowth) charts.capitalGrowth.destroy();
                charts.capitalGrowth = new Chart(canvasCap, {
                  type: 'line',
                  data: { labels: capLabels, datasets: [{ label: 'Капитал, BYN', data: capData, borderColor: '#C9A96A', backgroundColor: 'rgba(201,169,106,0.14)', fill: true, tension: 0.2, pointRadius: 3 }] },
                  options: { responsive: true, maintainAspectRatio: true, scales: { x: { ticks: { color: '#6E6858' }, grid: { display: false } }, y: { ticks: { color: '#6E6858' }, grid: { color: 'rgba(28,25,18,0.07)' } } }, plugins: { legend: { display: false } } }
                });
              }
          
              const canvasComp = document.getElementById('chartComposition');
              if (canvasComp && composition.length > 0) {
                if (charts.composition) charts.composition.destroy();
                charts.composition = new Chart(canvasComp, {
                  type: 'doughnut',
                  data: {
                    labels: composition.map(c => c.label),
                    datasets: [{
                      data: composition.map(c => c.value),
                      backgroundColor: composition.map(c => c.color),
                      borderColor: '#FFFFFF',
                      borderWidth: 2
                    }]
                  },
                  options: { plugins: { legend: { position: 'bottom', labels: { color: '#6E6858', font: { size: 10 }, boxWidth: 10, padding: 8 } } }, cutout: '60%' }
                });
              }
            }, 50);
          }