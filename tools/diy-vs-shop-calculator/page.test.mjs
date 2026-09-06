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
 * And the assertions are on what CHANGED, not on the handler not throwing. A
 * press that raises no error is not a passing test - that is how a dead tab
 * shipped in another repo this week with both its handlers wired to the same
 * view.
 *
 * Usage: node tools/diy-vs-shop-calculator/page.test.mjs
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
const lacks = (id, needle, name) => {
  checks++;
  const ok = !show(id).includes(needle);
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - #' + id + ' shows "' + show(id) + '"');
  if (!ok) failed++;
};
const set = (id, v) => { nodes.get(id).value = String(v); onInput(); };

if (typeof onInput !== 'function') {
  console.log('FAIL - the page never registered an input handler');
  process.exit(1);
}

// 1. First paint, from the value="" attributes alone - no interaction.
is('savings', '$235', 'default load shows what you keep');
is('hourly', '$94/hr', 'and what the time earns');
has('diyCostLine', '$85', 'the DIY cost line names the parts cost');
has('hourlySub', '2.5 hours', 'the sub-line shows the hours it is divided by');

// 2. With no value-of-time entered it must REFUSE to judge worth.
has('verdictLine', 'Put in what an hour of your time is worth', 'it will not judge worth without the reader saying what time is worth');
lacks('verdictLine', 'Worth doing', 'and does not claim a verdict it has not earned');

// 3. The reader's own hourly figure flips the verdict, both ways.
set('valueOfTime', 30);
has('verdictLine', 'Worth doing yourself', 'against $30/hr it says worth doing');
set('valueOfTime', 150);
has('verdictLine', 'Not worth it on the money alone', 'against $150/hr it says not');
has('verdictLine', 'fair choice', 'and does not moralise about doing it anyway');
set('valueOfTime', 0);

// 4. Tools change the answer, and amortising them changes it back.
set('toolsCost', 120);
is('savings', '$115', 'a one-off tool comes straight off the saving');
has('toolLine', 'job number 1', 'and it pays for itself on the first job here');
set('toolUses', 4);
is('savings', '$205', 'spread over 4 jobs the saving rises');
has('diyCostLine', '$30 of the tools', 'and the cost line shows the per-job tool share');
set('toolsCost', 0);
set('toolUses', 1);
lacks('toolLine', 'job number', 'no tool bought means no break-even line at all');

// 5. DIY costing MORE is a real answer, not an error state.
set('shopQuote', 60);
set('partsCost', 20);
set('toolsCost', 90);
has('verdictLine', 'MORE than the quote', 'it says plainly when DIY costs more');
has('savings', '-$50', 'and shows the loss as a negative, not a blank');
has('toolLine', 'job number 3', 'while still saying when the tool would pay off');
set('shopQuote', 320);
set('partsCost', 85);
set('toolsCost', 0);

// 6. No hours means no reading. Never Infinity, never a confident zero.
set('hours', 0);
is('savings', '—', 'zero hours clears the saving');
is('hourly', '—', 'and the hourly rate');
has('verdictLine', 'appears here', 'replacing them with an instruction, not a number');
set('hours', 2.5);
is('hourly', '$94/hr', 'and the real number comes back');

// 7. Invalid input blanks every value rather than leaving a stale one.
set('partsCost', -50);
is('savings', '—', 'invalid input clears the saving');
is('hourly', '—', 'and the hourly');
checks++;
if (nodes.get('calcError').hidden) { console.log('FAIL - invalid input showed no error'); failed++; }
else console.log('ok   invalid input shows the error message');
set('partsCost', 85);
checks++;
if (!nodes.get('calcError').hidden) { console.log('FAIL - the error stayed up after the input was fixed'); failed++; }
else console.log('ok   fixing the input hides the error again');
is('savings', '$235', 'and the real number comes back');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
