#!/usr/bin/env node
/**
 * The asset version must name the bytes a VISITOR receives, and it must be the
 * same number on every machine that computes it.
 *
 * It was neither. `core.autocrlf` is `input` here, so the Windows working tree
 * holds CRLF while git stores - and GitHub Pages serves - LF. version-assets
 * hashed the raw working-tree bytes, so styles.css had two versions for one
 * content: 8f6cff59 on a Windows desk, 337b86b3 in Linux CI. The stamp
 * flip-flopped between them, rewriting all 81 pages whenever it alternated, and
 * a Windows-produced stamp named a file that is served nowhere.
 *
 * The old comment in version-assets.mjs argued for hashing raw bytes so a
 * line-ending difference could not "silently change the version and rewrite all
 * 79 files for nothing". That is precisely what hashing raw bytes caused.
 *
 * Usage: node scripts/test-version-assets.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashBytes } from './version-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
let checks = 0;
const check = (ok, name, detail) => {
  checks++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (!ok && detail ? '  ->  ' + detail : ''));
  if (!ok) failed++;
};

// 1. The property that was broken: CRLF and LF of the SAME content hash alike.
const lf = Buffer.from('a {\n  color: red;\n}\n', 'binary');
const crlf = Buffer.from('a {\r\n  color: red;\r\n}\r\n', 'binary');
check(hashBytes(lf) === hashBytes(crlf),
  'the same content hashes the same with LF and with CRLF endings',
  hashBytes(lf) + ' vs ' + hashBytes(crlf));

// 2. It must still be a CONTENT hash - normalising must not make it blind.
const changed = Buffer.from('a {\n  color: blue;\n}\n', 'binary');
check(hashBytes(lf) !== hashBytes(changed),
  'a real content change still changes the version');

// 3. The number must equal what the SERVED bytes hash to. Git stores what
//    GitHub Pages serves, so the committed blob is the authority - not the
//    working tree, which is the copy that differed.
for (const asset of ['styles.css', 'main.js']) {
  const blob = execFileSync('git', ['show', `HEAD:${asset}`], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  const worktree = readFileSync(join(ROOT, asset));
  check(hashBytes(worktree) === hashBytes(blob),
    `${asset}: the working-tree version matches the committed (served) version`,
    `worktree ${hashBytes(worktree)} vs committed ${hashBytes(blob)} - a Windows CRLF divergence is back`);
}

// 4. And the pages must actually carry it, which is the whole point.
const home = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const asset of ['styles.css', 'main.js']) {
  const want = hashBytes(readFileSync(join(ROOT, asset)));
  check(home.includes(`/${asset}?v=${want}`),
    `index.html references ${asset}?v=${want}`,
    'run: node scripts/version-assets.mjs');
}

if (checks === 0) {
  console.log('FAIL - 0 checks ran');
  process.exit(1);
}
console.log(failed ? `\n${failed} of ${checks} check(s) FAILED` : `\nPASS - ${checks} checks`);
process.exit(failed ? 1 : 0);
