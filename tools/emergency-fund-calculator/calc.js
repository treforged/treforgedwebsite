/**
 * calc.js - emergency fund arithmetic.
 *
 * Same rule as the credit card tool beside it: the numbers come from the
 * marketing desk's verified engine, not from a re-derivation here, and
 * calc.test.mjs holds the vectors that keep this file and the article it sits
 * next to from drifting apart.
 *
 * NO interest and NO investment return is compounded into this, deliberately.
 * At these amounts and horizons a return moves the answer by less than a month,
 * and a savings-rate calculator that quietly assumes one is exactly the sort of
 * number a reader cannot check.
 */

/** One place where a field becomes a number, so every function treats junk the same. */
const amount = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

/** Sum of the monthly essentials. Missing or nonsense fields count as zero, never NaN. */
export function monthlyEssentials(items) {
  return Object.values(items || {}).reduce((sum, v) => sum + amount(v), 0);
}

/**
 * What proportion of the month runs on the car. Returns 0 rather than NaN or
 * Infinity when there are no essentials - a share of nothing is not a reading.
 */
export function carShare(items) {
  const essentials = monthlyEssentials(items);
  if (essentials === 0) return 0;
  const car = amount(items.carPayment) + amount(items.carInsurance) + amount(items.fuel);
  return car / essentials;
}

/** n months of runway. */
export const target = (monthly, n) => monthly * n;

/** Whole months of saving to reach a target. Infinity when nothing is being saved. */
export function monthsToBuild(targetAmount, monthlySaving) {
  if (!(targetAmount > 0)) return 0;
  if (!(monthlySaving > 0)) return Infinity;
  return Math.ceil(targetAmount / monthlySaving);
}
