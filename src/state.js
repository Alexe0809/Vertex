// ======= STATE =======
import { STORAGE_KEY, DEFAULT_ASSET_TYPES } from './config.js';
import { uid } from './utils.js';

export let state = null;

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = migrateState(JSON.parse(raw));
      return;
    }
  } catch (e) { console.error('load failed', e); }
  state = defaultState();
}

export function setState(newState) { state = newState; }

export function defaultState() {
  return {
    transactions: [],
    assets: [],
    deposits: [],
    snapshots: [],
    goals: [],
    rates: { USD: 3.4, EUR: 3.6, RUB: 0.037 },
    categories: {
      income: ['Зарплата','Стипендия/аванс','Подарок','Возврат долга','Проценты/доход','Прочее'],
      expense: ['Еда','Транспорт','Жильё','Учёба','Развлечения','Покупки','Перевод в MoneyBox','Долг (выдан)','Прочее']
    },
    assetTypes: JSON.parse(JSON.stringify(DEFAULT_ASSET_TYPES)),
    marketPrices: {},
    log: [],
    settings: { expectedReturnPct: 5 }, // ожидаемая реальная годовая доходность для прогноза FIRE
    schemaVersion: 17,
    ui: { view: 'dashboard', txFilter: { type:'all', category:'all', q:'' }, reportMonths:6 }
  };
}

export function migrateState(s) {
  const def = defaultState();
  if (!s.assetTypes) s.assetTypes = def.assetTypes;
  if (!s.ui) s.ui = def.ui;
  if (!s.ui.txFilter) s.ui.txFilter = def.ui.txFilter;
  if (!s.marketPrices) s.marketPrices = {};
  if (!s.deposits) s.deposits = [];
  if (!s.snapshots) s.snapshots = [];
  if (!s.goals) s.goals = [];
  if (!s.log) s.log = [];
  if (!s.settings) s.settings = def.settings;
  if (typeof s.settings.expectedReturnPct !== 'number') s.settings.expectedReturnPct = 5;
  if (typeof s.settings.depositsPrincipalOnly !== 'boolean') s.settings.depositsPrincipalOnly = false;
  // Связываем депозитные транзакции с депозитами по id (раньше связи не было)
  s.transactions.forEach(t => {
    if (t.txType === 'deposit' && !t.depositId && t.depositData) {
      const dep = s.deposits.find(d =>
        d.amount === t.depositData.amount &&
        d.currency === t.depositData.currency &&
        d.startDate === t.depositData.startDate
      );
      if (dep) t.depositId = dep.id;
    }
  });
  s.schemaVersion = 17;
  return s;
}

export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.error('Не удалось сохранить в локальное хранилище', e); }
}

export function logAction(action, summary) {
  state.log.unshift({ id:uid(), ts:new Date().toISOString(), action, summary });
  if (state.log.length > 500) state.log.length = 500;
}