// Автозагрузка рыночных цен активов.
// Крипта и металлы — currency-api (без ключа, CORS разрешён).
// Акции — Finnhub (нужен бесплатный ключ: finnhub.io/register).
//   Yahoo/публичные прокси не годятся: браузер блокирует их по CORS.
import { state, save } from '../state.js';

const TIMEOUT_MS = 8000;
const OZ_TO_GRAM = 31.1035;

// Металлы в currency-api даны за тройскую унцию (31.1 г).
// true  -> цена пишется ЗА ГРАММ (слитки банков РБ)
// false -> цена пишется ЗА УНЦИЮ
const METALS_IN_GRAMS = true;

const METAL_MAP = { 'Золото':'xau', 'Серебро':'xag', 'Платина':'xpt', 'Палладий':'xpd' };

// Активы с ручными ценами — автообновление их не трогает.
const SKIP_NAMES = ['NVDAx (Wallet)', 'SPYx (Wallet)'];

const CURRENCY_API = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/byn.json',
  'https://latest.currency-api.pages.dev/v1/currencies/byn.json',
];

async function fetchJSON(url, ms = TIMEOUT_MS) {
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

async function loadBynTable() {
  for (const url of CURRENCY_API) {
    try { return (await fetchJSON(url)).byn || null; }
    catch (e) { console.warn(`currency-api недоступен: ${e.message}`); }
  }
  return null;
}

// В таблице лежит "сколько X за 1 BYN". Цена X в долларах = byn.usd / byn.X
function priceInUSD(bynTable, ticker) {
  const per = bynTable[ticker];
  if (!per || !bynTable.usd) return null;
  return bynTable.usd / per;
}

// "NVDAx (Wallet)" -> ["NVDAX", "NVDA"]; "BTC" -> ["BTC"]
export function tickerCandidates(name) {
  const manual = (state.tickerMap || {})[name];
  if (manual) return [manual.toUpperCase()];
  let t = (name || '').replace(/\s*\(.*?\)\s*/g, '').trim().toUpperCase();
  const out = [t];
  if (t.length > 3 && t.endsWith('X')) out.push(t.slice(0, -1)); // токенизированные: NVDAx -> NVDA
  return out.filter(Boolean);
}

async function fetchStockUSD(name) {
  const key = state.finnhubKey;
  if (!key) return null;
  for (const symbol of tickerCandidates(name)) {
    try {
      const data = await fetchJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
      if (data && data.c > 0) return data.c;   // c = current price
    } catch (e) {
      console.warn(`Finnhub ${symbol}: ${e.message}`);
    }
  }
  return null;
}

export async function autoUpdatePrices(onDone) {
  const assets = (state.assets || []).filter(a =>
    a.class !== 'cash' && a.class !== 'lent' && !SKIP_NAMES.includes((a.name || '').trim())
  );
  if (!assets.length) return;

  const bynTable = await loadBynTable();
  const now = new Date().toISOString();
  let updated = 0;
  const failed = [];
  let needKey = false;

  for (const a of assets) {
    let priceUSD = null;
    const name = (a.name || '').trim();

    if (a.class === 'crypto' && bynTable) {
      for (const t of tickerCandidates(name)) {
        priceUSD = priceInUSD(bynTable, t.toLowerCase());
        if (priceUSD) break;
      }
    } else if (a.class === 'metals' && bynTable) {
      const code = METAL_MAP[name];
      const perOunce = code ? priceInUSD(bynTable, code) : null;
      if (perOunce) priceUSD = METALS_IN_GRAMS ? perOunce / OZ_TO_GRAM : perOunce;
    } else if (a.class === 'stocks') {
      if (!state.finnhubKey) { needKey = true; continue; }
      priceUSD = await fetchStockUSD(name);
    }

    if (priceUSD && isFinite(priceUSD) && priceUSD > 0) {
      state.marketPrices[a.id] = { priceUSD: Math.round(priceUSD * 10000) / 10000, lastUpdated: now };
      updated++;
    } else {
      failed.push(name);
    }
  }

  if (needKey) {
    console.info('Акции пропущены: не задан ключ Finnhub. Получи бесплатный на finnhub.io/register и выполни в консоли: state.finnhubKey="ТВОЙ_КЛЮЧ"; save();');
  }

  if (updated) {
    state.pricesUpdatedAt = now;
    save();
    if (onDone) onDone({ updated, failed, needKey });
  } else if (failed.length) {
    console.warn('Цены обновить не удалось:', failed.join(', '));
  }
}