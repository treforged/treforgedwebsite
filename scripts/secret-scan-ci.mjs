#!/usr/bin/env node
/*
 * The CI half of the secret guard: scan what was PUSHED, on GitHub's runner.
 *
 *   node scripts/secret-scan-ci.mjs [--repo <path>] [--range <base>..<head>]
 *
 * WHY IT EXISTS (ask 21d5dd90, from Tre's security reel). The pre-commit hook
 * stops the accident on a machine where `core.hooksPath` is set - and nowhere
 * else. `git commit --no-verify`, a clone without the hook config, or a commit
 * made in the GitHub web editor all skip it. This runs on every push and pull
 * request, where none of those bypasses apply.
 *
 * TWO HALVES, using the SAME rules as the hook (scripts/secret-scan.mjs):
 *   - TREE: every tracked file at HEAD, contents and filename.
 *   - HISTORY (with --range): every blob added or modified in each pushed
 *     commit. This catches a key added in one commit and deleted in the next -
 *     the tree half alone would read that push as clean, and the key would still
 *     be public in history.
 *
 * WHAT IT DOES NOT STOP: by the time this runs the push has landed and the
 * commit is public. It turns a silent leak into a red run within a minute; it
 * cannot un-publish. Rotate first, then remove. Same rules as the hook, so the
 * same blind spots: unprefixed keys (Mistral) are caught by filename only.
 *
 * Exit 0 clean, 1 credential found, 2 could not check (never a pass).
 */

import { execFileSync } from "node:child_process";
import { scanContent, verdict } from "./secret-scan.mjs";

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const repo = argValue("--repo") ?? process.cwd();
const range = argValue("--range");
const RANGE_RE = /^[0-9A-Za-z._\/^~-]+\.\.[0-9A-Za-z._\/^~-]+$/;
const ZERO_SHA = "0".repeat(40);

function git(...a) {
  return execFileSync("git", ["-C", repo, ...a], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A listing that fails is "could not check", which refuses.
function gitList(...a) {
  try {
    return git(...a);
  } catch (err) {
    console.error(`secret-scan-ci: could not check - ${err.message}`);
    process.exit(2);
  }
}

// An unreadable blob is not proof of innocence, so the FILENAME is still scanned.
function readBlob(rev, path) {
  try {
    return git("show", `${rev}:${path}`);
  } catch {
    return "";
  }
}

const isBinary = (text) => text.slice(0, 8000).includes("\u0000");

function scanBlob(rev, path, label) {
  const raw = readBlob(rev, path);
  const text = isBinary(raw) ? "" : raw;
  const findings = scanContent(path, text).map((f) => ({ ...f, path: label }));
  return { path: label, findings };
}

function scanTree() {
  const paths = gitList("ls-files", "-z").split("\0").filter(Boolean);
  return paths.map((path) => scanBlob("HEAD", path, path));
}

function pushedCommits() {
  if (!RANGE_RE.test(range)) {
    console.error(`secret-scan-ci: refusing an unrecognised --range "${range}". Could not check.`);
    process.exit(2);
  }
  const [base, head] = range.split("..");
  // A new branch pushes with an all-zero base: read its own recent commits.
  const listing = base === ZERO_SHA
    ? gitList("rev-list", head, "--max-count=50")
    : gitList("rev-list", range);
  return listing.split("\n").map((s) => s.trim()).filter(Boolean);
}

function scanHistory(commits) {
  return commits.flatMap((sha) => {
    const files = gitList(
      "diff-tree", "--no-commit-id", "-r", "--name-only", "--diff-filter=ACMR", "-z", "--root", sha,
    ).split("\0").filter(Boolean);
    return files.map((path) => scanBlob(sha, path, `${path}@${sha.slice(0, 7)}`));
  });
}

const treeRows = scanTree();
const commits = range ? pushedCommits() : [];
const historyRows = scanHistory(commits);
const v = verdict([...treeRows, ...historyRows]);

console.log(
  `secret-scan-ci: examined ${treeRows.length} file(s) at HEAD and ${historyRows.length} blob(s) in ${commits.length} pushed commit(s).`,
);

if (v.exitCode === 2) {
  console.error("Nothing was examined, so nothing was proved. This is a refusal, not a pass.");
  process.exit(2);
}

if (v.findings.length) {
  console.error(`\nFOUND ${v.findings.length} credential-shaped item(s):\n`);
  for (const f of v.findings) {
    console.error(`  ${f.path}${f.line ? `:${f.line}` : ""}  [${f.kind}] ${f.why}`);
  }
  console.error("\nA credential pushed to this public repo is published at treforged.com within a minute.");
  console.error("Rotate it FIRST, then remove it. Deleting the file does not remove it from history.");
  process.exit(1);
}
console.log("secret-scan-ci: clean.");
