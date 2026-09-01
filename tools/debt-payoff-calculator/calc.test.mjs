#!/usr/bin/env node
/**
 * The six published figures from /blog/debt-snowball-vs-avalanche/, via the
 * marketing desk's engine (calculator-spec-2026-09-02.md section 3). If this
 * fails, the tool and the article beside it have started disagreeing.
 *
 * Usage: node tools/debt-payoff-calculator/calc.test.mjs
 */
import { simulate, compare } from './calc.js';

let failed = 0;
let checks = 0;
const near = (actual, expected, tol, name) => {
  checks++;
  const ok = Math.abs(actual - expected) <= tol;
  const shown = Number.isFinite(actual) ? actual.toFixed(2) : actual;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - got ' + shown + ', expected ~' + expected);
  if (!ok) failed++;
};
const eq = (actual, expected, name) => {
  checks++;
  const ok = actual === expected;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - got ' + actual + ', expected ' + expected);
  if (!ok) failed++;
};

// The published example: $2,400 at 16.99% and $8,000 at 24.99%, $400 a month.
const CARDS = [
  { name: 'card1', balance: 2400, apr: 0.1699 },
  { name: 'card2', balance: 8000, apr: 0.2499 },
];

const a = simulate(CARDS, 400, 'avalanche');
eq(a.months, 36, 'avalanche clears in 36 months');
near(a.totalInterest, 3875, 1, 'avalanche costs $3,875 in interest');
eq(a.firstCleared, 29, 'avalanche clears its first card in month 29');

const s = simulate(CARDS, 400, 'snowball');
eq(s.months, 38, 'snowball clears in 38 months');
near(s.totalInterest, 4581, 1, 'snowball costs $4,581 in interest');
eq(s.firstCleared, 9, 'snowball clears its first card in month 9');

const c = compare(CARDS, 400);
near(c.interestSaved, 706, 2, 'avalanche saves ~$706 of interest');
eq(c.monthsSaved, 2, 'avalanche finishes 2 months sooner');
eq(c.firstWinSooner, 20, 'snowball delivers its first cleared card 20 months sooner');

// The inputs must not be mutated - a caller comparing both strategies passes
// the same array twice, and the second run would start from zeroed balances.
eq(CARDS[0].balance, 2400, 'simulate does not mutate the caller’s cards');
eq(CARDS[1].balance, 8000, '...either of them');

// A budget that cannot keep up must be reported, never rendered as a number.
const doomed = simulate(CARDS, 50, 'avalanche');
eq(doomed.neverEnds, true, '$50 a month against $10,400 never ends');
eq(doomed.months, Infinity, '...and returns Infinity rather than 1200');
eq(compare(CARDS, 50).interestSaved, null, '...and there is no saving to compare');

// One card is a valid plan, not an error.
const single = simulate([{ name: 'only', balance: 1000, apr: 0.2 }], 200, 'snowball');
eq(single.neverEnds, false, 'a single card still pays off');
eq(single.firstCleared, single.months, '...and clears in the final month');

// No debt is not a division by zero.
const none = simulate([], 400, 'avalanche');
eq(none.months, 0, 'no debt takes 0 months');
eq(none.firstCleared, null, '...and nothing was cleared');

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
