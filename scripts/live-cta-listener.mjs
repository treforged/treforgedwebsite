/**
 * Live CTA Listener Gate
 *
 * Purpose:
 * The committed HTML cannot prove what the live site actually serves because
 * Cloudflare rewrites the response at the edge. This script fetches the live
 * pages directly, extracts the deployed main.js, and asserts that the CTA click
 * listener code is present and not gated on blog-slug logic.
 *
 * Usage:
 *   node scripts/live-cta-listener.mjs [--limits]
 *
 * Exit codes:
 *   0 - all assertions passed on every page.
 *   1 - one or more assertions failed.
 *   2 - the check could not be performed (network error, unexpected status,
 *       zero pages examined, or the positive control failed).
 */

import process from 'node:process';

const BASE_URL = 'https://treforged.com';
const PATHS = [
  '/',
  '/tools/',
  '/tools/debt-payoff-calculator/',
  '/founders/',
  '/blog/how-to-lower-insurance-premiums/'
];

let pagesExamined = 0;
let assertionsRun = 0;
let failed = 0;

/**
 * Print a failure message and increment the failure counter.
 */
function recordFail(message) {
  console.log(`FAIL ${message}`);
  failed++;
}

/**
 * Print a control message (prefixed with CONTROL) and exit with code 2.
 */
function controlFail(message) {
  console.log(`CONTROL FAIL ${message}`);
  process.exit(2);
}

/**
 * Generate a unique cache-busting query string.
 */
function cacheBuster() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Perform a fetch with the required no-store options.
 */
async function fetchNoCache(url) {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'manual',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });
  return response;
}

/**
 * Extract the main.js URL and its version hash from page HTML.
 */
function extractMainJsInfo(html) {
  const scriptRegex = /<script[^>]+src=["']([^"']*main\.js\?v=([a-f0-9]+))["']/i;
  const match = scriptRegex.exec(html);
  if (!match) {
    return null;
  }
  return {
    src: match[1],
    hash: match[2]
  };
}

/**
 * Verify that the block between CTA markers satisfies all conditions.
 */
function verifyCtaBlock(block, path) {
  // a. markers present were already checked before calling this.
  // b. block already sliced.
  // c. record_cta_click
  assertionsRun++;
  if (!block.includes('record_cta_click')) {
    recordFail(`[${path}] missing "record_cta_click" in CTA block`);
  }

  // d. document.addEventListener('click'
  assertionsRun++;
  if (!block.includes(`document.addEventListener('click`)) {
    recordFail(`[${path}] missing document.addEventListener('click' in CTA block`);
  }

  // e. disallowed gating patterns
  // The brace matters. The defect as it ACTUALLY shipped was `if (slugMatch) {`
  // on its own line with the listener on the next, so a pattern without the
  // optional `{` matches nothing and reports clean. Measured against
  // da64cff^:main.js - without \{? it returns false on the real defect.
  const gatedPattern1 = /if\s*\(\s*slugMatch\s*\)\s*\{?\s*document\.addEventListener/;
  const gatedPattern2 = /if\s*\(\s*!\s*slugMatch\s*\)\s*return/;

  assertionsRun++;
  const m1 = gatedPattern1.exec(block);
  if (m1) {
    recordFail(`[${path}] gated on slugMatch (found "${m1[0]}")`);
  }

  assertionsRun++;
  const m2 = gatedPattern2.exec(block);
  if (m2) {
    recordFail(`[${path}] early return on !slugMatch (found "${m2[0]}")`);
  }

  // Positive marker: ensure non-blog page-key branch is present
  assertionsRun++;
  if (!block.includes(`return 'page-home';`)) {
    recordFail(`[${path}] the non-blog page-key branch ("return 'page-home';") is absent from the served CTA block - the listener is blog-only or the block was rewritten`);
  }
}

/**
 * Main execution flow.
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--limits')) {
    console.log('LIMITS:');
    console.log('- Checks that the served JavaScript contains the listener.');
    console.log('- Does not verify execution in a real browser.');
    console.log('- Does not see Cloudflare rules that depend on user-agent.');
    console.log('- Only five paths are examined, not every page.');
    console.log('- PASS means the listener ships, not that it was clicked.');
    console.log('- Reads the served JavaScript TEXT and cannot detect runtime listener errors.');
    process.exit(0);
  }

  for (const path of PATHS) {
    const cb = cacheBuster();
    const pageUrl = new URL(path, BASE_URL);
    pageUrl.searchParams.set('cb', cb);

    let pageResp;
    try {
      pageResp = await fetchNoCache(pageUrl);
    } catch (err) {
      controlFail(`network error fetching ${pageUrl}: ${err.message}`);
    }

    // Require 200, no redirect
    if (pageResp.status >= 300 && pageResp.status < 400) {
      const location = pageResp.headers.get('location') || 'unknown';
      recordFail(`[${path}] unexpected redirect (Location: ${location})`);
      pagesExamined++;
      continue;
    } else if (pageResp.status !== 200) {
      controlFail(`unexpected status ${pageResp.status} fetching ${pageUrl}`);
    }

    const pageHtml = await pageResp.text();
    pagesExamined++;

    // 3. Extract main.js src
    assertionsRun++;
    const mainInfo = extractMainJsInfo(pageHtml);
    if (!mainInfo) {
      recordFail(`[${path}] could not find main.js script tag`);
      continue;
    }

    // 4. Fetch main.js
    const mainUrl = new URL('/main.js', BASE_URL);
    mainUrl.searchParams.set('v', mainInfo.hash);
    mainUrl.searchParams.set('cb', cacheBuster());

    let mainResp;
    try {
      mainResp = await fetchNoCache(mainUrl);
    } catch (err) {
      controlFail(`network error fetching ${mainUrl}: ${err.message}`);
    }

    if (mainResp.status >= 300 && mainResp.status < 400) {
      const location = mainResp.headers.get('location') || 'unknown';
      recordFail(`[${path}] main.js redirected (Location: ${location})`);
      continue;
    } else if (mainResp.status !== 200) {
      recordFail(`[${path}] main.js fetch returned status ${mainResp.status}`);
      continue;
    }

    const mainText = await mainResp.text();

    // Positive control: must contain "viewsRpc"
    assertionsRun++;
    if (!mainText.includes('viewsRpc')) {
      controlFail(`positive control failed: "viewsRpc" not found in main.js for ${path}`);
    }

    // a. markers presence
    assertionsRun++;
    const startIdx = mainText.indexOf('// CTA_BLOCK_START');
    const endIdx = mainText.indexOf('// CTA_BLOCK_END');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      recordFail(`[${path}] missing CTA block markers`);
      continue;
    }

    // b. slice block
    const block = mainText.slice(startIdx, endIdx + '// CTA_BLOCK_END'.length);

    // c. further checks
    const failuresBefore = failed;
    verifyCtaBlock(block, path);
    if (failed === failuresBefore) {
      console.log(`OK   ${path}  main.js?v=${mainInfo.hash}`);
    }
  }

  console.log(`${pagesExamined} pages examined, ${assertionsRun} assertions, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  if (pagesExamined === PATHS.length) {
    process.exit(0);
  }
  // Should never reach here, but treat as inability to verify.
  process.exit(2);
}

// Global error handling
try {
  await main();
} catch (e) {
  console.error(`UNEXPECTED ERROR: ${e && e.message ? e.message : e}`);
  process.exit(2);
}
