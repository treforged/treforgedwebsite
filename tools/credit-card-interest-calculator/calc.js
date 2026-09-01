/**
 * calc.js — credit card interest and payoff arithmetic.
 *
 * This is the SAME arithmetic as the published /answers figures and the blog
 * article this tool sits beside, handed over by the marketing desk rather than
 * re-derived here. That matters: two independent derivations of the snowball
 * method disagreed today, and the only reason anyone noticed was that someone
 * re-ran it instead of copying the numbers. So the vectors in
 * calc.test.mjs are the contract, and this file may not change without them.
 *
 * No interest is invented and no return is assumed. Every number a reader sees
 * comes from these functions or is not shown at all.
 */
export const MAX_MONTHS = 1200;

export const dailyInterest = (balance, apr) => balance * (apr / 365);
export const interestOver = (balance, apr, days) => dailyInterest(balance, apr) * days;
export const monthlyInterest = (balance, apr) => balance * apr / 12;
export const minPayment = (balance, apr) => Math.max(25, 0.01 * balance + monthlyInterest(balance, apr));

/** How a single payment splits, before any of it touches the principal. */
export function splitPayment(balance, apr, payment) {
  const interest = monthlyInterest(balance, apr);
  return {
    interest,
    principal: payment - interest,
    coversInterest: payment > interest,
  };
}

/**
 * Run the balance down. mode 'minimum' pays the shrinking minimum; mode 'fixed'
 * pays a flat amount, never less than the minimum (paying under the minimum is
 * a delinquency, not a plan).
 */
export function payoff(balance, apr, { mode = 'minimum', fixedPayment = 0 } = {}) {
  let months = 0;
  let totalInterest = 0;
  let b = balance;

  while (b > 0.005 && months < MAX_MONTHS) {
    const i = b * apr / 12;
    const min = Math.max(25, 0.01 * b + i);
    let pay = mode === 'minimum' ? min : Math.max(fixedPayment, min);
    pay = Math.min(pay, b + i);
    b = b + i - pay;
    totalInterest += i;
    months++;
  }

  // A fixed payment below the monthly interest never clears the balance. Say so
  // rather than returning a number that looks like an answer.
  const neverEnds = months >= MAX_MONTHS && b > 0.005;
  return {
    months: neverEnds ? Infinity : months,
    totalInterest: neverEnds ? Infinity : totalInterest,
    neverEnds,
  };
}
