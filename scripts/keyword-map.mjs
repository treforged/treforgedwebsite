#!/usr/bin/env node

/**
 * One primary search intent per page on treforged.com (ask df6b3fbb, Tre
 * 2026-10-07). getforgenta.com (Ada) owns the product head terms - "best /
 * simple / free budget app" - so a title here that carries one of them makes
 * the two sites compete for the same query. This gate refuses that, and checks
 * the on-page basics (title, description, one H1, canonical, valid JSON-LD)
 * for every page in docs/seo/keyword-map.json.
 *
 * It is a SOURCE check. --limits prints what it cannot see.
 * Usage: node scripts/keyword-map.mjs [--limits]
 */

import fs from 'node:fs';
import path from 'node:path';

let checks = 0;
let failed = 0;

function check(ok, label, detail) {
  checks += 1;
  if (ok) {
    console.log('ok   ' + label);
  } else {
    failed += 1;
    console.log('FAIL ' + label + (detail ? '  ->  ' + detail : ''));
  }
}

function decodeEntities(text) {
  const entities = {
    '&amp;': '&',
    '&mdash;': '—',
    '&#8482;': '™',
    '&nbsp;': ' ',
    '&#39;': "'",
    '&quot;': '"'
  };
  return text.replace(/&[a-z]+;|&#\d+;/g, (match) => entities[match] || match);
}

function normalizeText(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return null;
  }
}

function extractTitle(content) {
  const match = content.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? match[1] : null;
}

function extractDescription(content) {
  const match = content.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  return match ? match[1] : null;
}

function extractH1s(content) {
  const matches = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  return matches ? matches.map(h1 => h1.replace(/<[^>]*>/g, '')) : [];
}

function extractCanonical(content) {
  const match = content.match(/<link\s+rel="canonical"\s+href="(.*?)"/i);
  return match ? match[1] : null;
}

function extractLdJson(content) {
  const matches = content.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  return matches ? matches.map(script => script.replace(/<[^>]*>/g, '')) : [];
}

function validateKeywordMap(keywordMap) {
  if (!keywordMap || !keywordMap.pages || keywordMap.pages.length === 0) {
    console.log('FAIL keyword-map.json is missing or pages is empty');
    process.exit(2);
  }
}

function main() {
  const keywordMapPath = path.join(process.cwd(), 'docs/seo/keyword-map.json');
  const keywordMapContent = readFile(keywordMapPath);
  if (!keywordMapContent) {
    console.log('FAIL keyword-map.json is missing');
    process.exit(2);
  }

  let keywordMap;
  try { keywordMap = JSON.parse(keywordMapContent); } catch (err) { console.log('FAIL keyword-map.json does not parse: ' + err.message); process.exit(2); }
  validateKeywordMap(keywordMap);

  for (const page of keywordMap.pages) {
    const filePath = path.join(process.cwd(), page.file);
    const content = readFile(filePath);
    if (!content) {
      check(false, `${page.file}: file is missing`);
      continue;
    }

    const rawTitle = extractTitle(content);
    const title = rawTitle ? decodeEntities(rawTitle).replace(/\s+/g, ' ').trim() : null;
    const rawDesc = extractDescription(content);
    const description = rawDesc ? decodeEntities(rawDesc).replace(/\s+/g, ' ').trim() : null;
    const h1s = extractH1s(content);
    const canonical = extractCanonical(content);
    const ldJsons = extractLdJson(content);

    const primary = page.primary.toLowerCase();
    const reservedForGetforgenta = keywordMap.reservedForGetforgenta.map(phrase => phrase.toLowerCase());

    // Check title contains primary
    check(title && normalizeText(title).includes(primary), `${page.file}: title contains "${page.primary}"`, title);

    // Check title length
    check(title && title.length >= 20 && title.length <= 65, `${page.file}: title length is 20..65 characters`, title ? title.length + ' chars' : 'no title');

    // Check description
    check(description && description.length >= 70 && description.length <= 160, `${page.file}: description is present and 70..160 characters`, description ? description.length + ' chars' : 'no description');

    // Check exactly one h1
    check(h1s.length === 1, `${page.file}: exactly one h1`, h1s.length + ' found');

    // Check h1 or description contains primary
    const h1Text = h1s.length > 0 ? normalizeText(h1s[0]) : '';
    const descText = description ? normalizeText(description) : '';
    check(h1Text.includes(primary) || descText.includes(primary), `${page.file}: h1 or description contains primary`);

    // Check canonical
    check(canonical && canonical.startsWith('https://treforged.com/'), `${page.file}: canonical is present and starts with https://treforged.com/`);

    // Check ld+json
    check(ldJsons.length > 0, `${page.file}: at least one ld+json block`);
    ldJsons.forEach((ldJson, i) => {
      let ok = true;
      let why = '';
      try { JSON.parse(ldJson); } catch (err) { ok = false; why = err.message; }
      check(ok, `${page.file}: ld+json block ${i + 1} parses`, why);
    });

    // Check title does not contain any reservedForGetforgenta phrase
    const titleText = title ? normalizeText(title) : '';
    const reservedPhrase = reservedForGetforgenta.find(phrase => titleText.includes(phrase));
    check(!reservedPhrase, `${page.file}: title does not contain any reservedForGetforgenta phrase`, reservedPhrase);
  }

  console.log(`${checks} checks, ${failed} failed`);
  if (checks === 0) process.exit(2);
  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv.includes('--limits')) {
  console.log('Does NOT check: real search volume (needs Keyword Planner), rankings, Lighthouse, blog posts (see keyword-coverage.mjs), body copy, or the HTML Cloudflare serves after edge rewrites.');
  process.exit(0);
}

main();

