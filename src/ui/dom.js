// ======= TOAST & MODAL =======
export function toast(msg, kind) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'danger' ? ' danger' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 3200);
}
export function openModal(html) {
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('active');
}
export function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('active');
  document.getElementById('modalBody').innerHTML = '';
}
// dom.js
export function initModals() {
  document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}
export function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}