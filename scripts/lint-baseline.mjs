#!/usr/bin/env node
/**
 * lint-baseline.mjs - run the linter and REPORT it, rather than gate on it.
 *
 * WHY THIS EXISTS, AND WHY IT DOES NOT GO RED ON WARNINGS.
 * This repo carried 35 JavaScript/TypeScript files and no linter at all until
 * 2026-09-08. A rule that is off - or a linter that is absent - produces
 * SILENCE, not an error, so nothing anywhere reports it: it is not a failure,
 * not a warning, not a skipped test. That is why enablement gets audited and
 * not only results. (getforgenta had no-unused-vars set to `off`; turning it to
 * `warn` surfaced 129 dead declarations, one of them a nine-deep chain
 * recomputing on every render since August for a tile deleted in the meantime.)
 *
 * The first run of a linter over never-linted code finds a backlog. Turning
 * that into a red gate would make every legitimate commit fail, and a gate
 * that is wrong on ordinary work is a gate somebody bypasses on the day it
 * would have caught something. So: every rule is `warn` in eslint.config.mjs,
 * and this reports the count. Sweeping the backlog is a separate pass.
 *
 * IT REFUSES TO BE VACUOUSLY GREEN. It counts the JS/TS files git actually
 * tracks, counts the ones the linter actually examined, prints the difference
 * WITH the reason, and exits 2 - not 0 - when it examined nothing. A config
 * whose globs quietly matched no files cannot read as a clean repo.
 *
 * Usage:
 *   node scripts/lint-baseline.mjs                 report the baseline
 *   node scripts/lint-baseline.mjs --max-warnings=N  fail above N (a ratchet,
 *                                                    once a count is at zero)
 *
 * Exit codes: 0 reported (or within --max-warnings)
 *             1 lint ERRORS, or over --max-warnings
 *             2 could not examine anything / config is not doing its job
 */

import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files deliberately outside the linter's reach, each with the reason said out loud. */
const EXCLUDED = [
  {
    match: (f) => f.startsWith('supabase/functions/'),
    why: 'Deno TypeScript - needs a TypeScript parser and Deno globals, neither installed',
  },
];

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.split('=')[1];
};

const maxWarnings = arg('max-warnings', null);

function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs', '*.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const tracked = trackedSourceFiles();
if (tracked.length === 0) {
  console.error('FAIL(2) - git tracks no .js/.mjs/.cjs/.ts files here. That is not a clean repo, that is a broken lookup.');
  process.exit(2);
}

// ESLint THROWS rather than returning an empty list when its config ignores
// everything ("All files matched by '.' are ignored"). Letting that escape
// would exit 1 with a stack trace - the code that means "I looked and it is
// broken" - for a situation that is squarely "I could not look". Those must
// never share an exit code, so this converts it.
let results;
try {
  const eslint = new ESLint({ cwd: ROOT });
  results = await eslint.lintFiles(['.']);
} catch (err) {
  console.error('FAIL(2) - the linter could not examine anything. Its config is not doing its job.');
  console.error(`  ${err && err.message ? err.message.split('\n')[0] : err}`);
  process.exit(2);
}

const linted = new Set(
  results.map((r) => path.relative(ROOT, r.filePath).split(path.sep).join('/')),
);

let warnings = 0;
let errors = 0;
const byRule = new Map();
const byFile = [];

for (const r of results) {
  warnings += r.warningCount;
  errors += r.errorCount;
  if (r.messages.length) {
    byFile.push([path.relative(ROOT, r.filePath).split(path.sep).join('/'), r.messages.length]);
  }
  for (const m of r.messages) {
    // A null ruleId is NOT necessarily a parse error - an unused
    // `eslint-disable` directive reports with no rule id too. Do not label it
    // as something more alarming than it is.
    const id = m.ruleId || '(no rule id: directive or parse error)';
    byRule.set(id, (byRule.get(id) || 0) + 1);
  }
}

const notLinted = tracked.filter((f) => !linted.has(f));

console.log('== baseline ==');
console.log(`files linted:       ${linted.size}`);
console.log(`warnings:           ${warnings}`);
console.log(`errors:             ${errors}`);

if (byRule.size) {
  console.log('\n== by rule ==');
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${rule}`);
  }
}

if (byFile.length) {
  console.log('\n== by file ==');
  for (const [file, n] of byFile.sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${file}`);
  }
}

console.log('\n== coverage, and what is NOT covered ==');
console.log(`tracked .js/.mjs/.cjs/.ts files: ${tracked.length}`);
console.log(`examined by the linter:          ${linted.size}`);
if (notLinted.length === 0) {
  console.log('nothing tracked is unlinted.');
} else {
  for (const f of notLinted) {
    const rule = EXCLUDED.find((e) => e.match(f));
    console.log(`  NOT LINTED  ${f}  <- ${rule ? rule.why : 'NO RECORDED REASON - this is a gap, not a decision'}`);
  }
}

const unexplained = notLinted.filter((f) => !EXCLUDED.some((e) => e.match(f)));

if (linted.size === 0) {
  console.error('\nFAIL(2) - the linter examined zero files. Its globs match nothing; that cannot read as a pass.');
  process.exit(2);
}
if (unexplained.length) {
  console.error(`\nFAIL(2) - ${unexplained.length} tracked file(s) fall outside the linter with no recorded reason. Either lint them or record why not.`);
  process.exit(2);
}
if (errors > 0) {
  console.error(`\nFAIL(1) - ${errors} lint ERROR(s). Every rule here is deliberately 'warn', so an error means a parse failure or a config fault, not style.`);
  process.exit(1);
}
if (maxWarnings !== null && warnings > Number(maxWarnings)) {
  console.error(`\nFAIL(1) - ${warnings} warnings, over the --max-warnings=${maxWarnings} ratchet.`);
  process.exit(1);
}

console.log(`\nREPORTED - ${warnings} warning(s) across ${linted.size} file(s). Non-blocking by design: sweeping them is a separate pass.`);
