#!/usr/bin/env node
/**
 * Gate for result-email.js, the "email me this result" form. Ask 1960d8c5.
 *
 * 1. The SHIPPED index.html has `hidden` on #resultEmailBlock (the off switch).
 * 2. Off: init() loads no script, adds no listener, makes no request.
 * 3. On with the placeholder site key: still no script, no request.
 * 4. On with a key: the submit sends ONLY the result - never balance or bills -
 *    and sends nothing until Turnstile has produced a token.
 *
 * Usage: node tools/safe-to-spend-calculator/result-email.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from './result-email.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

let checks = 0;
let failed = 0;
function ok(cond, name) {
  checks++;
  if (!cond) { failed++; console.log('FAIL  ' + name); } else console.log('ok    ' + name);
}

// 1. The shipped page is off.
const section = html.match(/<section[^>]*id="resultEmailBlock"[^>]*>/);
ok(section && /\shidden(\s|>)/.test(section[0]), 'shipped index.html: #resultEmailBlock carries hidden');
const form = html.match(/<form[^>]*id="resultEmailForm"[^>]*>/);
ok(form && !/\shidden(\s|>)/.test(form[0]), 'hidden is NOT on the form (.newsletter-form display:flex would beat it)');

function fakeDoc({ hidden, sitekey }) {
  const listeners = [];
  const el = (id, extra) => Object.assign({
    id, value: '', textContent: '', className: '', checked: false, disabled: false,
    getAttribute: () => null,
    addEventListener: (type, fn) => listeners.push({ id, type, fn }),
  }, extra);
  const values = { balance: '1850', daysUntilPayday: '7', savings: '100', bill1: '950', bill2: '120', bill3: '250', bill4: '300', bill5: '80', bill6: '0' };
  const nodes = {
    resultEmailBlock: el('resultEmailBlock', { hidden }),
    resultEmailForm: el('resultEmailForm', {
      getAttribute: (a) => (a === 'data-sitekey' ? sitekey : a === 'data-endpoint' ? 'https://fn.example/calculator-result-email' : null),
    }),
    resultEmailInput: el('resultEmailInput', { value: ' reader@example.com ' }),
    resultEmailFollowUp: el('resultEmailFollowUp', { checked: true }),
    resultEmailHp: el('resultEmailHp'),
    resultEmailMsg: el('resultEmailMsg'),
    resultEmailSubmit: el('resultEmailSubmit'),
    resultEmailCaptcha: el('resultEmailCaptcha'),
  };
  for (const [k, v] of Object.entries(values)) nodes[k] = el(k, { value: v });
  return { doc: { getElementById: (id) => nodes[id] || null }, nodes, listeners };
}

function spies() {
  const fetches = [];
  const loads = [];
  return {
    fetches, loads,
    fetchFn: (url, init) => { fetches.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); },
    loadScript: (src, cb) => loads.push({ src, cb }),
  };
}
const submit = (listeners) => listeners.find((l) => l.type === 'submit').fn({ preventDefault() {} });
const settle = () => new Promise((r) => setTimeout(r, 0));

// 2. Off.
{
  const f = fakeDoc({ hidden: true, sitekey: 'real-key' });
  const s = spies();
  ok(init(f.doc, s.fetchFn, s.loadScript) === 'off', 'off: init returns off');
  ok(s.loads.length === 0 && s.fetches.length === 0 && f.listeners.length === 0, 'off: no script, no request, no listener');
}

// 3. Placeholder key.
{
  const f = fakeDoc({ hidden: false, sitekey: 'TURNSTILE_SITE_KEY' });
  const s = spies();
  ok(init(f.doc, s.fetchFn, s.loadScript) === 'no-key', 'placeholder key: init returns no-key');
  ok(s.loads.length === 0 && s.fetches.length === 0, 'placeholder key: no script, no request');
}

// 4. On, with a key.
{
  const f = fakeDoc({ hidden: false, sitekey: 'real-key' });
  const s = spies();
  let resets = 0;
  let solve = null;
  globalThis.window = { turnstile: { render: (_el, opts) => { solve = opts.callback; return 'w1'; }, reset: () => { resets++; } } };
  ok(init(f.doc, s.fetchFn, s.loadScript) === 'on', 'on: init returns on');
  ok(s.loads.length === 1 && s.loads[0].src.startsWith('https://challenges.cloudflare.com/turnstile/'), 'on: loads Turnstile once');
  s.loads[0].cb();

  submit(f.listeners);
  await settle();
  ok(s.fetches.length === 0, 'on: no request before Turnstile gives a token');
  ok(/complete the check/.test(f.nodes.resultEmailMsg.textContent), 'on: tells the visitor to complete the check');

  solve('tok-123');
  submit(f.listeners);
  await settle();
  ok(s.fetches.length === 1, 'on: one request after the token');
  const body = s.fetches[0].body;
  ok(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['company', 'days', 'email', 'followUp', 'perDay', 'safe', 'turnstile']),
    'payload carries ONLY result fields - got ' + Object.keys(body).join(','));
  ok(body.safe === 50 && body.perDay === 7.14 && body.days === 7, 'payload result matches the calculator (safe 50, perDay 7.14)');
  ok(body.email === 'reader@example.com' && body.followUp === true && body.turnstile === 'tok-123', 'payload email, follow-up box, token');
  ok(/Sent/.test(f.nodes.resultEmailMsg.textContent) && resets === 1, 'on: success message shown and Turnstile reset for reuse');
  delete globalThis.window;
}

console.log(`\n${failed ? 'FAIL' : 'PASS'} - ${checks} checks, ${failed} failed`);
if (checks === 0) process.exit(2);
process.exit(failed ? 1 : 0);
