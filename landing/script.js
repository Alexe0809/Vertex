/* ============================================================
   VERTEX LANDING — интерактив
   Всё на нативных API: IntersectionObserver, rAF, CSS-переменные.
   Никаких зависимостей.
   ============================================================ */
(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Появление блоков при скролле ---------- */
  const revealables = document.querySelectorAll('.reveal');

  if (reduced) {
    revealables.forEach(el => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = Number(el.dataset.delay || 0);
        setTimeout(() => el.classList.add('in'), delay);
        obs.unobserve(el);            // анимируем один раз
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealables.forEach(el => io.observe(el));
  }

  /* ---------- 2. Счётчики цифр ---------- */
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function countUp(el) {
    const target = Number(el.dataset.count || 0);
    const decimals = Number(el.dataset.decimals || 0);
    const duration = 1600;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const value = target * easeOut(progress);
      el.textContent = value.toLocaleString('ru-RU', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  const counters = document.querySelectorAll('[data-count]');
  if (reduced) {
    counters.forEach(el => {
      const d = Number(el.dataset.decimals || 0);
      el.textContent = Number(el.dataset.count).toLocaleString('ru-RU', {
        minimumFractionDigits: d, maximumFractionDigits: d
      });
    });
  } else {
    const counterIO = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        countUp(e.target);
        obs.unobserve(e.target);
      });
    }, { threshold: 0.5 });
    counters.forEach(el => counterIO.observe(el));
  }

  /* ---------- 3. Мокап: запуск внутренних анимаций ---------- */
  const mock = document.getElementById('heroMock');
  if (mock) {
    if (reduced) {
      mock.classList.add('in');
    } else {
      const mockIO = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          obs.unobserve(e.target);
        });
      }, { threshold: 0.3 });
      mockIO.observe(mock);
    }
  }

  /* ---------- 4. 3D-наклон за курсором ---------- */
  // Карточка слегка поворачивается вслед за мышью + световое пятно.
  if (!reduced && window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.tilt, .card').forEach(el => {
      const strength = el.classList.contains('mock') ? 6 : 4;

      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;   // 0..1
        const py = (e.clientY - r.top) / r.height;

        el.style.setProperty('--mx', `${px * 100}%`);
        el.style.setProperty('--my', `${py * 100}%`);
        el.style.transform =
          `perspective(1000px) rotateX(${(0.5 - py) * strength}deg) ` +
          `rotateY(${(px - 0.5) * strength}deg) translateY(-2px)`;
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = '';
      });
    });
  }

  /* ---------- 5. Навигация: фон при скролле ---------- */
  const nav = document.getElementById('nav');
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle('stuck', window.scrollY > 40);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 6. Переключение экранов интерфейса ---------- */
  const tabs = document.querySelectorAll('.tab');
  const panes = document.querySelectorAll('.pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      panes.forEach(p => p.classList.toggle('active', p.dataset.pane === name));
    });
  });

  /* ---------- 7. Мобильное меню ---------- */
  const burger = document.getElementById('burger');
  if (burger) {
    burger.addEventListener('click', () => {
      const links = document.querySelector('.nav-links');
      const open = links.style.display === 'flex';
      links.style.cssText = open ? '' :
        'display:flex;position:absolute;top:100%;right:24px;flex-direction:column;' +
        'gap:14px;padding:18px 22px;border-radius:14px;background:rgba(13,17,27,.96);' +
        'border:1px solid rgba(230,215,184,.14);backdrop-filter:blur(16px)';
    });
  }

  /* ---------- 8. Параллакс орбов фона ---------- */
  if (!reduced) {
    const orbs = document.querySelectorAll('.orb');
    let px = 0, py = 0, raf = null;

    window.addEventListener('mousemove', e => {
      px = (e.clientX / window.innerWidth - 0.5);
      py = (e.clientY / window.innerHeight - 0.5);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        orbs.forEach((orb, i) => {
          const depth = (i + 1) * 14;
          orb.style.translate = `${px * depth}px ${py * depth}px`;
        });
        raf = null;
      });
    }, { passive: true });
  }
})();
