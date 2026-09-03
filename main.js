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

    // ── Founder waitlist capture (/founders/) ─────────────────────
    // Separate list, separate audience. Goes through the founder-waitlist edge
    // function rather than PostgREST, because a confirmation email has to send
    // and that needs a server-side Resend key.
    var wlForm = document.getElementById('waitlist-form');
    if (wlForm) {
      var WL_URL = 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/founder-waitlist';
      var wlMsg  = document.getElementById('waitlist-msg');

      var setWlMsg = function (text, kind) {
        if (!wlMsg) return;
        wlMsg.textContent = text;
        wlMsg.className = 'newsletter-msg' + (kind ? ' is-' + kind : '');
      };

      // Where the signup came from. This is the RESULT of Ruby's two-arm
      // reachability test, not a vanity field: one arm is Tre's brand account,
      // the other is developer-native placements, and the whole question is
      // whether the second reaches anyone. So the two must be tellable apart.
      //
      // Order matters. An explicit utm_source wins, because a tagged placement
      // is the only source that names ITSELF. Then the in-app browsers, which
      // send NO referrer at all — that is why the bare bio link Tre already
      // posted would otherwise land in the same bucket as a typed URL, and why
      // sniffing the client is worth it here. Then the referring host, which
      // covers every developer-native arm that arrives through a normal link.
      // Anything left is 'direct', which is honest: unknown, not assumed.
      var IN_APP = [
        [/instagram/i, 'ig-inapp'],
        [/tiktok|bytedance|musical_ly/i, 'tiktok-inapp'],
        [/\bFB[AS]V\b|FBAN|FB_IAB/, 'fb-inapp'],
        [/linkedin/i, 'linkedin-inapp']
      ];

      var wlSource = function () {
        try {
          var utm = new URLSearchParams(location.search).get('utm_source');
          if (utm) return utm;

          var ua = navigator.userAgent || '';
          for (var i = 0; i < IN_APP.length; i++) {
            if (IN_APP[i][0].test(ua)) return IN_APP[i][1];
          }

          var ref = document.referrer;
          if (!ref) return 'direct';
          var host = new URL(ref).hostname.replace(/^www\./, '');
          if (host === location.hostname) return 'on-site';
          return host;
        } catch (err) {
          return 'unknown';
        }
      };

      wlForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('waitlist-email');
        var email = (input && input.value || '').trim();
        var hp = wlForm.querySelector('.nl-hp');
        if (hp && hp.value) return;                 // honeypot: silently drop bots
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          setWlMsg('Please enter a valid email address.', 'err');
          return;
        }
        var wlBtn = wlForm.querySelector('button[type="submit"]');
        if (wlBtn) wlBtn.disabled = true;
        setWlMsg('Adding you…', '');

        fetch(WL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, company: hp ? hp.value : '', source: wlSource() })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.ok && j.already) { setWlMsg("You're already on the list — thanks!", 'ok'); wlForm.reset(); }
            else if (r.ok) { setWlMsg("You're in — check your inbox for a confirmation.", 'ok'); wlForm.reset(); }
            else if (r.status === 429) { setWlMsg('Too many tries. Please wait a minute.', 'err'); }
            else if (j.error === 'invalid_email') { setWlMsg('Please enter a valid email address.', 'err'); }
            else { setWlMsg('Something went wrong. Please try again later.', 'err'); }
          });
        }).catch(function () {
          setWlMsg('Something went wrong. Please try again later.', 'err');
        }).finally(function () {
          if (wlBtn) wlBtn.disabled = false;
        });
      });
    }

    // ── Blog view counter ─────────────────────────────────────────
    // Counts live in the treforged-site Supabase project. The counter table
    // sits in a schema that isn't exposed over REST — the RPCs below are the
    // only reachable surface. The publishable key is public by design.
    //
    // Two surfaces: the article meta line (increments, once per session) and
    // blog preview cards (read-only, one batched request per page).
    var VIEWS_URL = 'https://zyvqoefbgsgkbdoydopt.supabase.co/rest/v1/rpc/';
    var VIEWS_KEY = 'sb_publishable_cQee-ghzL5qqItuHfGJRKA_ME5FRMyg';

    function viewsRpc(fn, body) {
      return fetch(VIEWS_URL + fn, {
        method: 'POST',
        headers: {
          apikey: VIEWS_KEY,
          Authorization: 'Bearer ' + VIEWS_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error(fn + ' failed');
        return r.json();
      });
    }

    function formatViews(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 >= 100000 ? 1 : 0) + 'M';
      if (n >= 1000)    return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'K';
      return String(n);
    }

    // Builds a hidden eye-icon chip; call fillViewChip() once a count arrives.
    function makeViewChip() {
      var chip = document.createElement('span');
      chip.className = 'view-count';
      chip.hidden = true;
      chip.innerHTML =
        '<svg class="view-count-icon" viewBox="0 0 24 24" width="15" height="15" ' +
        'fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"/>' +
        '<circle cx="12" cy="12" r="3.2"/>' +
        '</svg><span class="view-count-num"></span>';
      return chip;
    }

    function fillViewChip(chip, n) {
      chip.querySelector('.view-count-num').textContent = formatViews(n);
      chip.setAttribute('aria-label', n.toLocaleString('en-US') + ' views');
      chip.title = n.toLocaleString('en-US') + ' views';
      chip.hidden = false;
    }

    // ── Article page: increment and show in the meta line ──────────
    var articleMeta = document.querySelector('.article .article-meta');
    var slugMatch   = location.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);

    if (articleMeta && slugMatch) {
      var slug    = slugMatch[1];
      var sep     = document.createElement('span');
      var counter = makeViewChip();
      sep.textContent = '·';
      articleMeta.appendChild(sep);
      articleMeta.appendChild(counter);

      // Only count one view per slug per browser session; on repeat visits we
      // still read the current total without inflating it. (The server also
      // enforces its own per-visitor cooldown.)
      var seenKey = 'tf_viewed_' + slug;
      var alreadySeen = false;
      try { alreadySeen = sessionStorage.getItem(seenKey) === '1'; } catch (err) { /* private mode */ }

      var request = alreadySeen
        ? viewsRpc('get_page_views', { p_slug: slug }).then(Number)
        : viewsRpc('increment_page_view', { p_slug: slug }).then(function (n) {
            try { sessionStorage.setItem(seenKey, '1'); } catch (err) { /* private mode */ }
            return Number(n);
          });

      request.then(function (n) {
        if (Number.isFinite(n) && n > 0) {
          fillViewChip(counter, n);
        } else {
          counter.remove();
          sep.remove();
        }
      }).catch(function () {
        // Counter is non-essential — fail silently rather than showing a broken chip.
        counter.remove();
        sep.remove();
      });
    }

    // ── Preview cards: one batched read for every card on the page ─
    var cards = Array.prototype.slice.call(
      document.querySelectorAll('a.blog-card[href^="/blog/"]')
    );

    if (cards.length) {
      var bySlug = {};

      cards.forEach(function (card) {
        var m = card.getAttribute('href').match(/^\/blog\/([a-z0-9-]+)\/?$/);
        if (!m) return;

        var chip = makeViewChip();
        var foot = card.querySelector('.blog-card-foot');

        if (foot) {
          // Listing cards: sit next to the date, keeping "Read more" hard right.
          var time = foot.querySelector('time');
          chip.classList.add('view-count-push');
          time ? time.insertAdjacentElement('afterend', chip) : foot.insertBefore(chip, foot.firstChild);
        } else {
          // Related-post cards have no foot — build one so both look the same.
          var more = card.querySelector('.blog-card-more');
          var row  = document.createElement('div');
          row.className = 'blog-card-foot';
          chip.classList.add('view-count-push');
          row.appendChild(chip);
          if (more) row.appendChild(more);
          card.appendChild(row);
        }

        (bySlug[m[1]] = bySlug[m[1]] || []).push(chip);
      });

      var slugs = Object.keys(bySlug);

      if (slugs.length) {
        viewsRpc('get_page_views_batch', { p_slugs: slugs }).then(function (rows) {
          (rows || []).forEach(function (row) {
            var n = Number(row.views);
            if (!Number.isFinite(n) || n <= 0) return;
            (bySlug[row.slug] || []).forEach(function (chip) { fillViewChip(chip, n); });
          });
        }).catch(function () {
          // Leave the chips hidden; the cards read fine without a count.
        });
      }
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
