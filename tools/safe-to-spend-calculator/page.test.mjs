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
 * Usage: node tools/safe-to-spend-calculator/page.test.mjs
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

// 1. First paint shows the worked example from the before-payday post.
is('safeToSpend', '$50', 'default load: 1,850 - 1,700 bills - 100 saved = $50');
is('perDay', '$7.14', 'over 7 days that is $7.14 a day');
is('shortfallLine', '', 'no shortfall line when the number is positive');

// 2. Move the control a visitor moves: the balance.
set('balance', 2550);
is('safeToSpend', '$750', 'a 2,550 balance leaves $750');
is('perDay', '$107.14', 'which is $107.14 a day');

// 3. A shortfall is SHOWN, never floored to zero.
set('balance', 1500);
is('safeToSpend', '-$300', '1,500 is $300 short');
is('perDay', '—', 'no daily amount when short');
has('shortfallLine', '$300', 'the shortfall line names $300');
set('balance', 1850);
is('shortfallLine', '', 'and clears once the balance covers the bills');

// 4. Invalid input blanks every value rather than leaving a stale one.
set('daysUntilPayday', 0);
['safeToSpend', 'perDay'].forEach((id) => is(id, '—', 'invalid days clears #' + id));
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - invalid input showed no error'); failed++; }
else console.log('ok   invalid input shows the error message');
set('daysUntilPayday', 7);
checks++;
if (!nodes.get('calcError').hidden) { console.log('FAIL - the error stayed up after the input was fixed'); failed++; }
else console.log('ok   fixing the input hides the error again');
is('safeToSpend', '$50', 'and the real number comes back');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
