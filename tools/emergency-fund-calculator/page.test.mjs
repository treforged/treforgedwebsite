#!/usr/bin/env node
/**
 * Presses the buttons. calc.test.mjs proves the arithmetic; this proves the
 * PAGE - it extracts the inline module from index.html, runs it against a DOM
 * built from the ids that are actually in the markup, and reads back what a
 * visitor would see.
 *
 * getElementById THROWS on an id the markup does not contain, so a script that
 * reaches for a renamed element fails here instead of silently rendering
 * nothing in a browser.
 *
 * Usage: node tools/emergency-fund-calculator/page.test.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// Every id the markup defines. The script may use these and nothing else.
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
// Seed the inputs from their value="" attributes, as a browser would.
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

// 1. The defaults render the published example, on first paint, with no input.
is('monthly', '$2,570', 'default load shows the example month');
is('carPct', '31.5%', 'default load shows the car share');
is('t1', '$2,570', '1 month target');
is('t3', '$7,710', '3 month target');
is('t6', '$15,420', '6 month target');
is('m3', '26 months at $300/mo', '3 months at $300/mo takes 26 months');

// 2. Change the savings rate. This is the control a visitor actually moves.
set('saving', 150);
is('m3', '52 months at $300/mo'.replace('$300', '$150'), '3 months at $150/mo takes 52 months');
has('starterLine', '7 months', 'the $1,000 starter is 7 months away at $150/mo');
set('saving', 300);
has('starterLine', '4 months', 'and 4 months away at $300/mo');

// 3. Saving nothing must not produce a number.
set('saving', 0);
is('m3', 'No date on it at $0 saved per month', 'saving $0 gets no fake date');
set('saving', 300);

// 4. Money already saved comes off the target.
set('saved', 3000);
is('m1', 'Already covered', 'one month is covered by $3,000 saved');
has('starterLine', 'already covered', 'so is the $1,000 starter');
is('m6', '42 months at $300/mo', 'six months still needs 42 more');
set('saved', 0);

// 5. Invalid input blanks every value rather than leaving a stale one.
set('rent', -50);
['monthly', 'carPct', 't1', 't3', 't6'].forEach((id) => is(id, '—', 'invalid input clears #' + id));
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - invalid input showed no error'); failed++; }
else console.log('ok   invalid input shows the error message');
set('rent', 1100);
checks++;
if (!nodes.get('calcError').hidden) { console.log('FAIL - the error stayed up after the input was fixed'); failed++; }
else console.log('ok   fixing the input hides the error again');
is('monthly', '$2,570', 'and the real number comes back');

// 6. An empty budget is a share of nothing, and must read as no reading.
['rent', 'carPayment', 'carInsurance', 'fuel', 'groceries', 'utilities', 'phone', 'minDebt'].forEach((f) => { nodes.get(f).value = '0'; });
onInput();
is('monthly', '$0', 'an empty budget sums to $0');
is('carPct', '—', 'and the car share is a dash, never NaN%');
is('t3', '—', 'with no target invented from nothing');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
