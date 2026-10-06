/**
 * calc.js - safe to spend before payday.
 *
 * The rule the November "People also ask" posts teach: your balance, minus
 * every bill due before the next paycheck, minus the savings you move first.
 * calc.test.mjs holds the worked examples from those posts, so this file and
 * the articles that link to it cannot start telling readers different things.
 *
 * A negative result is the SHORTFALL and is returned as it is. A calculator
 * that floors it at zero would tell a reader who is short that they are fine.
 */

/** One place where a field becomes a number, so every function treats junk the same. */
const amount = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

/** Sum of an object or array of amounts (bills due before payday). Junk counts as 0, never NaN. */
export function totalDue(items) {
  if (Array.isArray(items)) {
    return items.reduce((sum, v) => sum + amount(v), 0);
  } else {
    return Object.values(items || {}).reduce((sum, v) => sum + amount(v), 0);
  }
}

/** Balance minus totalDue(bills) minus amount(savings). May be NEGATIVE (that is the shortfall and must be shown, not hidden). */
export function safeToSpend(balance, bills, savings) {
  const bal = amount(balance);
  const due = totalDue(bills);
  const sav = amount(savings);
  return bal - due - sav;
}

/**
 * Safe divided by whole days, only when safe > 0 and days >= 1, else 0.
 * Days is floored. Never Infinity.
 */
export function perDay(safe, daysUntilPayday) {
  const days = Math.floor(daysUntilPayday);
  if (safe > 0 && days >= 1) {
    return safe / days;
  } else {
    return 0;
  }
}

/** The positive amount by which safe is below zero, else 0. */
export function shortfall(safe) {
  return Math.max(0, -safe);
}
