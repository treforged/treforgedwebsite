(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {

    // ── Mobile hamburger ──────────────────────────────────────────
    // KEY FIX: On iOS, touchend fires AND then click fires ~300ms later.
    // Both listeners = double toggle = menu opens then immediately closes.
    // Solution: use a flag to swallow the synthetic click that follows touchend.
    var burger = document.getElementById('burger');
    var nav    = document.getElementById('mobileNav');

    if (burger && nav) {
      var touchFired = false;

      function openNav() {
        nav.classList.add('open');
        burger.setAttribute('aria-expanded', 'true');
      }
      function closeNav() {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
      function toggle() {
        nav.classList.contains('open') ? closeNav() : openNav();
      }

      // touchstart: act immediately, set flag to block the follow-up click
      burger.addEventListener('touchstart', function (e) {
        e.preventDefault();   // prevents ghost click AND iOS hover delay
        touchFired = true;
        toggle();
      }, { passive: false });

      // click: only run if touch didn't already handle it
      burger.addEventListener('click', function (e) {
        if (touchFired) {
          touchFired = false;  // reset for next interaction
          return;              // swallow the ghost click
        }
        toggle();
      });

      // keyboard
      burger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });

      // close when a nav link is tapped
      nav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', closeNav);
      });

      // close when tapping/clicking outside
      document.addEventListener('touchstart', function (e) {
        if (nav.classList.contains('open') &&
            !nav.contains(e.target) &&
            !burger.contains(e.target)) {
          closeNav();
        }
      }, { passive: true });

      document.addEventListener('click', function (e) {
        if (nav.classList.contains('open') &&
            !nav.contains(e.target) &&
            !burger.contains(e.target)) {
          closeNav();
        }
      });

      // close on resize to desktop
      window.addEventListener('resize', function () {
        if (window.innerWidth > 900) closeNav();
      });
    }

    // ── Reveal on scroll ──────────────────────────────────────────
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(function (el) { obs.observe(el); });

    // ── Smooth image fade-in ──────────────────────────────────────
    document.querySelectorAll('img.smooth-img').forEach(function (img) {
      if (img.complete) {
        img.classList.add('is-loaded');
      } else {
        img.addEventListener('load',  function () { img.classList.add('is-loaded'); }, { once: true });
        img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
      }
    });

    // ── Newsletter capture ────────────────────────────────────────
    // Posts to a locked-down Supabase table (anon may INSERT only; RLS blocks
    // reads). The publishable key is public by design — safe to ship here.
    var nlForm = document.getElementById('newsletter-form');
    if (nlForm) {
      var SB_URL = 'https://mdtosrbfkextcaezuclh.supabase.co/rest/v1/newsletter_subscribers';
      var SB_KEY = 'sb_publishable_UVsFbmZ2h9rXN0WBf1iQVA_6d8-Yyr7';
      var nlMsg  = document.getElementById('newsletter-msg');

      function setNlMsg(text, kind) {
        if (!nlMsg) return;
        nlMsg.textContent = text;
        nlMsg.className = 'newsletter-msg' + (kind ? ' is-' + kind : '');
      }

      nlForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('newsletter-email');
        var email = (input && input.value || '').trim();
        var hp = nlForm.querySelector('.nl-hp');
        if (hp && hp.value) return;                 // honeypot: silently drop bots
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setNlMsg('Please enter a valid email address.', 'err');
          return;
        }
        var btn = nlForm.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        setNlMsg('Subscribing…', '');

        fetch(SB_URL, {
          method: 'POST',
          headers: {
            apikey: SB_KEY,
            Authorization: 'Bearer ' + SB_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ email: email, source: 'treforged.com' })
        }).then(function (r) {
          if (r.status === 201) { setNlMsg("You're in — watch your inbox.", 'ok'); nlForm.reset(); }
          else if (r.status === 409) { setNlMsg("You're already subscribed — thanks!", 'ok'); nlForm.reset(); }
          else { setNlMsg('Something went wrong. Please try again later.', 'err'); }
        }).catch(function () {
          setNlMsg('Something went wrong. Please try again later.', 'err');
        }).finally(function () {
          if (btn) btn.disabled = false;
        });
      });
    }

    // ── Lightbox ──────────────────────────────────────────────────
    var modal    = document.getElementById('imgModal');
    var modalImg = document.getElementById('modalImage');
    var caption  = document.getElementById('caption');
    var closeBtn = document.querySelector('.modal-close');
    var popups   = Array.from(document.querySelectorAll('.popup-img'));

    if (!modal || !popups.length) return;

    var current = -1;

    function openModal(idx) {
      current = idx;
      modal.style.display = 'flex';
      modalImg.src = popups[idx].src;
      if (caption) caption.textContent = popups[idx].alt || '';
    }
    function closeModal() {
      modal.style.display = 'none';
    }

    popups.forEach(function (img, i) {
      img.addEventListener('click', function () { openModal(i); });
    });
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    document.addEventListener('keydown', function (e) {
      if (modal.style.display !== 'flex') return;
      if (e.key === 'Escape')      closeModal();
      if (e.key === 'ArrowRight')  openModal((current + 1) % popups.length);
      if (e.key === 'ArrowLeft')   openModal((current - 1 + popups.length) % popups.length);
    });

    var swipeX = 0;
    modal.addEventListener('touchstart', function (e) { swipeX = e.touches[0].clientX; }, { passive: true });
    modal.addEventListener('touchend', function (e) {
      if (modal.style.display !== 'flex') return;
      var d = swipeX - e.changedTouches[0].clientX;
      if (d >  50) openModal((current + 1) % popups.length);
      if (d < -50) openModal((current - 1 + popups.length) % popups.length);
    }, { passive: true });

  });
})();
