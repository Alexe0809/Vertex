// Курсы валют: пересчёт в BYN.
// TODO(этап 3): автозагрузка курсов из API НБРБ
import { state } from '../state.js';

export function rateFor(cur) {
  if (cur === 'BYN') return 1;
  if (state.rates[cur] !== undefined) return state.rates[cur];
  console.warn(`Курс для валюты «${cur}» не задан — принят 1:1. Добавьте курс в Настройках.`);
  return 1;
}