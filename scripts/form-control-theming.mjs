// form-control-theming.mjs — the gate for
// ~/.claude/rules/common/form-control-theming.md
//
// A native <select>/<input>/<textarea> with no explicit styling renders in the
// browser's DEFAULT LIGHT CHROME — a white box punched into a dark panel. And
// the OPEN dropdown list is drawn by the operating system, so no background on
// the <select> reaches it: `color-scheme` is the only lever over the popup,
// the scrollbars, the number spinners and the date pickers.
//
// The instrument is a SOURCE SCAN, chosen deliberately. A rendered/computed
// style check needs a real browser; jsdom returns '' for class-driven styles
// and all-zero geometry, so a computed-style gate there is green against every
// defect it exists to catch.
//
// WHAT THIS DOES NOT CATCH is listed at the bottom of this file and printed by
// --limits. Read it before trusting a PASS.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), "..");
const EXCLUDE_DIRS = new Set(["node_modules", "backups", ".git"]);
const CONTROL_TAGS = new Set(["select", "input", "textarea"]);

const LIMITS = [
  "contrast ratios — a themed class whose own colours are illegible passes",
  "spacing, size and corner radius (see corner-concentricity.md for those)",
  "controls built at runtime by JavaScript — only source markup is scanned",
  "anything inside a third-party embed or iframe",
  "whether color-scheme's VALUE suits the theme; only that it is declared",
  "selector shapes outside the supported set — those are counted and reported,",
  "  never silently treated as a match",
  "ALIGNMENT GEOMETRY. The alignment check asserts the MECHANISM is declared,",
  "  not that controls actually line up — that needs a real browser. It was",
  "  measured in Chrome on 2026-09-12: 22.6px out of line before, 0.00px after,",
  "  across all four calculators (27 controls, 8 rows).",
];

// ── CSS ────────────────────────────────────────────────────────────
// Scanner rather than a regex: @media blocks nest, and a non-greedy `}` match
// ends at the first inner brace.
function parseCss(src) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  walk(css);
  return rules;

  function walk(text) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open === -1) break;
      const prelude = text.slice(i, open).trim();
      const close = matchingBrace(text, open);
      if (close === -1) break;
      const body = text.slice(open + 1, close);
      if (prelude.startsWith("@")) {
        // at-rule with a block: @media, @supports. Its inner rules count.
        if (/^@(media|supports|layer|container)/i.test(prelude)) walk(body);
      } else if (prelude) {
        rules.push({
          selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean),
          decls: parseDecls(body),
        });
      }
      i = close + 1;
    }
  }
}

function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function parseDecls(body) {
  const decls = {};
  for (const chunk of body.split(";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    // A nested block's leftovers have no property name we care about.
    if (prop && !prop.includes("{") && !prop.includes("}")) decls[prop] = value;
  }
  return decls;
}

// A rule is THEMED when it states both a background and a colour. That pairing
// is what stops the browser falling back to its own light chrome.
function isThemed(rule) {
  const d = rule.decls;
  return ("background" in d || "background-color" in d) && "color" in d;
}

// Checkbox, radio and range are the exception: a background and a colour break
// their rendering, and `accent-color` is the property that actually themes
// them. Requiring background+color of them would force a change that makes the
// control worse — a gate that is wrong on ordinary work is one somebody
// switches off on the day it matters.
const ACCENT_TYPES = new Set(["checkbox", "radio", "range"]);
function isAccentThemed(rule) {
  return "accent-color" in rule.decls;
}
function coveringRules(ctrl) {
  return ACCENT_TYPES.has(ctrl.type) ? accentRules : themedRules;
}

// ── selector matching ──────────────────────────────────────────────
// Deliberately narrow. Every shape this cannot decide is reported UNSUPPORTED
// and counted — never treated as a match, and never treated as a miss.
const COMPOUND = /^([a-z]+)?((?:[.#][\w-]+)*)(\[type=["']?([\w-]+)["']?\])?$/i;

// A selector carrying a STATE pseudo-class — :disabled, :focus, :hover,
// :-webkit-autofill, ::placeholder — styles a state, never the resting look.
// Counting one as base coverage is how a gate goes inert: strip `:disabled`
// off `input:disabled` and you get `input`, which matches every field on the
// site, and the untheme check can then never fail. Measured 2026-09-12 — a
// planted bare <input type="checkbox"> passed until this was fixed.
// `:not(...)` is the exception: it narrows a base rule rather than naming a
// state, so it is parsed and honoured instead of stripped.
function splitNot(part) {
  const nots = [];
  const bare = part.replace(/:not\(([^)]*)\)/gi, (_, inner) => {
    nots.push(inner.trim());
    return "";
  });
  return { bare, nots };
}

function parseCompound(part) {
  const { bare, nots } = splitNot(part);
  if (/::?[\w-]/.test(bare)) return "state"; // any pseudo that is not :not()
  const trimmed = bare.trim();
  if (!trimmed) return null;
  const m = trimmed.match(COMPOUND);
  if (!m) return null;
  const classes = [];
  let id = null;
  for (const tok of m[2].match(/[.#][\w-]+/g) || []) {
    if (tok[0] === ".") classes.push(tok.slice(1));
    else id = tok.slice(1);
  }
  const excludedTypes = [];
  const excludedClasses = [];
  for (const n of nots) {
    const t = n.match(/^\[type=["']?([\w-]+)["']?\]$/i);
    if (t) excludedTypes.push(t[1].toLowerCase());
    else if (/^\.[\w-]+$/.test(n)) excludedClasses.push(n.slice(1));
    else return null; // a :not() shape this cannot evaluate
  }
  return {
    tag: m[1] ? m[1].toLowerCase() : null,
    classes,
    id,
    type: m[4] || null,
    excludedTypes,
    excludedClasses,
  };
}

function compoundMatchesControl(c, ctrl) {
  if (c.tag && c.tag !== ctrl.tag) return false;
  if (c.id && c.id !== ctrl.id) return false;
  if (c.type && c.type !== ctrl.type) return false;
  if (ctrl.type && c.excludedTypes.includes(ctrl.type)) return false;
  if (c.excludedClasses.some((cl) => ctrl.classes.includes(cl))) return false;
  return c.classes.every((cl) => ctrl.classes.includes(cl));
}

function compoundMatchesAncestor(c, ctrl) {
  // The only ancestor context this scan tracks is the enclosing <form>.
  if (c.tag && c.tag !== "form") return false;
  if (c.id && c.id !== ctrl.formId) return false;
  if (c.type) return false;
  if (c.excludedClasses.some((cl) => ctrl.formClasses.includes(cl))) return false;
  return c.classes.every((cl) => ctrl.formClasses.includes(cl));
}

// → true | false | "state" | "unsupported"
function selectorMatches(selector, ctrl) {
  if (/[>+~]/.test(selector)) return "unsupported";
  const parts = selector.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return "unsupported";
  const target = parseCompound(parts[parts.length - 1]);
  if (target === "state") return "state";
  if (!target) return "unsupported";
  // A selector naming no tag and no class/id is not a control selector.
  if (!target.tag && target.classes.length === 0 && !target.id) return "unsupported";
  if (!compoundMatchesControl(target, ctrl)) return false;
  if (parts.length === 1) return true;
  const ancestor = parseCompound(parts[0]);
  if (ancestor === "state") return "state";
  if (!ancestor) return "unsupported";
  return compoundMatchesAncestor(ancestor, ctrl);
}

// ── source scan ────────────────────────────────────────────────────
function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) listFiles(full, out);
    } else if (e.name.endsWith(".html")) {
      out.push(full);
    } else if (
      e.name.endsWith(".mjs") &&
      path.dirname(full) === path.join(REPO, "scripts") &&
      full !== SELF
    ) {
      // scripts/ emits page HTML from template literals, so it carries markup.
      // Not tools/*/page.test.mjs, whose regex strings contain "<input" as data.
      // And not this file, which names the tags it hunts for in prose and in a
      // regex — a gate that matches the file quoting the thing it looks for
      // reports six findings about itself and buries the one that is real.
      out.push(full);
    }
  }
  return out;
}

function attr(tagText, name) {
  const m = tagText.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

function hasBareAttr(tagText, name) {
  return new RegExp(`\\s${name}(\\s|=|>|$)`, "i").test(tagText);
}

function enclosingForm(text, index) {
  const before = text.slice(0, index);
  const open = before.lastIndexOf("<form");
  if (open === -1) return { classes: [], id: null };
  if (before.slice(open).includes("</form>")) return { classes: [], id: null };
  const end = text.indexOf(">", open);
  const tagText = text.slice(open, end === -1 ? index : end + 1);
  return {
    classes: (attr(tagText, "class") || "").split(/\s+/).filter(Boolean),
    id: attr(tagText, "id"),
  };
}

function skipReason(tagText, classes) {
  if (classes.includes("nl-hp")) return "honeypot (.nl-hp)";
  if (hasBareAttr(tagText, "hidden")) return "hidden attribute";
  if (attr(tagText, "aria-hidden") === "true" && attr(tagText, "tabindex") === "-1")
    return "aria-hidden + tabindex=-1";
  return null;
}

function findControls(file, text) {
  const found = [];
  const re = /<(select|input|textarea)(\s[^>]*)?>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    if (!CONTROL_TAGS.has(tag)) continue;
    const tagText = m[0];
    const classes = (attr(tagText, "class") || "").split(/\s+/).filter(Boolean);
    const form = enclosingForm(text, m.index);
    found.push({
      file,
      line: text.slice(0, m.index).split("\n").length,
      tag,
      type: tag === "input" ? (attr(tagText, "type") || "text").toLowerCase() : null,
      classes,
      id: attr(tagText, "id"),
      formClasses: form.classes,
      formId: form.id,
      skip: skipReason(tagText, classes),
    });
  }
  return found;
}

// ── stylesheet-level facts ─────────────────────────────────────────
function stylesheetFindings(rules) {
  const out = [];
  const decl = (prop) => rules.some((r) => prop in r.decls);
  const anySelector = (needle) =>
    rules.some((r) => r.selectors.some((s) => s.includes(needle)));

  if (!decl("color-scheme"))
    out.push(
      "color-scheme is not declared anywhere in styles.css — the OS-drawn " +
        "dropdown list, scrollbars, number spinners and date pickers will " +
        "render in the browser's light palette no matter what the CSS says",
    );

  const selectAppearance = rules.some(
    (r) =>
      r.selectors.some((s) => /\bselect\b/.test(s)) &&
      ["appearance", "-webkit-appearance"].some(
        (p) => (r.decls[p] || "").trim().toLowerCase() === "none",
      ),
  );
  if (!selectAppearance)
    out.push("no rule matching a <select> sets appearance:none — it keeps the platform look");

  if (!anySelector("-webkit-autofill"))
    out.push("no -webkit-autofill rule — Chrome/WebKit repaint autofilled fields in their own colours");
  if (!anySelector("::placeholder"))
    out.push("no ::placeholder rule — the default grey is tuned for a white field");
  if (!anySelector(":disabled"))
    out.push("no :disabled rule — the browser default is usually invisible on dark");

  // ENTRY BOXES LINE UP — Tre, 2026-09-12: "entry boxes should be lined up
  // always no matter what context."
  // In a multi-column grid of <label> fields, a caption that wraps to two
  // lines pushes its own control down and it stops lining up with the field
  // beside it. Measured on .calc-form: 22.6px out of line, in both rows.
  // The mechanism is row subgrid (or bottom-packing as a fallback). This
  // asserts the mechanism is DECLARED — geometry itself needs a browser, so
  // this is a proxy and is listed as such under --limits.
  const gridContainers = rules
    .filter((r) => (r.decls.display || "").trim() === "grid")
    .flatMap((r) => r.selectors);
  for (const r of rules) {
    for (const sel of r.selectors) {
      const m = sel.match(/^(\S+)\s+label$/);
      if (!m || !gridContainers.includes(m[1])) continue;
      const aligned =
        (r.decls["grid-template-rows"] || "").includes("subgrid") ||
        "justify-content" in r.decls ||
        (r.decls["align-self"] || "").trim() === "end";
      if (!aligned)
        out.push(
          `\`${sel}\` is a field in a grid but declares no row alignment ` +
            "(grid-template-rows: subgrid, justify-content, or align-self: end) — " +
            "a caption that wraps to two lines will push its control out of line " +
            "with the field beside it",
        );
    }
  }

  for (const r of rules) {
    const o = (r.decls.outline || "").trim().toLowerCase();
    if (o !== "none" && o !== "0" && o !== "0px") continue;
    if ("box-shadow" in r.decls || "border-color" in r.decls || "outline-color" in r.decls) continue;
    out.push(
      `\`${r.selectors.join(", ")}\` removes the focus outline without replacing it ` +
        "(no box-shadow, border-color or outline-color) — an accessibility regression",
    );
  }
  return out;
}

// ── run ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--limits")) {
  console.log("form-control-theming does NOT catch:");
  for (const l of LIMITS) console.log(`  - ${l}`);
  process.exit(0);
}

let css;
try {
  css = fs.readFileSync(path.join(REPO, "styles.css"), "utf8");
} catch (err) {
  console.error(`ERROR: cannot read styles.css — ${err.message}`);
  process.exit(2);
}

const rules = parseCss(css);
const themedRules = rules.filter(isThemed);
const accentRules = rules.filter(isAccentThemed);
const files = listFiles(REPO);
if (files.length === 0) {
  console.error("ERROR: examined nothing — no source files found");
  process.exit(2);
}

const findings = stylesheetFindings(rules).map((message) => ({ kind: "STYLESHEET", message }));
let examined = 0;
let skipped = 0;
const unsupported = new Set();
let stateSelectors = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const ctrl of findControls(file, text)) {
    if (ctrl.skip) {
      skipped++;
      continue;
    }
    examined++;
    let matched = false;
    for (const rule of coveringRules(ctrl)) {
      for (const selector of rule.selectors) {
        const verdict = selectorMatches(selector, ctrl);
        if (verdict === "unsupported") unsupported.add(selector);
        else if (verdict === "state") stateSelectors++;
        else if (verdict === true) matched = true;
      }
      if (matched) break;
    }
    if (!matched) {
      const need = ACCENT_TYPES.has(ctrl.type) ? "accent-color" : "a background and a colour";
      const what = ctrl.tag === "input" ? `<input type="${ctrl.type}">` : `<${ctrl.tag}>`;
      findings.push({
        kind: "UNTHEMED",
        file: path.relative(REPO, ctrl.file).replace(/\\/g, "/"),
        line: ctrl.line,
        message: `${what} is matched by no rule setting ${need} — it renders in the browser's own light chrome`,
      });
    }
  }
}

if (examined === 0) {
  console.error("ERROR: examined nothing — no form controls found in source");
  process.exit(2);
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ examined, skipped, findings }, null, 2));
} else {
  console.log(`files scanned:      ${files.length}`);
  console.log(`controls examined:  ${examined}`);
  console.log(`controls skipped:   ${skipped} (hidden / honeypot)`);
  console.log(`themed CSS rules:   ${themedRules.length} (+ ${accentRules.length} accent-color) of ${rules.length}`);
  console.log(`state-only selectors ignored for coverage: ${stateSelectors}`);
  console.log(`unsupported selectors (not counted either way): ${unsupported.size}`);
  for (const s of unsupported) console.log(`  UNSUPPORTED: ${s}`);
  for (const f of findings) {
    console.log(
      f.kind === "UNTHEMED"
        ? `FINDING: ${f.file}:${f.line} — ${f.message}`
        : `FINDING: styles.css — ${f.message}`,
    );
  }
}

if (findings.length > 0) {
  console.log(`FAIL: ${findings.length} finding(s)`);
  process.exit(1);
}
console.log("PASS");
