#!/usr/bin/env node
/**
 * paa-drafts.test.mjs - proves the PAA draft gate can FAIL, and that it passes
 * a good draft. A gate that only ever says PASS is not a gate.
 *
 * Every red case starts from one known-good fixture and breaks exactly one
 * thing, so each check is shown to fire on its own defect.
 *
 * Usage: node scripts/paa-drafts.test.mjs
 */
import { checkDraft } from './paa-drafts.mjs';

const para = (n) => `<p>${'Money before payday is easier to plan when every bill is listed first. '.repeat(n)}</p>`;
const body = [1, 2, 3, 4, 5].map((i) => `<h2>Section ${i}</h2>${para(14)}`).join('')
  + '<p>See <a href="https://getforgenta.com/" target="_blank" rel="noopener">Forgenta</a> and <a href="/blog/real-post/">this guide</a>.</p>';

const good = {
  slug: 'how-much-can-i-spend-before-payday',
  title: 'How Much Can I Spend Before Payday',
  description: 'Find the amount that is safe to spend before your next paycheck: start from your balance, take out every bill due first, then plan the rest calmly.',
  tags: ['Budgeting', 'Paycheck'],
  readMins: 6,
  promoteApp: true,
  paa: {
    question: 'How do I know how much I can spend before payday?',
    answer: 'Start with your checking balance today. Subtract every bill, debt payment and planned saving that is due before your next paycheck arrives. The amount that is left is what you can safely spend until payday, and you should split it across the days that remain in the pay period.',
    tool: null,
    subtopic: '2026-11 safe to spend',
    questionSource: 'candidate',
    verifiedBy: null,
  },
  bodyHtml: body,
  faqs: [{ q: 'What if my income changes?', a: 'Use the amount you actually received.' }, { q: 'Should savings count as a bill?', a: 'Yes, treat it as one.' }],
};
const ctx = () => ({ live: new Set(['already-live']), known: new Set(['real-post']), leaked: new Set(), file: `${good.slug}.json` });

let failures = 0;
const expect = (name, item, wantPass, needle = '', c = ctx(), opts) => {
  const { errs } = checkDraft(item, c, opts);
  const passed = errs.length === 0;
  const ok = wantPass ? passed : !passed && errs.some((e) => e.includes(needle));
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  -> ${errs.join(' | ') || 'no errors'}`}`);
};
const withPaa = (p) => ({ ...good, paa: { ...good.paa, ...p } });

expect('good draft passes', good, true);
expect('short body is refused', { ...good, bodyHtml: '<h2>a</h2><p>too short</p>' }, false, 'words');
expect('em dash is refused', { ...good, bodyHtml: good.bodyHtml.replace('Section 1', 'Section — 1') }, false, 'em dash');
expect('invented /blog/ slug is refused', { ...good, bodyHtml: good.bodyHtml.replace('real-post', 'made-up-post') }, false, 'does not exist');
expect('missing Forgenta link is refused', { ...good, bodyHtml: good.bodyHtml.replace('https://getforgenta.com/', 'https://example.com/') }, false, 'Forgenta');
expect('provider name is refused', { ...good, bodyHtml: good.bodyHtml + '<p>Plaid links banks.</p>' }, false, 'provider');
expect('question without ? is refused', withPaa({ question: 'How much can I spend' }), false, 'PAA question');
expect('quoted question is refused (faq-sync needs plain text)', withPaa({ question: "What's safe to spend?" }), false, 'PAA question');
expect('long short-answer is refused', withPaa({ answer: good.paa.answer.repeat(2) }), false, 'short answer');
expect('unknown calculator is refused', withPaa({ tool: 'made-up-calculator' }), false, 'not a calculator');
expect('real calculator passes', withPaa({ tool: 'emergency-fund-calculator' }), true);
expect('meta description too short is refused', { ...good, description: 'Too short.' }, false, 'meta description');
expect('slug already live is refused', { ...good, slug: 'already-live' }, false, 'already in queue', { ...ctx(), file: 'already-live.json' });
expect('leaked draft is refused', good, false, 'LEAK', { ...ctx(), leaked: new Set([good.slug]) });
expect('slash-less /blog/ link is refused', { ...good, bodyHtml: good.bodyHtml.replace('/blog/real-post/', '/blog/made-up') }, false, 'trailing slash');
expect('raw slug as text is refused', { ...good, bodyHtml: good.bodyHtml + '<p>Read real-post next.</p>' }, false, 'raw slug');
expect('Forgenta oversell is refused', { ...good, bodyHtml: good.bodyHtml + '<p>Forgenta. Forgenta. Forgenta.</p>' }, false, 'Forgenta is linked');
expect('FAQ without ? is refused', { ...good, faqs: [{ q: 'No mark', a: 'x' }, good.faqs[1]] }, false, 'FAQ');

console.log(failures ? `\nFAIL - ${failures} case(s) wrong` : '\nPASS - 18 cases');
process.exit(failures ? 1 : 0);
