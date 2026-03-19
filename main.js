(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {

    // ── Mobile nav ────────────────────────────────────────────────
    const burger = document.getElementById('burger');
    const mobileNav = document.getElementById('mobileNav');

    if (burger && mobileNav) {
      const toggle = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const open = mobileNav.classList.toggle('open');
        burger.setAttribute('aria-expanded', String(open));
      };
      burger.addEventListener('click', toggle);
      burger.addEventListener('touchstart', toggle, { passive: false });
      burger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
      });
      mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }));
      document.addEventListener('click', (e) => {
        if (!mobileNav.contains(e.target) && !burger.contains(e.target)) {
          mobileNav.classList.remove('open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 960) {
          mobileNav.classList.remove('open');
          burger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // ── Reveal on scroll ─────────────────────────────────────────
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.10 });
    document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

    // ── Smooth image fade-in ──────────────────────────────────────
    document.querySelectorAll('img.smooth-img').forEach(img => {
      if (img.complete) img.classList.add('is-loaded');
      else {
        img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
        img.addEventListener('error', () => img.classList.add('is-loaded'), { once: true });
      }
    });

    // ── Lightbox ──────────────────────────────────────────────────
    const modal = document.getElementById('imgModal');
    const modalImg = document.getElementById('modalImage');
    const captionEl = document.getElementById('caption');
    const closeBtn = document.querySelector('.close');
    const popups = Array.from(document.querySelectorAll('.popup-img'));

    if (!modal || !popups.length) return;

    let current = -1;

    const openModal = (idx) => {
      current = idx;
      modal.classList.add('open');
      modalImg.src = popups[idx].src;
      if (captionEl) captionEl.textContent = popups[idx].alt || '';
    };
    const closeModal = () => { modal.classList.remove('open'); };

    popups.forEach((img, i) => img.addEventListener('click', () => openModal(i)));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowRight') openModal((current + 1) % popups.length);
      if (e.key === 'ArrowLeft') openModal((current - 1 + popups.length) % popups.length);
    });

    let startX = 0;
    modal.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    modal.addEventListener('touchend', (e) => {
      if (!modal.classList.contains('open')) return;
      const d = startX - e.changedTouches[0].clientX;
      if (d > 50) openModal((current + 1) % popups.length);
      if (d < -50) openModal((current - 1 + popups.length) % popups.length);
    }, { passive: true });

  });
})();
