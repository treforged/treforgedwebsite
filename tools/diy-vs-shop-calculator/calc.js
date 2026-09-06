/**
 * calc.js - "should I do this job myself, or pay a shop?"
 *
 * WHY THERE ARE NO PRICES IN THIS FILE. 149 of 563 harvested car phrases (26%)
 * ask what a job costs - the largest intent cluster in the harvest and the one
 * nothing on this site served. The obvious build was a page listing what each
 * job costs. We do not have verified shop labour rates or part prices, and this
 * desk's standing rule is that a number a reader cannot check does not ship.
 * A quoted "$180 for a brake job" would be wrong in most of the country and
 * would look authoritative everywhere.
 *
 * So every figure here is the READER'S: their quote, their parts, their tools,
 * their hours. The tool does arithmetic on what they already know, which is
 * both honest and more useful - the answer depends on their quote, not on a
 * national average.
 *
 * Same rule as the calculators beside it: this module is imported by BOTH the
 * page and calc.test.mjs, so "the tool disagrees with itself" is structurally
 * unrepresentable rather than merely unlikely. Do not inline this math into the
 * page.
 *
 * Arithmetic is subtraction and division only - no loop, no compounding, no
 * convergence - so none of the payoff-math risk applies here.
 */

/** One place where a field becomes a number, so every function treats junk the same. */
const money = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

/**
 * Whole uses to spread a tool purchase over. A tool bought for one job costs
 * its full price against that job; the same tool over 5 jobs costs a fifth.
 * Anything junk means "just this once", which is the cautious reading.
 */
const uses = (v) => (typeof v === 'number' && isFinite(v) && v >= 1 ? Math.floor(v) : 1);

/**
 * What doing it yourself actually costs: parts, plus the share of any one-off
 * tool purchase attributable to this job.
 *
 * Amortising the tools is the difference between an honest answer and a
 * discouraging one. A $40 torque wrench charged wholly against one $60 job says
 * "not worth it" and is wrong the second time you use it.
 */
export function diyCost({ partsCost, toolsCost, toolUses } = {}) {
  return money(partsCost) + money(toolsCost) / uses(toolUses);
}

/**
 * Money kept by doing it yourself. CAN BE NEGATIVE, and that is a real answer
 * rather than an error: buying tools for a job you will do once genuinely can
 * cost more than the shop.
 */
export function savings(inputs = {}) {
  return money(inputs.shopQuote) - diyCost(inputs);
}

/**
 * What the reader is effectively paying themselves per hour.
 *
 * Returns null - never NaN, never Infinity - when there is no reading to give,
 * because a gauge showing 0 and a gauge that failed to compute look identical
 * to a reader. The page renders null as an em dash.
 */
export function effectiveHourly(inputs = {}) {
  const hours = money(inputs.hours);
  if (hours === 0) return null;
  if (money(inputs.shopQuote) === 0) return null;
  return savings(inputs) / hours;
}

/**
 * The verdict, and it deliberately refuses to answer more than it can.
 *
 * 'no-reading'    - not enough entered to say anything.
 * 'costs-more'    - DIY costs more than the quote. True regardless of time.
 * 'no-comparison' - the money works out, but they have not said what their time
 *                   is worth, so whether it is WORTH it is theirs to judge. We
 *                   report the hourly rate and stop.
 * 'worth-it' / 'not-worth-it' - compared against their own hourly figure.
 *
 * There is no "marginal" band. A threshold like "within 20%" would be our
 * judgement wearing the costume of a calculation.
 */
export function verdict(inputs = {}, valueOfTime) {
  const hourly = effectiveHourly(inputs);
  if (hourly === null) return 'no-reading';
  if (savings(inputs) <= 0) return 'costs-more';
  const rate = money(valueOfTime);
  if (rate === 0) return 'no-comparison';
  return hourly >= rate ? 'worth-it' : 'not-worth-it';
}

/**
 * How many times you would have to do this job before a tool purchase pays for
 * itself, ignoring your time. Returns null when it never does, or when there is
 * no tool to pay off.
 */
export function toolBreakEvenJobs({ shopQuote, partsCost, toolsCost } = {}) {
  const tools = money(toolsCost);
  if (tools === 0) return null;
  const perJob = money(shopQuote) - money(partsCost);
  if (perJob <= 0) return null;
  return Math.ceil(tools / perJob);
}
