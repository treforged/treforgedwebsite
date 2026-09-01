#!/usr/bin/env node
/**
 * Presses the buttons. calc.test.mjs proves the arithmetic against the six
 * published figures; this proves the PAGE - it extracts the inline module from
 * index.html, runs it against a DOM built from the ids actually in the markup,
 * and reads back what a visitor would see.
 *
 * getElementById THROWS on an id the markup does not contain, so a script that
 * reaches for a renamed element fails here rather than silently rendering
 * nothing in a browser.
 *
 * Usage: node tools/debt-payoff-calculator/page.test.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

const ids = new Set();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);

const nodes = new Map();
let onInput = null;
for (const id of ids) {
  nodes.set(id, {
    id,
    value: '',
    textContent: '',
    hidden: false,
    addEventListener(type, fn) { if (type === 'input') onInput = fn; },
  });
}
for (const m of html.matchAll(/<input\s+id="([^"]+)"[^>]*\svalue="([^"]*)"/g)) {
  if (nodes.has(m[1])) nodes.get(m[1]).value = m[2];
}

globalThis.document = {
  getElementById(id) {
    if (!nodes.has(id)) throw new Error('page script asked for #' + id + ', which is not in index.html');
    return nodes.get(id);
  },
};

const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const tmp = join(here, '.page.test.tmp.mjs');
writeFileSync(tmp, script, 'utf8');
try {
  await import(pathToFileURL(tmp).href);
} finally {
  unlinkSync(tmp);
}

let failed = 0;
let checks = 0;
const show = (id) => nodes.get(id).textContent;
const is = (id, expected, name) => {
  checks++;
  const ok = show(id) === expected;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - #' + id + ' shows "' + show(id) + '"' + (ok ? '' : ', expected "' + expected + '"'));
  if (!ok) failed++;
};
const has = (id, needle, name) => {
  checks++;
  const ok = show(id).includes(needle);
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - #' + id + ' shows "' + show(id) + '"' + (ok ? '' : ', expected to contain "' + needle + '"'));
  if (!ok) failed++;
};
const set = (id, v) => { nodes.get(id).value = String(v); onInput(); };

if (typeof onInput !== 'function') {
  console.log('FAIL - the page never registered an input handler');
  process.exit(1);
}

// 1. First paint reproduces the published comparison, with no input at all.
is('avaMonths', '36 months', 'avalanche: 36 months on first paint');
is('avaInterest', '$3,875', 'avalanche: $3,875 of interest');
is('avaFirst', 'Month 29', 'avalanche: first card clears month 29');
is('snoMonths', '38 months', 'snowball: 38 months');
is('snoInterest', '$4,581', 'snowball: $4,581 of interest');
is('snoFirst', 'Month 9', 'snowball: first card clears month 9');
has('verdict', '$706 less in interest', 'the verdict names what avalanche saves');
has('verdict', '20 months earlier', 'and what snowball buys instead');

// 2. A third card is picked up.
set('b3', 500);
// A balance with no rate is an incomplete card, and silently leaving it out
// would show an answer that omits debt the visitor just typed in. So the
// values blank and the page says what is missing.
is('avaMonths', '—', 'a balance with no rate blanks the answer rather than ignoring the card');
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - a balance with no rate showed no error'); failed++; }
else console.log('ok   a balance with no rate is an error, not a silent guess');
set('a3', 29.99);
is('snoFirst', 'Month 2', 'the new smallest card clears first under snowball');
set('b3', '');
set('a3', '');
is('avaMonths', '36 months', 'clearing the third card restores the original answer');

// 3. A payment that cannot keep up must never print a payoff month.
set('budget', 50);
is('avaMonths', '—', 'a doomed budget prints no month');
is('snoInterest', '—', 'and no interest figure');
has('verdict', 'does not clear', 'it says so, and names what it would take');
has('verdict', 'a month is where it starts moving', 'the required amount is given, not just the complaint');
set('budget', 400);
is('avaMonths', '36 months', 'and the real answer comes back');

// 4. One card is a plan, not an error.
set('b2', '');
set('a2', '');
has('verdict', 'the two strategies are the same plan', 'one card says both columns match');
is('avaMonths', show('snoMonths'), '...and they do match');
set('b2', 8000);
set('a2', 24.99);

// 5. No debt at all.
set('b1', '');
set('a1', '');
set('b2', '');
set('a2', '');
is('avaMonths', '—', 'no cards prints no answer');
has('verdict', 'Enter at least one card', 'and asks for one');

// 6. Invalid input clears everything and the error clears when fixed.
set('b1', 2400);
set('a1', 150);
is('avaMonths', '—', 'a 150% rate clears the values');
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - invalid input showed no error'); failed++; }
else console.log('ok   invalid input shows the error message');
set('a1', 16.99);
set('b2', 8000);
set('a2', 24.99);
checks++;
if (!nodes.get('calcError').hidden) { console.log('FAIL - the error stayed up after the input was fixed'); failed++; }
else console.log('ok   fixing the input hides the error again');
is('avaMonths', '36 months', 'and the published answer is back');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
