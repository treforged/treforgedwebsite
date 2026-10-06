#!/usr/bin/env node
/**
 * Vectors from the worked examples in the November PAA drafts
 * (content-queue/drafts/paa/2026-11_safe-to-spend/). If this fails, the
 * calculator and the posts that link to it disagree.
 *
 * Usage: node tools/safe-to-spend-calculator/calc.test.mjs
 */
import { totalDue, safeToSpend, perDay, shortfall } from './calc.js';

let failed = 0;
let checks = 0;
const eq = (actual, expected, name) => {
  checks++;
  const ok = Object.is(actual, expected) || Math.abs(actual - expected) < 1e-9;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - got ' + actual + ', expected ' + expected);
  if (!ok) failed++;
};

// how-much-can-i-spend-before-payday: $1,850, five bills, $100 to savings -> $50.
const BILLS = { rent: 950, utilities: 120, car: 250, groceries: 300, insurance: 80 };
eq(totalDue(BILLS), 1700, 'bills in the before-payday post total 1,700');
eq(safeToSpend(1850, BILLS, 100), 50, 'before-payday post: 1,850 - 1,700 - 100 = 50');
// what-does-safe-to-spend-mean: 3,000 - 2,000 - 500 = 500, and 4,500 - 3,000 - 750 = 750.
eq(safeToSpend(3000, [2000], 500), 500, 'meaning post, first example');
eq(safeToSpend(4500, [3000], 750), 750, 'meaning post, second example');

// A shortfall is shown, never floored.
eq(safeToSpend(500, [800], 0), -300, 'short by 300 stays -300');
eq(shortfall(-300), 300, 'shortfall of -300 is 300');
eq(shortfall(50), 0, 'no shortfall when safe is positive');

// Per day.
eq(perDay(140, 7), 20, '140 over 7 days is 20 a day');
eq(perDay(140, 7.9), 20, 'days are floored');
eq(perDay(140, 0), 0, 'payday today: 0, never Infinity');
eq(perDay(-300, 7), 0, 'no daily amount when short');

// Junk never becomes NaN.
eq(totalDue({ a: 'x', b: NaN, c: -5, d: 10 }), 10, 'junk and negatives count as 0');
eq(safeToSpend(undefined, null, undefined), 0, 'all-empty form is 0, not NaN');

console.log(`\n${checks} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
