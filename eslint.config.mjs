/**
 * eslint.config.mjs - the first linter this repo has ever had.
 *
 * EVERY RULE IS 'warn', NEVER 'error', AND THAT IS DELIBERATE.
 * A gate that goes red on ordinary work is a gate people route around, and the
 * first run of a linter over 35 files that have never been linted will find a
 * backlog. So this reports the backlog and lets the commit through. Turning a
 * rule to 'error' is a decision to take AFTER its count is at zero, one rule at
 * a time - not on the day the linter arrives.
 *
 * THREE ENVIRONMENTS LIVE HERE AND THEY ARE NOT INTERCHANGEABLE:
 *   main.js            browser, plain <script>, ES5-style var/function. It is
 *                      served verbatim to visitors, so it is NOT a module and
 *                      must not be linted as one.
 *   tools/**\/*.js      browser ES modules - each calc.js is imported by its own
 *                      page (<script type="module">) AND by its test.
 *   scripts/*.mjs,
 *   tools/**\/*.test.mjs  Node ES modules. Never served.
 *
 * WHAT IS NOT LINTED, said out loud because a check you never ran and a check
 * that passed look identical in a green report:
 *   supabase/functions/founder-waitlist/index.ts - Deno TypeScript. Linting it
 *   needs a TypeScript parser and Deno globals, neither of which is installed.
 *   `npm run lint:baseline` prints this exclusion on every run so it cannot
 *   quietly become "we lint everything".
 */

import globals from 'globals';

/** One rule set, so an environment cannot silently drift to a weaker one. */
const rules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'warn',
  'no-empty': 'warn',
  'no-constant-condition': 'warn',
  'no-dupe-keys': 'warn',
  'no-unreachable': 'warn',
  'no-redeclare': 'warn',
  'no-self-assign': 'warn',
  'no-fallthrough': 'warn',
  // Enabled because scripts/test-tool-views.mjs already carried an
  // `eslint-disable-next-line no-new-func` written before this repo had any
  // linter at all. A disable directive for a rule nobody enabled documents an
  // intention that nothing enforces - so the rule is on, and that directive
  // now does the job it was written to do.
  'no-new-func': 'warn',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'backups/**',
      // Deno TypeScript - see the header. Excluded, not forgotten.
      'supabase/functions/**',
    ],
  },
  {
    files: ['main.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules,
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules,
  },
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.test.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules,
  },
];
