// ======= CONFIG =======
export const NAV = [
  { id: 'dashboard', label: 'Дашборд', icon: 'grid', sub: 'Сводка по капиталу и движению средств' },
  { id: 'transactions', label: 'Транзакции', icon: 'list', sub: 'Доходы и расходы, включая инвестиции' },
  { id: 'portfolio', label: 'Портфель', icon: 'layers', sub: 'Активы, созданные из транзакций' },
  { id: 'prices', label: 'Цены', icon: 'trend', sub: 'Актуальные цены активов с бирж' },
  { id: 'reports', label: 'Отчёты', icon: 'bars', sub: 'Разбор по категориям и периодам' },
  { id: 'forecast', label: 'Прогноз', icon: 'trend', sub: 'Цели и проекция капитала' },
  { id: 'settings', label: 'Настройки', icon: 'gear', sub: 'Категории, курсы, бэкапы, журнал' },
];

export const DEFAULT_ASSET_TYPES = {
  crypto: { label: 'Криптовалюта', tickers: ['BTC','ETH','USDT','BNB','SOL','XRP','ADA','DOT','DOGE','LTC','TRX','LINK'] },
  stocks: { label: 'Акции', tickers: ['AAPL','TSLA','NVDA','MSFT','AMZN','GOOGL','META','BRK.B','JPM','V','PG','JNJ','WMT','MA','KO'] },
  metals: { label: 'Металлы', tickers: ['Золото','Серебро','Платина','Палладий'] },
  lent: { label: 'Займы выданные', tickers: ['BYN','USD','EUR','RUB'] },
};

export const ASSET_CLASS_COLORS = { cash:'#6E8FD9', crypto:'#D4A24C', stocks:'#4FAE7C', metals:'#E0C36B', deposit:'#9B7FD4', lent:'#D9685F' };

export function getColorForClass(cls) { return ASSET_CLASS_COLORS[cls] || '#8891A8'; }

export const STORAGE_KEY = 'ledgerBudgetApp_v16';
