// content.js - Runs on claude.ai/settings/usage
// Waits for React to render, then scrapes usage data

function parsePercent(text) {
  const match = text && text.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeUsage() {
  console.log('[Claude Usage Tracker] Starting scrape...');

  // Wait up to 12 seconds for the page to have "% used" text
  let attempts = 0;
  while (attempts < 24) {
    await sleep(500);
    attempts++;
    const bodyText = document.body ? document.body.innerText : '';
    if (bodyText.includes('used') && bodyText.includes('%')) break;
  }

  if (attempts >= 24) {
    console.log('[Claude Usage Tracker] Timed out waiting for content');
    return;
  }

  // Extra buffer for React to settle
  await sleep(800);

  const data = {
    timestamp: Date.now(),
    session: null,
    sessionReset: null,
    weekly: null,
    weeklyReset: null,
  };

  try {
    const bodyText = document.body.innerText;
    console.log('[Claude Usage Tracker] Page text snippet:', bodyText.slice(0, 600));

    // Strategy 1: Find all "X% used" occurrences in order
    const percentMatches = [...bodyText.matchAll(/(\d+)%\s*used/g)];
    console.log('[Claude Usage Tracker] Found % matches:', percentMatches.map(m => m[0]));

    if (percentMatches.length >= 1) data.session = parseInt(percentMatches[0][1]);
    if (percentMatches.length >= 2) data.weekly = parseInt(percentMatches[1][1]);

    // Strategy 2: DOM-level scan if text approach missed anything
    if (data.session === null || data.weekly === null) {
      const allLeafEls = [...document.querySelectorAll('*')].filter(el =>
        el.children.length === 0 &&
        /\d+%/.test(el.textContent.trim())
      );
      console.log('[Claude Usage Tracker] Leaf % elements:', allLeafEls.map(e => e.textContent.trim()).slice(0, 10));

      const pctEls = allLeafEls.filter(el => el.textContent.includes('%'));
      if (pctEls.length >= 1 && data.session === null) data.session = parsePercent(pctEls[0].textContent);
      if (pctEls.length >= 2 && data.weekly === null) data.weekly = parsePercent(pctEls[1].textContent);
    }

    // Strategy 3: Look for aria-valuenow on progress bars
    if (data.session === null || data.weekly === null) {
      const progressEls = document.querySelectorAll('[aria-valuenow], [role="progressbar"]');
      console.log('[Claude Usage Tracker] Progress elements:', progressEls.length);
      const vals = [...progressEls].map(el =>
        parseInt(el.getAttribute('aria-valuenow') || el.getAttribute('value') || '')
      ).filter(v => !isNaN(v));

      if (vals.length >= 1 && data.session === null) data.session = vals[0];
      if (vals.length >= 2 && data.weekly === null) data.weekly = vals[1];
    }

    // Parse reset times
    const resetInMatch = bodyText.match(/Resets in ([^\n]+)/);
    if (resetInMatch) data.sessionReset = 'Resets in ' + resetInMatch[1].trim();

    const resetDayMatch = bodyText.match(/Resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]*/);
    if (resetDayMatch) data.weeklyReset = resetDayMatch[0].trim();

    console.log('[Claude Usage Tracker] Scraped data:', JSON.stringify(data));

    if (data.session !== null || data.weekly !== null) {
      chrome.runtime.sendMessage({ type: 'USAGE_DATA', data });
      console.log('[Claude Usage Tracker] Data sent successfully!');
    } else {
      console.log('[Claude Usage Tracker] No data found. Inspect the page manually.');
    }
  } catch (err) {
    console.log('[Claude Usage Tracker] Scrape error:', err.message, err.stack);
  }
}

// Run immediately
scrapeUsage();

// Also re-run on SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.href.includes('/settings/usage')) {
      setTimeout(scrapeUsage, 1500);
    }
  }
}).observe(document, { subtree: true, childList: true });
