# The reachability gate, and how to adapt it to another repo

`scripts/reachability.mjs` + `reachability.config.json`. No dependencies, one
file, Node 18+. Copy both, edit the JSON, run it.

## What it is for

Every gate we had was asking **"does this exist?"**. Four times in one week the
defect was **"can anyone get to it?"** - three calculators with no nav link and a
404 hub, a Conversation tab whose two handlers both opened the desk view, modules
exported and never imported. All of them worked perfectly for anyone who already
knew the way in, which is why every check stayed green and a person found each
one by accident.

## The one idea worth copying, even if you never run this script

**Orphaned and broken are opposite defects and must be counted separately.**

| | what it means | who notices |
| --- | --- | --- |
| **ORPHAN** | the target exists, nothing links to it | nobody - it is silent by construction |
| **BROKEN** | something links to a target that does not exist | a visitor, immediately |

Report them as one "link problem" count and the orphan hides: a repo with zero
broken links reads as healthy while a whole feature is unreachable. That is
exactly how the calculators survived five days.

## Exit codes - the part that stops a vacuous green

| code | meaning |
| --- | --- |
| 0 | everything examined is reachable |
| 1 | **I looked and found defects** |
| 2 | **I could not look** - config missing, a `fromDir` that is not there, a glob matching no files, a rule with no subjects |

**2 is not 1 and it is not 0.** A gate whose glob silently matched nothing cannot
fail, so it is not a gate - and if "could not look" shared an exit code with
"looked and it was fine", a broken config would read as a clean repo forever.
The script also prints its denominators (files scanned, links found, targets
examined, rules evaluated) so a suspiciously small number is visible rather than
inferred.

Defaults are deliberately STRICT: forgetting a field makes it refuse, never
makes it lenient. Weakening it takes a deliberate edit.

## Adapting it

Three knobs. Start by making it fail on purpose, then make it pass.

**1. `scan` + `linkPatterns` - what a "link" looks like in your repo.**

```jsonc
// static HTML (this repo)
"scan": [".html"],
"linkPatterns": ["href=\"([^\"]+)\""]

// Next.js / React (Ada)
"scan": [".tsx", ".ts", ".jsx"],
"linkPatterns": [
  "href=[\"']([^\"']+)[\"']",       // <Link href="/settings">
  "router\\.push\\([\"']([^\"']+)"  // programmatic navigation
]
```

Regexes are read from JSON, so backslashes double. **Never build one through a
shell** - a heredoc turned `\b` into a literal backspace in another repo this
week and the pattern silently matched nothing while its assertion "passed".

**2. `targets` - the things that must be reachable.** Discovery is
directory-based: every subdirectory of `fromDir` containing `requireFile`
becomes a target, and `href` is its canonical address with `{dir}` substituted.

```jsonc
"targets": [{
  "name": "calculators",
  "fromDir": "tools",
  "requireFile": "index.html",
  "href": "/tools/{dir}/",
  "minInbound": 1
}]
```

For a route directory (`app/`, `src/routes/`, `pages/`) point `fromDir` there
and set `requireFile` to `page.tsx` or equivalent.

**3. `mustLink` - "every file that looks like X must contain Y".**

This is the rule the orphan check cannot replace. An orphan check passes as soon
as **one** thing links the target, so a hub linked only from its own children
looks reachable. `mustLink` is what asserts the nav carries it on every page.

```jsonc
"mustLink": [{
  "name": "every page carrying the site nav links to the tools hub",
  "filesContaining": "<nav class=\"primary\"",
  "mustContain": "href=\"/tools/\""
}]
```

`allowUnresolved` takes href prefixes that legitimately have no file on disk
(a server route, an API path). Keep it short - every entry is a hole.

## For a repo where reachability is not about URLs (Vera)

The same shape works with the words swapped: **target = an exported symbol,
link = an import of it, orphan = exported and never imported.** The dead
Conversation tab was not a URL problem, and it is the same defect - a thing that
exists, is described as working, and cannot be arrived at.

Two things this script does NOT catch, and both bit us this week, so gate them
separately:

- **A handler wired to the wrong destination.** Both tab handlers existed, both
  were imported, both were pressed - and both set the view to `'desk'`. Nothing
  about that is unreachable in the link sense. The assertion has to be that the
  press CHANGED something a user can see, not that it raised no error.
- **A link that resolves but 404s in production**, e.g. a case-sensitive host
  serving a path that exists with different capitalisation on a
  case-insensitive filesystem. This checks disk, not HTTP.

## Verifying it after you adapt it

Do not trust a first green. Break each branch on purpose and confirm it goes red
**for the right reason** - all seven of these were run here before this was
committed:

| mutation | expect |
| --- | --- |
| add a target directory nothing links to | exit 1, ORPHAN |
| add a link to a target that does not exist | exit 1, BROKEN |
| remove the required link from one matching page | exit 1, must-link |
| point `fromDir` at a missing directory | exit 2 |
| set `scan` to an extension nothing matches | exit 2 |
| set `filesContaining` to something no file has | exit 2 |
| delete the config | exit 2 |

**One of these caught a bad mutation rather than a bad script**, and it is the
reason for the "right reason" wording: removing the `/tools/` link from one page
first went red as a BROKEN link, not a must-link failure, because the page
carries **two** navs (desktop and mobile) and the edit changed only one. The
gate was fine; the test was wrong. A red result proves nothing until you have
read *which* check produced it.
