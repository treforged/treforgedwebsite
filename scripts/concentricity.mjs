#!/usr/bin/env node
/**
 * concentricity.mjs - the SOURCE half of the corner-concentricity check.
 *
 * THE RULE (~/.claude/rules/common/corner-concentricity.md): when a rounded
 * element sits inside another rounded element, the inner radius must equal the
 * outer radius minus the gap between their edges -
 *
 *     r_inner = r_outer - gap        ONLY WHEN gap < r_outer
 *
 * The scoping clause is the important half. When the gap is LARGER than the
 * outer radius the child's corner sits entirely clear of the parent's curve,
 * the two arcs never share space, and the formula is degenerate rather than
 * demanding. Applied literally next door in getforgenta it flagged 17 sites of
 * which only 10 were real, and squaring every button in a padded card would
 * have been a visual rewrite justified by arithmetic that does not bind.
 *
 * WHY THIS GATE ASSERTS WHAT IT DOES. A browser sweep of 12 pages of this site
 * on 2026-09-14 measured 110 nested rounded pairs and 440 corners, and found
 * ZERO corners where the two arcs interacted at all - so zero violations, and
 * not because the radii were tuned. It is because EVERY padded container in
 * this stylesheet has a padding larger than its own radius, which puts every
 * child's corner outside every parent's curve. That is the condition this gate
 * protects. If somebody raises a radius token or tightens a card's padding past
 * it, the rule starts binding on this site for the first time, and this gate
 * goes red and says so.
 *
 * WHAT IT IS NOT. It does NOT measure rendered geometry and it cannot: a gap is
 * a fact about computed layout and needs a real browser. Run
 * `scripts/concentricity-probe.js` in one for that. Declaring a source proxy as
 * if it were the measurement is how the next recurrence gets through a green
 * gate, so this file says which it is, and `--limits` prints the rest.
 *
 * Exit: 0 pass, 1 findings, 2 examined nothing / unreadable stylesheet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LIMITS = [
  'rendered geometry - every number here comes from the stylesheet text, not from a laid-out box',
  'a gap that comes from anything but the parent rule\'s own padding (a margin on the child, a border width, an absolute inset)',
  'inline style="" attributes, and any style a page sets from JavaScript',
  'a <style> block inside an individual page - only styles.css is read',
  'a rounded child whose own rule declares no padding, which is most buttons',
  'a leaf form control - its padding holds text, so no corner arithmetic applies and it is counted, not judged',
  'whether a radius or a padding is the RIGHT value aesthetically - only whether the arcs can interact',
];

const lengths = (value) =>
  String(value)
    .replace(/!important/g, ' ')
    .trim()
    .split(/\s+/)
    .map(parseFloat)
    .filter(Number.isFinite);

// A LEAF control's padding separates its border from TEXT, never from a rounded
// child box, so `padding > radius` is not a fact about corner arcs there. The
// first run of this gate reported two <input> rules as FAIL for exactly that
// reason - cry wolf, and a gate that is wrong on ordinary work is one somebody
// switches off on the day it matters. These are NOT excluded silently: they are
// counted and printed as `n/a leaf`, so the reader sees the number.
// The list is HTML's own set of replaced / text-holding controls, not a
// project-specific allowlist that grows one exception at a time.
const LEAF = /(^|[ >+~,(])(input|textarea|select|option|button|progress|meter|img|video|audio|iframe|hr)([ >+~,.:[)]|$)/i;

const DECL = {
  'border-radius': /(?:^|[;{])\s*border-radius\s*:\s*([^;}]+)/,
  padding: /(?:^|[;{])\s*padding\s*:\s*([^;}]+)/,
};

// The body is matched with a literal regex per property. Building one with
// `new RegExp('...\s...')` is how the first draft of this file read 0 rules out
// of 220 blocks and exited 2: a lost backslash turns `\s` into the letter `s`
// inside a character class, the match never fires, and NOTHING SAYS SO. The
// exit-2-on-zero rule below is what turned that silent nothing into a failure.
const declaration = (body, prop) => {
  const m = body.match(DECL[prop]);
  return m ? m[1] : null;
};

const rootTokens = (css) => {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  const out = {};
  if (!block) return out;
  for (const piece of block[1].split(';')) {
    const i = piece.indexOf(':');
    if (i < 0) continue;
    const key = piece.slice(0, i).trim();
    if (!key.startsWith('--')) continue;
    out[key] = piece.slice(i + 1).trim();
  }
  return out;
};

const resolve = (value, tokens) =>
  value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name) =>
    Object.hasOwn(tokens, name) ? tokens[name] : whole);

function run() {
  if (process.argv.includes('--limits')) {
    console.log('scripts/concentricity.mjs does NOT catch:');
    for (const l of LIMITS) console.log('  - ' + l);
    console.log('\nFor any of those, run scripts/concentricity-probe.js in a real browser.');
    process.exit(0);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let css;
  try {
    css = readFileSync(join(root, 'styles.css'), 'utf8');
  } catch (err) {
    console.error('FAIL  styles.css could not be read: ' + err.message);
    process.exit(2);
  }

  const tokens = rootTokens(css);
  let withRadius = 0, pills = 0, unparseable = 0;
  const rows = [], findings = [];

  for (const [, selRaw, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const rawRadius = declaration(body, 'border-radius');
    if (rawRadius === null) continue;
    withRadius++;

    const selector = selRaw.trim().split('\n').pop().trim();
    const radii = lengths(resolve(rawRadius, tokens));
    if (radii.length === 0) { unparseable++; continue; }
    const radius = Math.max(...radii);
    if (radius >= 100) { pills++; continue; }

    const rawPadding = declaration(body, 'padding');
    if (rawPadding === null) continue;
    if (/%|\bvar\(|\bem\b|\brem\b/.test(rawPadding)) { unparseable++; continue; }
    const pads = lengths(rawPadding);
    if (pads.length === 0) { unparseable++; continue; }
    const padding = Math.min(...pads);

    if (LEAF.test(selector)) {
      rows.push({ selector, radius, padding, leaf: true });
      continue;
    }
    const ok = padding > radius;
    rows.push({ selector, radius, padding, ok });
    if (!ok) findings.push({ selector, radius, padding });
  }

  const leaves = rows.filter((r) => r.leaf).length;
  const judged = rows.length - leaves;
  const w = Math.min(52, Math.max(20, ...rows.map((r) => r.selector.length)));
  for (const r of rows) {
    console.log(
      '  ' + r.selector.slice(0, w).padEnd(w) +
      '  r=' + String(r.radius).padStart(4) + 'px' +
      '  min-pad=' + String(r.padding).padStart(4) + 'px' +
      '  ' + (r.leaf
        ? 'n/a leaf   (padding separates border from text, not from a rounded child)'
        : r.ok
          ? 'ok'
          : 'FAIL  the arcs now interact - a rounded child here needs r_inner = ' +
            Math.max(0, r.radius - r.padding) + 'px derived, not ' + r.radius + 'px'));
  }

  console.log('');
  console.log('rules with a radius:        ' + withRadius);
  console.log('of those, pill (skipped):   ' + pills);
  console.log('of those, unparseable:      ' + unparseable);
  console.log('of those, leaf controls:     ' + leaves + '   (counted, not judged - see the note in this file)');
  console.log('of those, containers judged: ' + judged + '   <- the number actually judged');
  console.log('findings:                   ' + findings.length);

  if (findings.length > 0) {
    console.error('\nFAIL - ' + findings.length + ' rule(s) where a padding no longer clears its own radius.');
    for (const f of findings) {
      console.error('  ' + f.selector + ': radius ' + f.radius + 'px, min padding ' + f.padding +
        'px. Corner arithmetic now BINDS for anything nested here - derive the child radius ' +
        '(max(0px, calc(' + f.radius + 'px - <gap>))) and re-run scripts/concentricity-probe.js in a browser.');
    }
    process.exit(1);
  }

  if (judged === 0) {
    console.error('\nEXAMINED NOTHING - no rule declared both a radius and a px padding. ' +
      'A broken parse and a clean stylesheet must not look the same.');
    process.exit(2);
  }

  console.log('\nPASS - every padded rounded container clears its own radius, so no ' +
    'corner arcs interact. This is the SOURCE proxy; run --limits for what it cannot see.');
  process.exit(0);
}

run();
