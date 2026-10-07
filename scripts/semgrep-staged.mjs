#!/usr/bin/env node
/*
 * The pre-commit SAST pass (ask 77cfda79): run Semgrep on the STAGED JS/TS files only.
 *
 *   node scripts/semgrep-staged.mjs [--repo <path>]          scan what is staged
 *   node scripts/semgrep-staged.mjs --files <a> <b> ...      scan these paths (tests use this)
 *
 * Exit 0 clean, 1 refuse (a finding), 2 could not check.
 *
 * RULES, both local, never fetched at commit time:
 *   1. .semgrep/treforged.yml - repo-owned. The OWASP pack's JS SQL rules only fire on
 *      Lambda event sources and knex, so it read a planted pool.query("..." + id) as clean.
 *   2. The p/owasp-top-ten pack, trimmed to its 71 JS/TS rules, pinned OUTSIDE the repo
 *      (Semgrep Rules License; this repo is public) and checked by sha256 below. A changed
 *      file is a refusal, not a silent upgrade. Refresh: see CLAUDE.md "Pre-commit SEMGREP".
 *
 * Semgrep itself is pinned at 1.179.0 in a private venv (~/.claude/tools/semgrep-venv), run
 * with --metrics=off and the version check disabled, so a commit sends nothing anywhere.
 *
 * It FAILS CLOSED: no semgrep or no rules is exit 2, which the hook treats as a refusal.
 * SEMGREP_SKIP=1 is the only way past it, and it says so loudly. `git commit --no-verify`
 * skips every hook; that is not fixable in a local hook.
 * A file Semgrep could not fully parse or timed out on is PRINTED as not fully scanned,
 * never counted as clean (useCardProjection.ts times out on the OWASP rules).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const OWASP_SHA256 = "b8e53d84216781b73de0ca4e514c6c610ee65c8eb6d5b2b470965b1ba95d569a";
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const args = process.argv.slice(2);
const ri = args.indexOf("--repo");
const repo = ri !== -1 ? args[ri + 1] : process.cwd();
const fi = args.indexOf("--files");
const explicit = fi !== -1 ? args.slice(fi + 1) : null;

function out(msg) { process.stderr.write(msg + "\n"); }
function cannot(msg) { out(`semgrep: COULD NOT CHECK - ${msg}`); process.exit(2); }

if (process.env.SEMGREP_SKIP === "1") {
  out("semgrep: SKIPPED by SEMGREP_SKIP=1. This commit was NOT scanned for injection/XSS.");
  process.exit(0);
}

function findSemgrep() {
  if (process.env.SEMGREP_BIN) return process.env.SEMGREP_BIN;
  const venv = join(homedir(), ".claude", "tools", "semgrep-venv");
  for (const p of [join(venv, "Scripts", "semgrep.exe"), join(venv, "bin", "semgrep")]) if (existsSync(p)) return p;
  return null;
}

const bin = findSemgrep();
if (!bin) cannot("semgrep not found. Install: python -m venv ~/.claude/tools/semgrep-venv && <venv>/Scripts/python -m pip install semgrep==1.179.0");
const localRules = join(repo, ".semgrep", "treforged.yml");
if (!existsSync(localRules)) cannot(`repo rules missing at ${localRules}`);
const owasp = process.env.SEMGREP_OWASP_RULES || join(homedir(), ".claude", "tools", "semgrep-rules", "owasp-top-ten.jsts.yml");
if (!existsSync(owasp)) cannot(`pinned OWASP rules missing at ${owasp} (see CLAUDE.md "Pre-commit SEMGREP")`);
const got = createHash("sha256").update(readFileSync(owasp)).digest("hex");
if (got !== OWASP_SHA256) cannot(`pinned OWASP rules changed (sha256 ${got.slice(0, 12)}, want ${OWASP_SHA256.slice(0, 12)}). Review, then update OWASP_SHA256.`);

let targets;
let staging = null;
if (explicit) {
  targets = explicit;
} else {
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter((f) => f && EXT.test(f));
  if (files.length === 0) process.exit(0);
  // Scan the STAGED blob, not the working tree: staged is what becomes permanent.
  staging = mkdtempSync(join(tmpdir(), "semgrep-staged-"));
  for (const f of files) {
    const dest = join(staging, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, execFileSync("git", ["-C", repo, "show", `:${f}`], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));
  }
  targets = files.map((f) => join(staging, f));
}

const res = spawnSync(bin, [
  "scan", "--config", localRules, "--config", owasp,
  "--metrics=off", "--disable-version-check", "--quiet", "--json", "--no-git-ignore", ...targets,
], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", SEMGREP_ENABLE_VERSION_CHECK: "0", SEMGREP_SEND_METRICS: "off" } });
if (staging) rmSync(staging, { recursive: true, force: true });
if (res.error) cannot(`could not run ${bin}: ${res.error.message}`);

let report;
try { report = JSON.parse(res.stdout); } catch { cannot(`semgrep exit ${res.status}, no JSON. ${String(res.stderr).slice(-400)}`); }

const rel = (p) => (staging ? p.replace(staging, "").replace(/^[\\/]/, "") : p);
for (const e of report.errors || []) {
  const p = e.path || (Array.isArray(e.spans) && e.spans[0]?.file) || "?";
  out(`semgrep: NOT FULLY SCANNED ${rel(String(p))} (${typeof e.type === "string" ? e.type : "parse"})`);
}
const results = report.results || [];
for (const r of results) {
  out(`semgrep: ${rel(r.path)}:${r.start.line} ${r.check_id.split(".").pop()} - ${String(r.extra?.message || "").split("\n")[0]}`);
}
out(`semgrep: examined ${targets.length} file(s), ${results.length} finding(s).`);
process.exit(results.length > 0 ? 1 : 0);
