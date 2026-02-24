/**
 * Lightweight Playwright UI Stress Smoke Test
 *
 * How to run:
 * 1) Start the app on a local static server (example):
 *    `python3 -m http.server 5500`
 * 2) Run:
 *    `npm run stress:ui`
 *
 * Requirements:
 * - A reachable app URL (default: http://127.0.0.1:5500/index.html?tp3dDebug=1)
 * - Playwright installed and Chromium downloaded:
 *   `npm i -D playwright && npx playwright install chromium`
 *
 * Optional environment variables:
 * - `TP3D_STRESS_URL` (default above)
 * - `TP3D_STRESS_HEADLESS=0` for headed mode
 * - `TP3D_STRESS_CLICKS=40` number of click attempts
 * - `TP3D_TEST_EMAIL` and `TP3D_TEST_PASSWORD` for auth sign-in
 *
 * Output:
 * - Console summary with clicks/failures/skips
 * - Failure screenshots + JSON log in `test-results/`
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_URL = 'http://127.0.0.1:5500/index.html?tp3dDebug=1';
const RESULTS_DIR = path.resolve('test-results');
const CANDIDATE_SELECTOR = [
  'button',
  '[role="button"]',
  '.nav-btn',
  '.toolbar-btn',
  '[aria-pressed]',
].join(', ');
const CLICK_TIMEOUT_MS = 1400;
const TRIAL_TIMEOUT_MS = 500;
const READY_TIMEOUT_MS = 20000;
const MAX_PER_ELEMENT = 3;
const MAX_PICK_ATTEMPTS_PER_STEP = 8;
const BLOCKED_TERMS = ['remove', 'delete', 'cancel', 'logout', 'log out', 'sign out', 'danger'];

/** @returns {Promise<void>} */
async function waitForUiIdle(page) {
  try {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => resolve(null), { timeout: 250 });
        } else {
          setTimeout(resolve, 150);
        }
      });
    });
  } catch {
    // Cross-navigation/teardown races are safe to ignore in this smoke flow.
  }
  await page.waitForTimeout(150);
}

/** @param {string} value */
function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {any} meta */
function isDangerCandidate(meta) {
  const haystack = [
    meta.text,
    meta.ariaLabel,
    meta.title,
    meta.name,
    meta.dataVariant,
    meta.className,
  ]
    .map(v => String(v || '').toLowerCase())
    .join(' ');

  if (BLOCKED_TERMS.some(term => haystack.includes(term))) return true;
  if (String(meta.className || '').toLowerCase().includes('destructive')) return true;
  if (String(meta.className || '').toLowerCase().includes('danger')) return true;
  if (meta.dataDanger) return true;
  if (String(meta.dataVariant || '').toLowerCase() === 'danger') return true;
  return false;
}

/** @param {import('playwright').Page} page */
async function getActiveModalKey(page) {
  return await page.evaluate(() => {
    const isVisible = el => {
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const modals = Array.from(
      document.querySelectorAll('.modal, [role="dialog"], .modal-overlay, [data-tp3d-settings-modal="1"]')
    ).filter(isVisible);

    if (!modals.length) return null;
    const top = /** @type {HTMLElement} */ (modals[modals.length - 1]);
    return (
      top.getAttribute('data-tp3d-settings-instance') ||
      top.id ||
      top.getAttribute('aria-label') ||
      top.className ||
      'modal'
    );
  });
}

/**
 * @param {import('playwright').Locator} locator
 * @returns {Promise<any>}
 */
async function readElementMeta(locator) {
  return await locator.evaluate(el => {
    const esc = value => {
      try {
        return CSS.escape(value);
      } catch {
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
      }
    };
    const buildPath = node => {
      if (!(node instanceof Element)) return '<unknown>';
      const parts = [];
      let cur = node;
      let depth = 0;
      while (cur && depth < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) {
          part += `#${esc(cur.id)}`;
          parts.unshift(part);
          break;
        }
        const classNames = Array.from(cur.classList || []).slice(0, 2).map(c => `.${esc(c)}`).join('');
        if (classNames) part += classNames;
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(part);
        cur = parent;
        depth += 1;
      }
      return parts.join(' > ');
    };

    const modal = el.closest('.modal, [role="dialog"], .modal-overlay, [data-tp3d-settings-modal="1"]');
    const className = typeof el.className === 'string' ? el.className : '';
    return {
      selectorPath: buildPath(el),
      text: String(el.innerText || el.textContent || '').trim(),
      ariaLabel: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      name: el.getAttribute('name') || '',
      className,
      dataDanger: el.hasAttribute('data-danger'),
      dataVariant: el.getAttribute('data-variant') || '',
      inModal: Boolean(modal),
      modalKey: modal
        ? modal.getAttribute('data-tp3d-settings-instance') ||
          modal.id ||
          modal.getAttribute('aria-label') ||
          modal.className ||
          'modal'
        : null,
    };
  });
}

/**
 * @param {import('playwright').Page} page
 * @param {string|null} activeModalKey
 * @param {Map<string, number>} clickedByKey
 */
async function collectCandidates(page, activeModalKey, clickedByKey) {
  const root = page.locator(CANDIDATE_SELECTOR);
  const count = await root.count();
  /** @type {Array<{ locator: import('playwright').Locator, meta: any, key: string }>} */
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const locator = root.nth(i);

    let visible = false;
    try {
      visible = await locator.isVisible();
    } catch {
      visible = false;
    }
    if (!visible) continue;

    let enabled = true;
    try {
      enabled = await locator.isEnabled();
    } catch {
      enabled = true;
    }
    if (!enabled) continue;

    let meta;
    try {
      meta = await readElementMeta(locator);
    } catch {
      continue;
    }

    meta.text = normalizeText(meta.text);
    meta.ariaLabel = normalizeText(meta.ariaLabel);
    meta.title = normalizeText(meta.title);

    if (isDangerCandidate(meta)) continue;

    if (meta.inModal) {
      if (!activeModalKey) continue;
      if (String(meta.modalKey || '') !== String(activeModalKey || '')) continue;
    } else if (activeModalKey) {
      // Stay focused on the currently open modal for deterministic behavior.
      continue;
    }

    const key = `${meta.selectorPath}|${meta.text}|${meta.ariaLabel}|${meta.title}`;
    const seen = clickedByKey.get(key) || 0;
    if (seen >= MAX_PER_ELEMENT) continue;

    out.push({ locator, meta, key });
  }

  out.sort((a, b) => {
    const aSeen = clickedByKey.get(a.key) || 0;
    const bSeen = clickedByKey.get(b.key) || 0;
    if (aSeen !== bSeen) return aSeen - bSeen;
    return String(a.meta.selectorPath || '').localeCompare(String(b.meta.selectorPath || ''));
  });

  return out;
}

/**
 * @param {import('playwright').Page} page
 * @param {any} failure
 * @param {number} index
 */
async function saveFailureScreenshot(page, failure, index) {
  const safeName = String(failure.selectorPath || 'unknown')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 64);
  const fileName = `stress-fail-${String(index).padStart(3, '0')}-${safeName || 'element'}.png`;
  const fullPath = path.join(RESULTS_DIR, fileName);
  try {
    await page.screenshot({ path: fullPath, fullPage: true });
    return fullPath;
  } catch {
    return null;
  }
}

/** @param {import('playwright').Page} page */
async function maybeHandleAuth(page) {
  const overlay = page.locator('[data-auth-overlay="1"]');
  const needsAuth = await overlay.isVisible().catch(() => false);
  if (!needsAuth) return { skipped: false, reason: null };

  const email = process.env.TP3D_TEST_EMAIL || '';
  const password = process.env.TP3D_TEST_PASSWORD || '';
  if (!email || !password) {
    return {
      skipped: true,
      reason:
        'Auth overlay is visible. Provide TP3D_TEST_EMAIL and TP3D_TEST_PASSWORD to run interactions through login.',
    };
  }

  const emailInput = page.locator('[data-auth-overlay="1"] input[type="email"]').first();
  const passwordInput = page.locator('[data-auth-overlay="1"] input[type="password"]').first();
  const signInBtn = page
    .locator('[data-auth-overlay="1"] button')
    .filter({ hasText: /sign in/i })
    .first();

  await emailInput.fill(email, { timeout: 3000 });
  await passwordInput.fill(password, { timeout: 3000 });
  await signInBtn.click({ timeout: 3000 });

  await page
    .locator('.topbar, .sidebar, #screen-editor')
    .first()
    .waitFor({ state: 'visible', timeout: 12000 });
  return { skipped: false, reason: null };
}

async function main() {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    console.error('[stress] Playwright is not installed.');
    console.error('Install with: npm i -D playwright && npx playwright install chromium');
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }

  const url = process.env.TP3D_STRESS_URL || DEFAULT_URL;
  const maxClicks = Math.max(1, Number.parseInt(process.env.TP3D_STRESS_CLICKS || '40', 10) || 40);
  const headless = process.env.TP3D_STRESS_HEADLESS !== '0';

  const summary = {
    url,
    maxClicks,
    buttonsFound: 0,
    candidatesTried: 0,
    clicks: 0,
    failures: 0,
    skipped: 0,
    trialSkipped: 0,
    pageErrors: [],
    consoleErrors: [],
  };

  /** @type {Array<any>} */
  const failures = [];
  const clickedByKey = new Map();
  const failureByKey = new Map();

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('pageerror', err => {
    if (summary.pageErrors.length < 10) summary.pageErrors.push(err.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error' && summary.consoleErrors.length < 10) {
      summary.consoleErrors.push(msg.text());
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page
      .locator('.topbar, .sidebar, #screen-editor, [data-auth-overlay="1"]')
      .first()
      .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });

    const authState = await maybeHandleAuth(page);
    if (authState.skipped) {
      console.log('[stress] skipped:', authState.reason);
      return;
    }

    await waitForUiIdle(page);

    let activeModalKey = await getActiveModalKey(page);
    let cursor = 0;
    for (let step = 0; step < maxClicks; step += 1) {
      const candidates = await collectCandidates(page, activeModalKey, clickedByKey);
      summary.buttonsFound = await page.locator(CANDIDATE_SELECTOR).count();

      if (!candidates.length) {
        summary.skipped += 1;
        await waitForUiIdle(page);
        activeModalKey = await getActiveModalKey(page);
        continue;
      }

      let clickedThisStep = false;
      const attempts = Math.min(candidates.length, MAX_PICK_ATTEMPTS_PER_STEP);
      for (let pick = 0; pick < attempts; pick += 1) {
        const candidate = candidates[(cursor + pick) % candidates.length];
        summary.candidatesTried += 1;

        let trialOk = false;
        try {
          await candidate.locator.scrollIntoViewIfNeeded();
          await candidate.locator.click({ trial: true, timeout: TRIAL_TIMEOUT_MS });
          trialOk = true;
        } catch {
          summary.trialSkipped += 1;
          continue;
        }
        if (!trialOk) continue;

        try {
          await candidate.locator.click({ timeout: CLICK_TIMEOUT_MS });
          summary.clicks += 1;
          clickedByKey.set(candidate.key, (clickedByKey.get(candidate.key) || 0) + 1);
          clickedThisStep = true;
          cursor = (cursor + pick + 1) % Math.max(candidates.length, 1);
          break;
        } catch (err) {
          summary.failures += 1;
          const reason = err && err.message ? String(err.message) : String(err);
          const failure = {
            selectorPath: candidate.meta.selectorPath,
            text: candidate.meta.text,
            ariaLabel: candidate.meta.ariaLabel,
            title: candidate.meta.title,
            reason,
          };
          const screenshot = await saveFailureScreenshot(page, failure, failures.length + 1);
          if (screenshot) failure.screenshot = screenshot;
          failures.push(failure);

          const failKey = `${failure.selectorPath}|${failure.text}|${failure.ariaLabel}|${failure.title}`;
          const current = failureByKey.get(failKey) || { count: 0, sample: failure };
          current.count += 1;
          failureByKey.set(failKey, current);

          console.warn('[stress][click-failed]', failure);
          clickedThisStep = true;
          cursor = (cursor + pick + 1) % Math.max(candidates.length, 1);
          break;
        }
      }

      if (!clickedThisStep) summary.skipped += 1;

      await waitForUiIdle(page);
      activeModalKey = await getActiveModalKey(page);
    }
  } finally {
    await browser.close();
  }

  const topFailures = Array.from(failureByKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(item => ({
      count: item.count,
      selectorPath: item.sample.selectorPath,
      text: item.sample.text,
      ariaLabel: item.sample.ariaLabel,
      title: item.sample.title,
      reason: item.sample.reason,
    }));

  const logPath = path.join(RESULTS_DIR, `stress-summary-${Date.now()}.json`);
  await fs.writeFile(logPath, JSON.stringify({ summary, failures }, null, 2), 'utf8');

  console.log('\n[stress] summary');
  console.table([
    {
      url: summary.url,
      maxClicks: summary.maxClicks,
      buttonsFound: summary.buttonsFound,
      candidatesTried: summary.candidatesTried,
      clicks: summary.clicks,
      failures: summary.failures,
      skipped: summary.skipped,
      trialSkipped: summary.trialSkipped,
      pageErrors: summary.pageErrors.length,
      consoleErrors: summary.consoleErrors.length,
    },
  ]);

  if (topFailures.length) {
    console.log('\n[stress] top failing elements');
    console.table(topFailures);
  } else {
    console.log('\n[stress] no click failures recorded');
  }
  console.log(`[stress] detailed log: ${logPath}`);
}

main().catch(err => {
  console.error('[stress] fatal error');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
