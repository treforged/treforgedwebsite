// Assumption: this script resides in a subdirectory (e.g., scripts/) and the repository root contains index.html. Adjust the relative path if placed elsewhere.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const getArgValue = (name, defaultValue) => {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : defaultValue;
};

const minCached = parseFloat(getArgValue('min-cached', '50'));
const host = getArgValue('host', 'treforged.com');

const SITEMAP_URL = `https://${host}/sitemap.xml`;
const INDEX_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

const CACHED_STATUSES = new Set(['HIT', 'STALE', 'REVALIDATED', 'UPDATING']);

async function readIndexAssets() {
  if (hostProvided() && host !== 'treforged.com') return [];
  try {
    const html = await readFile(INDEX_PATH, 'utf8');
    const assets = [];

    const cssMatch = html.match(/href=["']([^"']*styles\.css\?v=[^"']+)["']/i);
    const jsMatch = html.match(/src=["']([^"']*main\.js\?v=[^"']+)["']/i);

    if (cssMatch) assets.push(`https://${host}/${cssMatch[1].replace(/^\/+/, '')}`);
    else if (!hostProvided()) {
      console.error('Error: styles.css with version hash not found in index.html');
      process.exit(1);
    }

    if (jsMatch) assets.push(`https://${host}/${jsMatch[1].replace(/^\/+/, '')}`);
    else if (!hostProvided()) {
      console.error('Error: main.js with version hash not found in index.html');
      process.exit(1);
    }

    return assets;
  } catch (e) {
    if (!hostProvided()) {
      console.error('Error reading index.html:', e.message);
      process.exit(1);
    }
    return []; // when host overridden, missing index.html is tolerated
  }
}

function hostProvided() {
  return args.some((a) => a.startsWith('--host='));
}

async function fetchSitemapUrls() {
  try {
    const res = await fetch(SITEMAP_URL, { method: 'GET', redirect: 'manual' });
    if (!res.ok) {
      console.error(`Error fetching sitemap: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const text = await res.text();
    const urlRegex = /<loc>(https?:\/\/[^<]+)<\/loc>/gi;
    const urls = [];
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      urls.push(match[1]);
    }
    const onHost = urls.filter((u) => {
      try {
        return new URL(u).hostname === host;
      } catch {
        return false;
      }
    });
    if (onHost.length === 0) {
      console.error(`Error: sitemap contains no URLs on ${host}`);
      process.exit(1);
    }
    return onHost;
  } catch (e) {
    console.error('Error fetching sitemap:', e.message);
    process.exit(1);
  }
}

async function fetchStatus(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    const status = res.headers.get('cf-cache-status') ?? 'NONE';
    return status;
  } catch {
    return 'ERROR';
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classify(status) {
  return CACHED_STATUSES.has(status) ? 'CACHED' : 'UNCACHED';
}

async function runPass(urls, passNumber) {
  const counts = new Map();
  for (const url of urls) {
    const status = await fetchStatus(url);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    await pause(250);
  }

  const total = urls.length;
  let cachedCount = 0;
  for (const [status, cnt] of counts) {
    if (CACHED_STATUSES.has(status)) cachedCount += cnt;
  }
  const cachedPct = (cachedCount / total) * 100;

  console.log(`Pass ${passNumber} results:`);
  const sortedStatuses = Array.from(counts.keys()).sort();
  for (const st of sortedStatuses) {
    console.log(`${st}: ${counts.get(st)}`);
  }
  console.log(`Total: ${total}`);
  console.log(`Cached: ${cachedCount} (${cachedPct.toFixed(1)}%)`);
  console.log(''); // blank line

  return { cachedPct, total };
}

(async () => {
  const sitemapUrls = await fetchSitemapUrls();
  const assetUrls = await readIndexAssets();
  const allUrls = Array.from(new Set([...sitemapUrls, ...assetUrls]));

  const pass1 = await runPass(allUrls, 1);
  const pass2 = await runPass(allUrls, 2);

  const outcome = pass2.cachedPct >= minCached ? 'PASS' : 'FAIL';
  console.log(`${outcome} ${pass2.cachedPct.toFixed(1)}% ${outcome === 'PASS' ? '>=' : '<'} ${minCached}%`);

  process.exit(outcome === 'PASS' ? 0 : 1);
})();
