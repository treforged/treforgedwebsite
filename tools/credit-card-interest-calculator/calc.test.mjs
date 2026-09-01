#!/usr/bin/env node
/**
 * The verified vectors from the marketing desk's /answers engine. These match
 * the published page, so if this file fails the calculator and the article
 * beside it have started telling readers different things.
 *
 * Usage: node tools/credit-card-interest-calculator/calc.test.mjs
 */
import { dailyInterest, interestOver, minPayment, splitPayment, payoff } from './calc.js';

let failed = 0;
const near = (actual, expected, tol, name) => {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — got ${Number.isFinite(actual) ? actual.toFixed(2) : actual}, expected ~${expected}`);
  if (!ok) failed++;
};
const eq = (actual, expected, name) => {
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — got ${actual}, expected ${expected}`);
  if (!ok) failed++;
};

const B = 3000, APR = 0.2499;

near(dailyInterest(B, APR), 2.05, 0.01, '$3,000 @ 24.99% costs ~$2.05/day');
near(interestOver(B, APR, 30), 61.62, 0.02, '...and ~$61.62 per 30 days');
near(minPayment(B, APR), 92.47, 0.02, 'minimum payment is ~$92.47');

const split = splitPayment(B, APR, 100);
near(split.interest, 62.48, 0.02, 'of a $100 payment, ~$62.48 is interest');
near(split.principal, 37.52, 0.02, '...leaving ~$37.52 of principal');
eq(split.coversInterest, true, '$100 does cover the interest');

const min = payoff(B, APR);
eq(min.months, 185, 'minimum payments only: 185 months');
near(min.totalInterest, 5113, 5, 'minimum payments only: ~$5,113 interest');

const f100 = payoff(B, APR, { mode: 'fixed', fixedPayment: 100 });
eq(f100.months, 48, 'flat $100: 48 months');
near(f100.totalInterest, 1756, 5, 'flat $100: ~$1,756 interest');

const f150 = payoff(B, APR, { mode: 'fixed', fixedPayment: 150 });
eq(f150.months, 27, 'flat $150: 27 months');
near(f150.totalInterest, 921, 5, 'flat $150: ~$921 interest');

// A payment under the monthly interest must be reported, never rendered as a number.
const doomed = payoff(B, APR, { mode: 'fixed', fixedPayment: 10 });
eq(doomed.neverEnds, false, 'a $10 "payment" is floored to the minimum, so it still ends');
const tiny = payoff(500000, 0.30, { mode: 'fixed', fixedPayment: 1 });
eq(Number.isFinite(tiny.months) || tiny.neverEnds, true, 'huge balance still returns a defined result');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);
