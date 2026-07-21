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

export const ASSET_CLASS_COLORS = { cash:'#B8935A', crypto:'#D9B36C', stocks:'#7FA98C', metals:'#C9A468', deposit:'#8F6E38', lent:'#C08B6A' };

export function getColorForClass(cls) { return ASSET_CLASS_COLORS[cls] || '#A29D8F'; }

export const STORAGE_KEY = 'ledgerBudgetApp_v16';
