#!/usr/bin/env node
/**
 * The verified vectors from the marketing desk's /answers engine
 * (claudecontext/marketing/calculator-spec-2026-09-02.md, section 2). If this
 * fails, the calculator and the article beside it have started telling readers
 * different things.
 *
 * Usage: node tools/emergency-fund-calculator/calc.test.mjs
 */
import { monthlyEssentials, carShare, target, monthsToBuild } from './calc.js';

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

// The example essentials the published figures were computed from.
const EXAMPLE = {
  rent: 1100,
  carPayment: 400,
  carInsurance: 160,
  groceries: 400,
  utilities: 150,
  phone: 60,
  fuel: 250,
  minDebt: 50,
};

const monthly = monthlyEssentials(EXAMPLE);
eq(monthly, 2570, 'the example essentials come to $2,570/mo');
near(carShare(EXAMPLE) * 100, 31.5, 0.05, 'the car is ~31.5% of the month');

eq(target(monthly, 1), 2570, '1 month of runway is $2,570');
eq(target(monthly, 3), 7710, '3 months of runway is $7,710');
eq(target(monthly, 6), 15420, '6 months of runway is $15,420');

eq(monthsToBuild(7710, 300), 26, 'building 3 months at $300/mo takes 26 months');
eq(monthsToBuild(7710, 150), 52, 'building 3 months at $150/mo takes 52 months');
eq(monthsToBuild(1000, 300), 4, 'a $1,000 starter at $300/mo takes 4 months');
eq(monthsToBuild(1000, 150), 7, 'a $1,000 starter at $150/mo takes 7 months');

// Nothing may render as NaN, Infinity, or a share of nothing.
eq(monthlyEssentials({}), 0, 'no essentials sums to 0');
eq(carShare({}), 0, 'car share of nothing is 0, not NaN');
eq(carShare({ rent: 1000 }), 0, 'a budget with no car is a 0% car share, not NaN');
eq(monthlyEssentials({ rent: 1000, groceries: -5, phone: undefined, utilities: NaN }), 1000, 'junk fields count as zero');
eq(monthsToBuild(7710, 0), Infinity, 'saving nothing never gets there');
eq(monthsToBuild(0, 300), 0, 'a target already met takes 0 months');

// Prove the counter is real: a suite that examined nothing must not pass.
if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? '\n' + failed + ' of ' + checks + ' check(s) FAILED' : '\nPASS - ' + checks + ' checks');
process.exit(failed ? 1 : 0);
