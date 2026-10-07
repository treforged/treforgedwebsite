#!/usr/bin/env node
/**
 * Proves the Semgrep pre-commit pass (scripts/semgrep-staged.mjs, ask 466f7b7f)
 * can FAIL, on both repo rules, and stays quiet on safe code.
 *
 * Planted files are written at runtime into a temp dir, so this file carries no
 * pattern the scanner would refuse when it is itself committed.
 *
 * Usage: node scripts/semgrep-staged.test.mjs   (exit 0 pass, 1 fail)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scripts', 'semgrep-staged.mjs');
let checks = 0;
let failed = 0;
function check(ok, label, detail) {
  checks += 1;
  if (ok) console.log('ok   ' + label);
  else { failed += 1; console.log('FAIL ' + label + (detail ? '  ->  ' + detail : '')); }
}
const run = (files, env) => spawnSync(process.execPath, [SCAN, '--repo', ROOT, '--files', ...files],
  { encoding: 'utf8', env: { ...process.env, ...env } });

const dir = mkdtempSync(join(tmpdir(), 'semgrep-test-'));
try {
  const put = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const sql = put('sql.mjs', 'export function f(pool, id) { return pool.query("select * from t where id = " + id); }\n');
  const dom = put('dom.js', 'function g(el, name) { el.' + 'innerHTML = "<b>" + name + "</b>"; }\n');
  const clean = put('clean.js',
    'export function h(pool, id) { return pool.query("select * from t where id = $1", [id]); }\n' +
    'function s(el, n) { el.textContent = n; el.' + 'innerHTML = "<b>static</b>" + "<i>also static</i>"; }\n');

  let r = run([sql]);
  check(r.status === 1 && /raw-sql-concatenation/.test(r.stderr), 'planted SQL concatenation is refused (exit 1)', r.status + ' ' + r.stderr.slice(-200));
  r = run([dom]);
  check(r.status === 1 && /dom-html-sink-non-literal/.test(r.stderr), 'planted innerHTML from a variable is refused (exit 1)', r.status + ' ' + r.stderr.slice(-200));
  r = run([clean]);
  check(r.status === 0, 'parameterised query, textContent and a literal innerHTML pass (exit 0)', r.status + ' ' + r.stderr.slice(-200));
  r = run([clean], { SEMGREP_BIN: join(dir, 'no-such-semgrep.exe') });
  check(r.status === 2, 'a missing semgrep is COULD NOT CHECK (exit 2), never clean', String(r.status));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} checks, ${failed} failed`);
if (checks === 0) process.exit(2);
process.exit(failed ? 1 : 0);
