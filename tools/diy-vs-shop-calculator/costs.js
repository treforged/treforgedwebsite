/**
 * costs.js - national average SHOP quotes, for hinting one field of the
 * calculator. Sourced by Ruby (tre-forged-marketing), retrieved 2026-09-07,
 * evidence in docs/evidence/2026-09-07_per-job-cost-figures.md in that repo.
 *
 * THREE THINGS THAT TRAVEL WITH THESE NUMBERS OR THEY DO NOT SHIP.
 *
 * 1. THE DATE IS A RETRIEVAL DATE, NOT A PUBLICATION DATE. The source pages
 *    carry no "last updated"; the one timestamp visible reads 1 January 1970,
 *    a zero epoch, which is a broken placeholder rather than a date. So the
 *    page says "retrieved", never "published", and a reader checks it by
 *    opening the same URL.
 *
 * 2. `shopParts` IS WHAT A SHOP BILLS FOR PARTS, MARKUP INCLUDED. It is NOT
 *    what a DIYer pays at a counter, and it must never hint the calculator's
 *    parts field. Doing so would overstate the DIY cost and understate the
 *    saving - wrong in the direction that flatters the shop, on the one page
 *    whose entire argument is that it does not do that. A wiper blade is not
 *    $66 at a parts counter. It is kept here ONLY so the totals can be
 *    checked, and costs.test.mjs asserts that labour + parts reproduces the
 *    total, which a misread or invented figure could not pass.
 *
 * 3. THESE ARE AVERAGES ACROSS EVERY VEHICLE IN THE DATABASE, NOT TYPICALS.
 *    The battery row is the tell at $456-$493: plausible for an AGM in a
 *    European car, absurd for a Corolla. Wherever a figure is shown it is
 *    labelled "national average across all vehicles" - never "typical" - and
 *    the reader is told to replace it with their own quote.
 *
 * Retail DIY parts prices are NOT sourced. Nothing here may be presented as
 * what a reader pays for a part.
 */

export const SOURCE = {
  name: 'RepairPal estimator',
  retrieved: '2026-09-07',
  base: 'https://repairpal.com/estimator/',
};

/** low/high are the SHOP TOTAL. labour and parts are retained for the integrity check. */
export const JOBS = [
  { id: 'headlight-bulb',    label: 'Headlight bulb',    low: 181, high: 213, labour: [61, 90],   shopParts: [120, 123], slug: 'headlight-bulb-replacement-cost' },
  { id: 'wiper-blades',      label: 'Wiper blades',      low: 101, high: 123, labour: [34, 50],   shopParts: [66, 73],   slug: 'windshield-wiper-blade-replacement-cost' },
  { id: 'engine-air-filter', label: 'Engine air filter', low: 79,  high: 99,  labour: [38, 56],   shopParts: [41, 43],   slug: 'air-filter-replacement-cost' },
  { id: 'cabin-air-filter',  label: 'Cabin air filter',  low: 91,  high: 114, labour: [45, 66],   shopParts: [47, 48],   slug: 'cabin-air-filter-replacement-cost' },
  { id: 'brake-pads',        label: 'Brake pads',        low: 335, high: 394, labour: [122, 179], shopParts: [213, 215], slug: 'brake-pad-replacement-cost' },
  { id: 'oil-change',        label: 'Oil change',        low: 160, high: 188, labour: [58, 86],   shopParts: [101, 103], slug: 'oil-change-cost' },
  { id: 'battery',           label: 'Battery',           low: 456, high: 493, labour: [61, 90],   shopParts: [394, 403], slug: 'battery-replacement-cost' },
  { id: 'serpentine-belt',   label: 'Serpentine belt',   low: 154, high: 212, labour: [89, 130],  shopParts: [65, 82],   slug: 'serpentine-belt-replacement-cost' },
];

export const jobById = (id) => JOBS.find((j) => j.id === id) || null;

export const sourceUrl = (job) => SOURCE.base + job.slug;

/**
 * The single number to put in the shop-quote field. The midpoint of a range is
 * a starting point, not a measurement, so every surface that shows it also
 * shows the range it came from.
 */
export const midpoint = (job) => Math.round((job.low + job.high) / 2);
