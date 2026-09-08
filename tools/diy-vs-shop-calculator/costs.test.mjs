#!/usr/bin/env node
/**
 * The cost figures carry their own integrity check.
 *
 * These are the only numbers on this page that did not come from the reader, so
 * they are the only ones that can be wrong without anybody noticing. A typo in a
 * total looks exactly like a real figure.
 *
 * The check that catches one is the source's own arithmetic: labour + parts
 * reproduces the stated total in every row, within a dollar of rounding. A
 * misread or invented number cannot pass it. That is why shopParts is kept in
 * the data at all - it is never displayed, and must never hint the DIY parts
 * field, because it carries a shop's markup.
 *
 * Usage: node tools/diy-vs-shop-calculator/costs.test.mjs
 */
import { JOBS, SOURCE, jobById, sourceUrl, midpoint } from './costs.js';

let failed = 0;
let checks = 0;
const check = (ok, name, detail) => {
  checks++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (!ok && detail ? '  ->  ' + detail : ''));
  if (!ok) failed++;
};

check(JOBS.length === 8, `all eight jobs are present (${JOBS.length})`);

// The integrity check: the source's own split must reproduce its own total.
for (const j of JOBS) {
  const lo = j.labour[0] + j.shopParts[0];
  const hi = j.labour[1] + j.shopParts[1];
  const ok = Math.abs(lo - j.low) <= 1 && Math.abs(hi - j.high) <= 1;
  check(ok, `${j.label}: labour + parts reproduces the $${j.low}-$${j.high} total`,
    `got $${lo}-$${hi}, which means a figure was mistyped`);
}

// Ranges must be the right way round, and positive.
for (const j of JOBS) {
  check(j.low > 0 && j.high >= j.low, `${j.label}: range is positive and ordered`, `${j.low}-${j.high}`);
}

// The midpoint is what lands in the field, so it must sit inside its own range.
for (const j of JOBS) {
  const m = midpoint(j);
  check(m >= j.low && m <= j.high, `${j.label}: midpoint $${m} lies within its range`);
}

// The citation has to be checkable by a reader, which means a real URL per job
// and a RETRIEVAL date - the source publishes none.
check(/^\d{4}-\d{2}-\d{2}$/.test(SOURCE.retrieved), `source carries a retrieval date (${SOURCE.retrieved})`);
for (const j of JOBS) {
  check(sourceUrl(j).startsWith('https://') && sourceUrl(j).endsWith(j.slug),
    `${j.label}: has its own citable source URL`);
}

check(jobById('brake-pads') !== null, 'jobById finds a real job');
check(jobById('no-such-job') === null, 'jobById returns null for an unknown id, not undefined-shaped junk');

if (checks === 0) { console.log('FAIL - 0 checks ran'); process.exit(1); }
console.log(failed ? `\n${failed} of ${checks} check(s) FAILED` : `\nPASS - ${checks} checks`);
process.exit(failed ? 1 : 0);
