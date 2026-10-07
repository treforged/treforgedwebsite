/**
 * result-email.js - "email me this result" on the Safe to Spend calculator.
 * Ask 1960d8c5, built OFF.
 *
 * OFF while #resultEmailBlock in index.html carries the `hidden` attribute: init()
 * returns at once and loads nothing - no Turnstile script, no listener, no
 * request. The server is OFF too, separately (RESULT_EMAIL_ENABLED), so either
 * switch alone stops every send. Turn-on steps: docs/result-email/README.md.
 *
 * Only the RESULT is sent (safe to spend, per day, days). The balance and bills
 * stay in the browser. Test: node tools/safe-to-spend-calculator/result-email.test.mjs
 */
import { safeToSpend, perDay } from './calc.js';

export function defaultLoadScript(src, onload) {
  var script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;
  script.onload = onload;
  document.head.appendChild(script);
}

export function init(doc, fetchFn, loadScript) {
  var block = doc.getElementById('resultEmailBlock');
  var form = doc.getElementById('resultEmailForm');
  if (!block || block.hidden || !form) {
    return 'off';
  }

  var sitekey = form.getAttribute('data-sitekey');
  if (!sitekey || sitekey === 'TURNSTILE_SITE_KEY') {
    setMsg('Email results are not available yet.', 'newsletter-msg is-err');
    return 'no-key';
  }

  var token = null;
  var widgetId = null;

  loadScript(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    function () {
      var captchaEl = doc.getElementById('resultEmailCaptcha');
      if (typeof window !== 'undefined' && window.turnstile && captchaEl) {
        widgetId = window.turnstile.render(captchaEl, {
          sitekey: sitekey,
          theme: 'dark',
          callback: function (t) {
            token = t;
          }
        });
      }
    }
  );

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    function num(id) {
      var el = doc.getElementById(id);
      if (!el) { return 0; }
      var v = el.value.trim();
      return v === '' ? 0 : parseFloat(v);
    }

    var balance = num('balance');
    var days = num('daysUntilPayday');
    var savings = num('savings');
    var bills = {
      bill1: num('bill1'),
      bill2: num('bill2'),
      bill3: num('bill3'),
      bill4: num('bill4'),
      bill5: num('bill5'),
      bill6: num('bill6')
    };
    var safe = safeToSpend(balance, bills, savings);
    var daily = perDay(safe, days);
    var emailEl = doc.getElementById('resultEmailInput');
    var email = emailEl ? emailEl.value.trim() : '';

    if (!email || email.indexOf('@') === -1) {
      setMsg('Enter your email address.', 'newsletter-msg is-err');
      return;
    }

    if (!token) {
      setMsg('Please complete the check above.', 'newsletter-msg is-err');
      return;
    }

    var submitBtn = doc.getElementById('resultEmailSubmit');
    if (submitBtn) { submitBtn.disabled = true; }

    var payload = {
      email: email,
      safe: Math.round(safe * 100) / 100,
      perDay: Math.round(daily * 100) / 100,
      days: Math.floor(days),
      followUp: doc.getElementById('resultEmailFollowUp').checked === true,
      company: doc.getElementById('resultEmailHp').value,
      turnstile: token
    };

    fetchFn(form.getAttribute('data-endpoint'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function (resp) {
      if (resp.ok) {
        setMsg('Sent. Check your inbox.', 'newsletter-msg is-ok');
        if (emailEl) { emailEl.value = ''; }
      } else {
        setMsg('That did not send. Please try again.', 'newsletter-msg is-err');
      }
    })
    .catch(function () {
      setMsg('That did not send. Please try again.', 'newsletter-msg is-err');
    })
    .finally(function () {
      if (submitBtn) { submitBtn.disabled = false; }
      token = null;
      if (widgetId !== null && typeof window !== 'undefined' && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
    });
  });

  function setMsg(text, className) {
    var msg = doc.getElementById('resultEmailMsg');
    if (msg) {
      msg.textContent = text;
      msg.className = className;
    }
  }

  return 'on';
}

if (typeof document !== 'undefined') {
  init(document, window.fetch.bind(window), defaultLoadScript);
}
