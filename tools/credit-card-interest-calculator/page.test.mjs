#!/usr/bin/env node
/**
 * Presses the buttons. calc.test.mjs proves the arithmetic; this proves the
 * PAGE - it extracts the inline module from
 * index.html, runs it against a DOM built from the ids actually in the markup,
 * and reads back what a visitor would see.
 *
 * getElementById THROWS on an id the markup does not contain, so a script that
 * reaches for a renamed element fails here rather than silently rendering
 * nothing in a browser.
 *
 * Usage: node tools/credit-card-interest-calculator/page.test.mjs
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

// 1. First paint reproduces the published figures for $3,000 at 24.99%.
is('perDay', '$2.05', 'costs $2.05 a day');
is('per30', '$61.62', 'and $61.62 over 30 days');
// One cent, and it is a tie, not a disagreement. 1% of $3,000 plus $62.475 of
// interest is exactly $92.475, and the published page rounded that half DOWN
// to $92.47 while rounding the identical $62.475 of interest UP to $62.48 two
// lines later. The page renders what IEEE-754 gives for each. The arithmetic
// is the same to well inside a cent (calc.test.mjs asserts it to $0.02), so
// what is recorded here is the page's real output - do not chase parity with a
// source that rounds two halves in two directions.
is('minPay', '$92.48', 'minimum payment is $92.48 (page) vs $92.47 (article): an exact half-cent tie');
is('minMonths', '185 months', 'minimums alone take 185 months');
has('minInterest', '$5,113', '...and cost $5,113 in interest');
is('fixMonths', '27 months', 'the default $150 payment takes 27 months');
has('fixInterest', '$921', '...and costs $921');
has('saved', '$4,19', 'the saving is shown');
has('savedMonths', '158 months sooner', 'and how much sooner it ends');

// 2. The payment split, which is the number people come for.
set('payment', 100);
has('splitLine', '$62.47', 'of a $100 payment, $62.47 is interest (the same half-cent tie)');
has('splitLine', '$37.53', '...leaving $37.53 of principal');

// 3. REGRESSION: a payment under the minimum used to let the page contradict
// itself - warning that $150 would not cover the interest on $8,000 while the
// payoff card still showed a confident 105 months. The warning must name the
// real minimum, and the payoff card must say what it assumed.
set('balance', 8000);
set('apr', 24.99);
set('payment', 150);
has('splitLine', 'does not even cover', 'a payment under the interest says so');
has('splitLine', 'at least', '...and names the minimum the card requires');
has('fixInterest', 'assumes you pay at least the minimum', 'the payoff card admits what it assumed');

// 4. Invalid input blanks every value rather than leaving a stale one, and
// clears again when fixed.
set('apr', 500);
['perDay', 'per30', 'minPay', 'minMonths', 'fixMonths', 'saved'].forEach((id) => is(id, '—', 'a 500% APR clears #' + id));
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - invalid input showed no error'); failed++; }
else console.log('ok   invalid input shows the error message');
set('apr', 24.99);
set('balance', 3000);
set('payment', 150);
checks++;
if (!nodes.get('calcError').hidden) { console.log('FAIL - the error stayed up after the input was fixed'); failed++; }
else console.log('ok   fixing the input hides the error again');
is('perDay', '$2.05', 'and the published figure is back');

// 5. An empty payment field is not a payoff of zero.
set('payment', '');
is('fixMonths', '—', 'no payment entered means no payoff figure');
is('splitLine', '', '...and no split line');
is('minMonths', '185 months', 'while the minimum-only column still stands');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
