#!/usr/bin/env node
/**
 * paa-drafts.mjs - the gate for "People also ask" blog DRAFTS.
 *
 * Drafts live in content-queue/drafts/paa/<month>_<subtopic>/<slug>.json, in
 * the same shape as a queue.json item plus a `paa` block:
 *   { question, answer, tool, subtopic, questionSource, verifiedBy }
 * The daily publisher reads ONLY queue.json, so nothing here can go live until
 * somebody moves it into the queue. That move is the publish decision, and it
 * is Tre's.
 *
 * What it checks, per draft: the shape, the SEO basics (title, meta
 * description, one h1, canonical, FAQPage schema led by the PAA question), the
 * house style (no dashes the generator bans, allowed tags only, long-form
 * length), that every /blog/ link points at a real post, that Forgenta is
 * linked, and that the draft has NOT leaked into the queue, the blog folder or
 * the sitemap. It renders each draft with the real template (renderArticle) so
 * the checks run on the page a reader would get, not on the JSON.
 *
 * Usage:
 *   node scripts/paa-drafts.mjs                 check every draft
 *   node scripts/paa-drafts.mjs --publishable   also FAIL on any question not
 *                                               yet verified against a real PAA box
 *   node scripts/paa-drafts.mjs --preview <dir> also write each rendered page there
 *   node scripts/paa-drafts.mjs --limits        print what this does not catch
 *
 * Exit 0 pass, 1 a draft failed, 2 nothing was examined or the instrument broke.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderArticle, PAA_TOOLS } from './publish-next.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRAFTS = join(ROOT, 'content-queue', 'drafts', 'paa');
const args = process.argv.slice(2);

if (args.includes('--limits')) {
  console.log(`paa-drafts does NOT check:
- that a question really appears in a Google "People also ask" box. Only a
  person (or an allowed search API) can confirm that; --publishable refuses
  any draft whose paa.questionSource is not "verified".
- that the advice is correct. Arithmetic in worked examples is a human read.
- how the page LOOKS. It reuses existing classes (block, faq-item) and adds no
  CSS, but a rendered frame is still the only proof of layout.
- anything Cloudflare changes at the edge.`);
  process.exit(0);
}

const publishable = args.includes('--publishable');
const previewDir = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;

const words = (html) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const ESC_CHANGES = /[&<>"'‘’“”]/;
const BANNED = /[—–‑]/; // em dash, en dash, non-breaking hyphen
const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'li', 'ol', 'blockquote', 'strong', 'em', 'a']);
const APP_LINK = 'href="https://getforgenta.com/"';

export const checkDraft = (item, ctx) => {
  const errs = [];
  const e = (m) => errs.push(m);
  const { slug } = item;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) e(`bad slug "${slug}"`);
  if (ctx.file && ctx.file !== `${slug}.json`) e(`file ${ctx.file} does not match slug`);
  if (ctx.live.has(slug)) e('slug is already in queue.json or published.json');
  if (!item.title || item.title.length > 65 || ESC_CHANGES.test(item.title)) e(`title missing, over 65 chars or quoted: "${item.title}"`);
  const dl = (item.description || '').length;
  if (dl < 120 || dl > 160) e(`meta description is ${dl} chars, want 120-160`);
  if (!Array.isArray(item.tags) || !item.tags.length) e('no tags');

  const p = item.paa || {};
  if (!p.question || !p.question.endsWith('?') || ESC_CHANGES.test(p.question)) e(`PAA question missing, no "?", or has quotes: "${p.question}"`);
  const aw = words(p.answer || '');
  if (aw < 40 || aw > 60 || /[<>]/.test(p.answer || '')) e(`short answer is ${aw} words or holds HTML, want 40-60 plain words`);
  if (p.tool !== null && !(p.tool in PAA_TOOLS)) e(`tool "${p.tool}" is not a calculator under /tools/`);
  if (!['candidate', 'verified'].includes(p.questionSource)) e(`questionSource "${p.questionSource}" must be candidate or verified`);
  if (publishable && p.questionSource !== 'verified') e('question not verified against a real PAA box (--publishable)');

  const body = item.bodyHtml || '';
  const bw = words(body);
  if (bw < 900) e(`body is ${bw} words, want at least 900`);
  const h2 = (body.match(/<h2[\s>]/g) || []).length;
  if (h2 < 5 || h2 > 7) e(`${h2} <h2> sections, want 5-7`);
  const badTags = [...new Set([...body.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()))].filter((t) => !ALLOWED_TAGS.has(t));
  if (badTags.length) e(`disallowed tags: ${badTags.join(', ')}`);
  for (const [field, text] of [['title', item.title], ['description', item.description], ['answer', p.answer], ['body', body], ['faqs', JSON.stringify(item.faqs || [])]]) {
    if (BANNED.test(text || '')) e(`${field} holds an em dash, en dash or non-breaking hyphen`);
  }
  if (!body.includes(APP_LINK)) e('body never links Forgenta at https://getforgenta.com/');
  if (/\b(plaid|akoya)\b/i.test(body)) e('body names a bank-connection provider; the site stays provider-free');
  // Any /blog/ href, slash or not: a slash-less link skipped this check once
  // and publish-next only rewrites the slashed form.
  for (const m of body.matchAll(/href="\/blog\/([^"]*)"/g)) {
    const target = m[1].replace(/\/$/, '');
    if (!m[1].endsWith('/')) e(`link /blog/${m[1]} has no trailing slash`);
    if (!ctx.known.has(target)) e(`links to /blog/${target}/, which does not exist`);
  }
  // Anchor text that is a bare slug reads as a broken page to a person.
  const slugText = [...body.matchAll(/>([a-z0-9]+(?:-[a-z0-9]+){2,})</g)].map((m) => m[1]);
  const slugProse = [...ctx.known].filter((k) => body.replace(/<[^>]+>/g, ' ').includes(k));
  if (slugText.length || slugProse.length) e(`a raw slug is shown as text: ${[...slugText, ...slugProse].join(', ')}`);
  // One or two plain mentions, as the generator prompt has always asked. More
  // reads as an ad, and each extra sentence is a feature claim to verify.
  const appLinks = body.split(APP_LINK).length - 1;
  const named = (body.replace(/<[^>]+>/g, ' ').match(/Forgenta/g) || []).length;
  if (appLinks > 2 || named > 3) e(`Forgenta is linked ${appLinks}x and named ${named}x; want at most 2 links and 3 mentions`);
  const faqs = item.faqs || [];
  if (faqs.length < 2 || faqs.length > 4) e(`${faqs.length} FAQs, want 2-4`);
  for (const f of faqs) if (!f.q || !f.q.endsWith('?') || ESC_CHANGES.test(f.q) || !f.a) e(`FAQ "${f.q}" has no "?", has quotes, or no answer`);

  if (ctx.leaked.has(slug)) e('LEAK: this draft already appears in blog/ or sitemap.xml');

  // Render with the real template and check the page a reader would get.
  let html = '';
  try { html = renderArticle({ ...item, date: '2026-11-01' }, []); } catch (err) { e(`template threw: ${err.message}`); }
  if (html) {
    const h1 = (html.match(/<h1[^>]*>/g) || []).length;
    if (h1 !== 1) e(`rendered page has ${h1} <h1>, want 1`);
    if (!html.includes(`<link rel="canonical" href="https://treforged.com/blog/${slug}/">`)) e('no canonical');
    if (!html.includes('paa-answer')) e('short-answer box not rendered');
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let faqNode = null;
    for (const b of ld) {
      try { faqNode = JSON.parse(b[1]).find?.((n) => n['@type'] === 'FAQPage') || faqNode; } catch { e('JSON-LD does not parse'); }
    }
    if (!faqNode) e('no FAQPage schema');
    else if (faqNode.mainEntity[0].name !== p.question) e('FAQPage does not lead with the PAA question');
    else {
      const h3 = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1].trim());
      const orphans = faqNode.mainEntity.map((q) => q.name).filter((n) => !h3.includes(n));
      if (orphans.length) e(`schema questions not visible as <h3> (faq-sync would fail): ${orphans.join(' | ')}`);
    }
    const toolHref = p.tool ? `href="/tools/${p.tool}/"` : 'href="/tools/"';
    if (!html.includes(toolHref)) e(`no calculator link ${toolHref}`);
  }
  return { errs, html, bw, aw };
};

const main = async () => {
  const live = new Set();
  const known = new Set();
  for (const f of ['queue.json', 'published.json']) {
    const list = JSON.parse(await readFile(join(ROOT, 'content-queue', f), 'utf8'));
    for (const x of list) { live.add(x.slug); if (f === 'published.json') known.add(x.slug); }
  }
  if (!known.size) { console.log('FAIL - published.json read as empty; cannot check links.'); process.exit(2); }
  const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');

  if (!existsSync(DRAFTS)) { console.log(`FAIL - no drafts folder at ${DRAFTS}`); process.exit(2); }
  const files = [];
  for (const month of await readdir(DRAFTS, { withFileTypes: true })) {
    if (!month.isDirectory()) continue;
    for (const f of await readdir(join(DRAFTS, month.name))) if (f.endsWith('.json')) files.push([month.name, f]);
  }
  if (!files.length) { console.log('FAIL - 0 drafts examined, which is not a pass.'); process.exit(2); }

  const leaked = new Set();
  const seen = new Set();
  let failed = 0, unverified = 0;
  if (previewDir) await mkdir(previewDir, { recursive: true });
  for (const [month, f] of files) {
    const item = JSON.parse(await readFile(join(DRAFTS, month, f), 'utf8'));
    if (existsSync(join(ROOT, 'blog', item.slug)) || sitemap.includes(`/blog/${item.slug}/`)) leaked.add(item.slug);
    const { errs, html, bw, aw } = checkDraft(item, { live, known, leaked, file: f });
    if (seen.has(item.slug)) errs.push('duplicate slug across drafts');
    seen.add(item.slug);
    if (item.paa?.questionSource !== 'verified') unverified += 1;
    if (previewDir && html) await writeFile(join(previewDir, `${item.slug}.html`), html, 'utf8');
    if (errs.length) { failed += 1; console.log(`FAIL ${month}/${item.slug}\n  - ${errs.join('\n  - ')}`); }
    else console.log(`ok   ${month}/${item.slug}  (${bw} words, answer ${aw} words)`);
  }
  console.log(`\n${files.length} drafts examined, ${failed} failed, ${unverified} with a question not yet verified against a real PAA box.`);
  process.exit(failed ? 1 : 0);
};

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((err) => { console.error(err); process.exit(2); });
