/**
 * calc.js - debt snowball vs avalanche.
 *
 * The engine behind the published /answers figures and the article this tool
 * sits beside, handed over by the marketing desk rather than re-derived here.
 * It reproduces all six published numbers to the dollar, and calc.test.mjs
 * holds them as the contract.
 *
 * Two details carry the whole difference and both were got wrong once already:
 *
 *   1. Step 4 is a WHILE, not an if. When a card clears mid-month with budget
 *      left over, the rest must spill to the next card in the SAME month.
 *      Letting it evaporate is the difference between 36 months and 37.
 *   2. The minimum is 1% of the POST-interest balance, floored at $25. On the
 *      pre-interest balance snowball totals $4,582 instead of $4,581.
 *
 * Note stated on the page too: real issuers usually add the month's interest on
 * top of the 1%, which makes minimums larger and payoff slightly faster than
 * shown. This tool uses the method the published comparison used, so the two
 * cannot disagree.
 */
export const MAX_MONTHS = 1200;

const live = (c) => c.balance > 0.005;

/** Cheapest-first for avalanche is highest APR; for snowball it is smallest balance. */
function targetOrder(cards, mode) {
  return cards
    .filter(live)
    .slice()
    .sort((a, b) => (mode === 'avalanche' ? b.apr - a.apr : a.balance - b.balance));
}

/**
 * Run one strategy. cards is [{ name, balance, apr }] with apr as a decimal.
 * Returns months, total interest, and the month each card cleared.
 */
export function simulate(cards, budget, mode) {
  const cs = cards.map((c) => ({ ...c }));
  const clearedAt = {};
  let months = 0;
  let totalInterest = 0;

  while (months < MAX_MONTHS) {
    if (!cs.some(live)) break;
    months++;

    for (const c of cs) {
      if (!live(c)) continue;
      const i = c.balance * c.apr / 12;
      c.balance += i;
      totalInterest += i;
    }

    let budgetLeft = budget;
    for (const c of targetOrder(cs, mode)) {
      let min = Math.max(25, 0.01 * c.balance);
      min = Math.min(min, c.balance, budgetLeft);
      c.balance -= min;
      budgetLeft -= min;
    }

    // The spill. Money must not vanish when a card clears with budget to spare.
    while (budgetLeft > 0.005) {
      const order = targetOrder(cs, mode);
      if (!order.length) break;
      const t = order[0];
      const pay = Math.min(budgetLeft, t.balance);
      t.balance -= pay;
      budgetLeft -= pay;
    }

    for (const c of cs) {
      if (!live(c) && clearedAt[c.name] === undefined) clearedAt[c.name] = months;
    }
  }

  // A budget that cannot keep up never clears the debt. Say so rather than
  // returning a number that looks like an answer.
  const neverEnds = cs.some(live);
  const firstCleared = Object.keys(clearedAt).length
    ? Math.min(...Object.values(clearedAt))
    : null;

  return {
    months: neverEnds ? Infinity : months,
    totalInterest: neverEnds ? Infinity : totalInterest,
    firstCleared: neverEnds ? null : firstCleared,
    clearedAt,
    neverEnds,
  };
}

/** Both strategies plus what choosing avalanche costs or saves. */
export function compare(cards, budget) {
  const avalanche = simulate(cards, budget, 'avalanche');
  const snowball = simulate(cards, budget, 'snowball');
  const both = !avalanche.neverEnds && !snowball.neverEnds;
  return {
    avalanche,
    snowball,
    interestSaved: both ? snowball.totalInterest - avalanche.totalInterest : null,
    monthsSaved: both ? snowball.months - avalanche.months : null,
    firstWinSooner: both ? avalanche.firstCleared - snowball.firstCleared : null,
  };
}
