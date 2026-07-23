// Автозагрузка курсов валют. Цепочка источников с таймаутом:
// 1) НБРБ (официальный, но не всегда доступен из-за рубежа)
// 2) currency-api через jsDelivr CDN (тот же CDN, откуда грузится Chart.js)
// 3) зеркало currency-api на pages.dev
import { state, save } from '../state.js';

const WANTED = ['USD', 'EUR', 'RUB'];

// Локальный бэкенд пробуем только когда сайт открыт локально.
// В интернете (Netlify) его нет — не тратим секунду на заведомый таймаут.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const TIMEOUT_MS = 4000;

// Порядок важен: первым идёт самый быстрый рабочий источник.
// НБРБ оставлен последним — он официальный, но недоступен из-за рубежа (таймаут).
const SOURCES = [
  ...(IS_LOCAL ? [{ name: 'Vertex API', url: 'http://127.0.0.1:8000/api/rates', parse: parseVertexAPI }] : []),
  { name: 'currency-api', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/byn.json', parse: parseCurrencyApi },
  { name: 'currency-api (зеркало)', url: 'https://latest.currency-api.pages.dev/v1/currencies/byn.json', parse: parseCurrencyApi },
  { name: 'НБРБ', url: 'https://api.nbrb.by/exrates/rates?periodicity=0', parse: parseNBRB },
];

// fetch, который сам сдаётся через TIMEOUT_MS — иначе зависший сервер держит всю цепочку
async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// НБРБ отдаёт курс за Cur_Scale единиц (RUB — за 100)
function parseNBRB(list) {
  const rates = {};
  for (const item of list) {
    if (!WANTED.includes(item.Cur_Abbreviation)) continue;
    rates[item.Cur_Abbreviation] = item.Cur_OfficialRate / item.Cur_Scale;
  }
  return rates;
}

// currency-api отдаёт "сколько валюты за 1 BYN" — нам нужно наоборот
function parseVertexAPI(data) {
  // Наш бэкенд уже отдаёт готовое { rates: {USD, EUR, RUB} }
  return data.rates || {};
}

function parseCurrencyApi(data) {
  const byn = data.byn || {};
  const rates = {};
  for (const cur of WANTED) {
    const perByn = byn[cur.toLowerCase()];
    if (perByn) rates[cur] = 1 / perByn;
  }
  return rates;
}

function round4(rates) {
  const out = {};
  for (const [k, v] of Object.entries(rates)) out[k] = Math.round(v * 10000) / 10000;
  return out;
}

export async function fetchRates() {
  for (const src of SOURCES) {
    try {
      const raw = await fetchWithTimeout(src.url);
      const rates = src.parse(raw);
      if (Object.keys(rates).length) return { rates: round4(rates), source: src.name };
    } catch (e) {
      console.warn(`Источник курсов «${src.name}» недоступен: ${e.message}`);
    }
  }
  return null;
}

export async function autoUpdateRates(onDone) {
  const result = await fetchRates();
  if (!result) {
    console.warn('Все источники курсов недоступны — работаем на сохранённых');
    return;
  }
  state.rates = { ...state.rates, ...result.rates };
  state.ratesUpdatedAt = new Date().toISOString();
  state.ratesSource = result.source;
  save();
  if (onDone) onDone(result);
}