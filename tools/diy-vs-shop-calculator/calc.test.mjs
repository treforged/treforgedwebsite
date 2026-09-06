#!/usr/bin/env node
/**
 * Vectors for the DIY-vs-shop arithmetic.
 *
 * Unlike the calculators beside it, these are NOT oracle figures from the
 * marketing desk's engine - there is no published article with these numbers to
 * drift from, because every input belongs to the reader. So these assert the
 * arithmetic itself and, more importantly, every way it can refuse to answer:
 * a money tool that renders NaN, Infinity or a confident zero is worse than one
 * that says nothing.
 *
 * Usage: node tools/diy-vs-shop-calculator/calc.test.mjs
 */
import { diyCost, savings, effectiveHourly, verdict, toolBreakEvenJobs } from './calc.js';

let failed = 0;
let checks = 0;
const eq = (actual, expected, name) => {
  checks++;
  const ok = Object.is(actual, expected);
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - got ' + actual + ', expected ' + expected);
  if (!ok) failed++;
};
const near = (actual, expected, tol, name) => {
  checks++;
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' - got ' + actual + ', expected ~' + expected);
  if (!ok) failed++;
};

// A brake job the reader was quoted for. Every number is theirs.
const BRAKES = { shopQuote: 320, partsCost: 85, toolsCost: 0, hours: 2.5 };

eq(diyCost(BRAKES), 85, 'doing the brakes yourself costs the parts only');
eq(savings(BRAKES), 235, 'that keeps $235');
near(effectiveHourly(BRAKES), 94, 0.001, 'which is $94/hour of their own time');
eq(verdict(BRAKES), 'no-comparison', 'without their hourly figure it will not judge worth');
eq(verdict(BRAKES, 30), 'worth-it', 'against $30/hr it is worth doing');
eq(verdict(BRAKES, 150), 'not-worth-it', 'against $150/hr it is not');

// Tools amortise. This is the case that flips an answer.
const WITH_TOOL = { shopQuote: 320, partsCost: 85, toolsCost: 120, hours: 2.5 };
eq(diyCost(WITH_TOOL), 205, 'a one-off tool charges its whole price to one job');
eq(savings(WITH_TOOL), 115, 'so the first job keeps $115, not $235');
eq(diyCost({ ...WITH_TOOL, toolUses: 4 }), 115, 'over 4 jobs the tool costs $30 a job');
eq(savings({ ...WITH_TOOL, toolUses: 4 }), 205, 'and the saving rises to $205');

// Doing it yourself CAN cost more. That is an answer, not an error.
const BAD = { shopQuote: 60, partsCost: 20, toolsCost: 90, hours: 1 };
eq(savings(BAD), -50, 'a $90 tool for a $60 job loses $50 the first time');
eq(verdict(BAD, 30), 'costs-more', 'and no hourly rate can rescue that');
eq(verdict(BAD), 'costs-more', 'reported even without an hourly figure');
eq(toolBreakEvenJobs(BAD), 3, 'the tool pays for itself on the 3rd job');
eq(toolBreakEvenJobs({ shopQuote: 320, partsCost: 85, toolsCost: 120 }), 1, 'a cheap tool on a big job pays back immediately');
eq(toolBreakEvenJobs(BRAKES), null, 'no tool bought means no break-even to report');
eq(toolBreakEvenJobs({ shopQuote: 50, partsCost: 80, toolsCost: 40 }), null, 'parts alone over the quote never breaks even');

// ---- refusing to answer, which is most of the value --------------------------
eq(effectiveHourly({ ...BRAKES, hours: 0 }), null, 'no hours entered is null, not Infinity');
eq(effectiveHourly({ shopQuote: 0, partsCost: 85, hours: 2 }), null, 'no quote entered is null, not a negative wage');
eq(effectiveHourly({}), null, 'an empty form reads null, never NaN');
eq(verdict({}), 'no-reading', 'and the verdict says so plainly');
eq(verdict({ ...BRAKES, hours: 0 }), 'no-reading', 'hours missing means no verdict, not a lucky guess');

// Junk must not become NaN anywhere. A NaN reaching the page renders as a blank
// that looks like a real empty state.
eq(diyCost({ partsCost: -5, toolsCost: NaN, toolUses: 0 }), 0, 'negative, NaN and zero-uses fields count as zero');
eq(diyCost({ partsCost: 100, toolsCost: 60, toolUses: -3 }), 160, 'a nonsense tool-uses count falls back to once');
eq(diyCost({ partsCost: 100, toolsCost: 60, toolUses: 2.9 }), 130, 'fractional uses floor to whole jobs');
eq(savings({ shopQuote: 'lots', partsCost: 85, hours: 2 }), -85, 'a non-numeric quote is zero, not a crash');
eq(Number.isNaN(savings({})), false, 'an empty input never produces NaN');

// Prove the counter is real: a suite that examined nothing must not pass.
if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
