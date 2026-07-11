// ======= FORMATTERS =======
export function fmt(n, d=2) { return new Intl.NumberFormat('ru-RU', {minimumFractionDigits:d, maximumFractionDigits:d}).format(n||0); }
export function fmtUSD(n) { return '$'+fmt(n,2); }
export function fmtPct(n) { return (n>=0?'+':'')+fmt(n,1)+'%'; }
export function fmtDate(iso) { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}); }
export function fmtDateTime(iso) { const d=new Date(iso); return d.toLocaleDateString('ru-RU')+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function monthKey(iso) { return iso.slice(0,7); }
export function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }