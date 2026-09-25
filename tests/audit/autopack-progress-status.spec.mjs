import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// P0-SM-OF-10B: the AutoPack running surface is a NON-MODAL status. Disposable
// Chromium fixture using the production UIComponents, modal ownership,
// Error/System/Auth overlays, OperationLifecycle, main.css and the vendored
// Font Awesome CSS. No app boot, no auth, no AutoPack run, no real data; every
// request is served from this allowlist or aborted.
const indexHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const overlayMarkup = ['error-overlay', 'system-overlay'].map(id => {
  const match = indexHtml.match(new RegExp(`    <div class="system-overlay" id="${id}">[\\s\\S]*?\\n    </div>\\n`));
  assert.ok(match, `${id} markup present in index.html`);
  return match[0];
}).join('');
const prebootScript = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('boot.showAppStatusOverlay ='));
assert.ok(prebootScript, 'pre-boot app-status renderer present in index.html');

const LONG_RUNNING = 'AutoPack is still working. Large or complex loads can take longer.';
// The status helper's production long-running threshold (AUTOPACK_STATUS_LONG_RUNNING_MS).
const NOTICE_MS = 90000;

test('P0-SM-OF-10B AutoPack progress status is non-modal in real Chromium', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const files = new Map([
    ['/src/ui/ui-components.js', 'text/javascript'], ['/src/ui/modal-focus.js', 'text/javascript'],
    ['/src/ui/error-overlay.js', 'text/javascript'], ['/src/ui/system-overlay.js', 'text/javascript'],
    ['/src/ui/overlays/auth-overlay.js', 'text/javascript'],
    ['/src/core/operation-lifecycle.js', 'text/javascript'],
    ['/styles/main.css', 'text/css'], ['/vendor/fontawesome.min.css', 'text/css'],
    ['/media/autopack-loading-truck-480w.gif', 'image/gif'],
  ]);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:5500') return route.abort();
    if (files.has(url.pathname)) {
      const binary = url.pathname.endsWith('.gif');
      await route.fulfill({ contentType: files.get(url.pathname),
        body: await readFile(new URL(`../..${url.pathname}`, import.meta.url), binary ? undefined : 'utf8') });
    } else if (url.pathname === '/autopack-status-fixture') {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <link rel="stylesheet" href="/vendor/fontawesome.min.css">
        <link rel="stylesheet" href="/styles/main.css"></head><body>
        <div id="app">
          <button id="before">Before</button>
          <div id="scene" style="position:fixed;inset:48px 0 0 0;background:#dfe7ef"></div>
          <button id="after" style="position:fixed;left:8px;bottom:8px">After</button>
        </div>
        <div id="modal-root"></div><div id="toast-container"></div>
        ${overlayMarkup}
        <script>${prebootScript}</script></body></html>` });
    } else {
      await route.abort();
    }
  });

  const load = async () => {
    await page.goto('http://localhost:5500/autopack-status-fixture');
    await page.evaluate(async noticeMs => {
      // Timer probe: records every timeout the page creates, clears and fires,
      // and any interval, so tests can prove no status timer outlives close().
      // The status's long-running notice timeout (its production default) is held
      // instead of scheduled: tests elapse the threshold explicitly, so notice
      // behaviour never races wall-clock time.
      window.timers = { pending: new Set(), held: new Map(), intervals: 0 };
      let heldSeq = 0;
      const set = window.setTimeout.bind(window);
      const clear = window.clearTimeout.bind(window);
      const interval = window.setInterval.bind(window);
      window.setTimeout = (fn, ms, ...args) => {
        if (ms === noticeMs) {
          const id = `held-${++heldSeq}`;
          timers.held.set(id, () => fn(...args));
          timers.pending.add(id);
          return id;
        }
        const id = set(() => { timers.pending.delete(id); fn(...args); }, ms);
        timers.pending.add(id);
        return id;
      };
      window.clearTimeout = id => { timers.pending.delete(id); timers.held.delete(id); clear(id); };
      window.elapseNoticeThreshold = () => {
        for (const [id, fire] of [...timers.held]) {
          timers.held.delete(id);
          timers.pending.delete(id);
          fire();
        }
      };
      window.setInterval = (...args) => { timers.intervals += 1; return interval(...args); };
      window.calls = { escape: 0, scenePointer: 0 };
      document.addEventListener('keydown', event => { if (event.key === 'Escape') calls.escape++; });
      document.getElementById('scene').addEventListener('pointerdown', () => calls.scenePointer++);
      const { createUIComponents } = await import('/src/ui/ui-components.js');
      const { createErrorOverlay } = await import('/src/ui/error-overlay.js');
      const { createSystemOverlay } = await import('/src/ui/system-overlay.js');
      const { createAuthOverlay } = await import('/src/ui/overlays/auth-overlay.js');
      const { createOperationLifecycle } = await import('/src/core/operation-lifecycle.js');
      window.ui = createUIComponents();
      window.errorOverlay = createErrorOverlay({ UIComponents: ui });
      window.systemOverlay = createSystemOverlay({ UIComponents: ui });
      window.__TP3D_BOOT.onAppStatusOverlayShown = errorOverlay.registerPresence;
      window.auth = createAuthOverlay({ UIComponents: ui, SupabaseClient: { getUserSingleFlight: async () => null } });
      auth.setPhase('checking');
      window.lifecycle = createOperationLifecycle();
      window.openStatus = options => {
        window.opToken = lifecycle.beginOperation('autopacking', { packId: 'fixture' });
        window.apStatus = ui.showAutoPackLoadingOverlay({ initialMessage: 'Checking fit, stacking, and safety rules...', ...options });
        window.mutations = 0;
        const node = apStatus.overlay.querySelector('.autopack-loading-message');
        new MutationObserver(records => { mutations += records.length; })
          .observe(node, { childList: true, characterData: true, subtree: true });
        return true;
      };
    }, NOTICE_MS);
  };
  const state = () => page.evaluate(() => {
    const root = document.querySelector('[data-tp3d-autopack-loading]');
    const message = root ? root.querySelector('.autopack-loading-message') : null;
    return {
      present: Boolean(root?.isConnected),
      owners: ui.modalOwnership.getOwners().map(owner => owner.kind),
      lock: document.body.classList.contains('tp3d-shared-modal-lock'),
      modalOpen: document.body.classList.contains('modal-open'),
      inert: document.querySelectorAll('[inert]').length,
      appInert: document.getElementById('app').hasAttribute('inert'),
      focus: document.activeElement.id || document.activeElement.tagName,
      message: message ? message.textContent : null,
      opCurrent: lifecycle.isCurrent(opToken),
    };
  });
  // Paint order at a point: which surface would receive the hit if the status
  // accepted pointers. Inert and pointer-events are lifted for this one
  // synchronous probe only, then restored.
  const paintedAt = (x, y) => page.evaluate(([x, y]) => {
    const inertNodes = [...document.querySelectorAll('[inert]')];
    inertNodes.forEach(node => node.removeAttribute('inert'));
    const status = document.querySelector('[data-tp3d-autopack-loading]');
    const touched = status ? [status, ...status.querySelectorAll('*')] : [];
    touched.forEach(node => { node.style.pointerEvents = 'auto'; });
    const hit = document.elementFromPoint(x, y);
    touched.forEach(node => { node.style.pointerEvents = ''; });
    inertNodes.forEach(node => node.setAttribute('inert', ''));
    if (!hit) return null;
    if (hit.closest('[data-tp3d-autopack-loading]')) return 'status';
    if (hit.closest('[data-auth-overlay]')) return 'auth';
    if (hit.closest('#system-overlay, #error-overlay')) return hit.closest('#system-overlay, #error-overlay').id;
    if (hit.closest('.modal-overlay')) return 'modal';
    return hit.id || hit.tagName;
  }, [x, y]);
  const statusCenter = () => page.evaluate(() => {
    const box = document.querySelector('.autopack-loading-modal').getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  });

  await t.test('named non-modal status: zero owners, no dialog/aria-modal, no lock/inert, focus kept', async () => {
    await load();
    await page.focus('#before');
    await page.evaluate(() => openStatus());
    const s = await state();
    assert.deepEqual([s.present, s.owners, s.lock, s.modalOpen, s.inert, s.focus],
      [true, [], false, false, 0, 'before']);
    const semantics = await page.evaluate(() => {
      const root = document.querySelector('[data-tp3d-autopack-loading]');
      const labelled = root.querySelector('[aria-labelledby]');
      return {
        dialogs: root.querySelectorAll('[role="dialog"], [aria-modal]').length + (root.matches('[role="dialog"], [aria-modal]') ? 1 : 0),
        tag: labelled.tagName,
        name: document.getElementById(labelled.getAttribute('aria-labelledby')).textContent,
        live: [...root.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].length,
        busy: root.querySelectorAll('[aria-busy]').length,
        focusable: root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length,
        classes: root.className,
      };
    });
    assert.deepEqual(semantics, { dialogs: 0, tag: 'SECTION', name: 'Building your load plan',
      live: 1, busy: 0, focusable: 0, classes: 'autopack-loading-overlay' });
    assert.equal(s.message, 'Checking fit, stacking, and safety rules...');
  });

  await t.test('Tab / Shift+Tab stay normal page order; Escape neither closes status nor touches the operation', async () => {
    await page.focus('#before');
    await page.keyboard.press('Tab');
    assert.equal((await state()).focus, 'after');
    await page.keyboard.press('Shift+Tab');
    assert.equal((await state()).focus, 'before');
    await page.keyboard.press('Escape');
    const s = await state();
    assert.deepEqual([s.present, s.opCurrent, s.focus], [true, true, 'before']);
    assert.equal(await page.evaluate(() => calls.escape), 1, 'Escape reaches the normal document context');
  });

  await t.test('pointer passes through the wrapper to the Editor scene; the card absorbs its own clicks', async () => {
    const [cx, cy] = await statusCenter();
    const cardTop = await page.evaluate(() => document.querySelector('.autopack-loading-modal').getBoundingClientRect().top);
    for (const [x, y] of [[40, 400], [1240, 780], [cx, cardTop - 20]]) {
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [x, y]),
        'scene', `wrapper hit test at ${x},${y}`);
    }
    assert.equal(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.autopack-loading-modal')),
      [cx, cy]), true, 'the card takes its own hit test');
    await page.mouse.move(40, 400);
    await page.mouse.down();
    await page.mouse.move(100, 420);
    await page.mouse.up();
    await page.mouse.click(1240, 780);
    await page.mouse.click(cx, cy);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 20);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => calls.scenePointer), 2,
      'camera drag + click outside the card reach the scene; a click or drag on the card does not');
    const styles = await page.evaluate(() => {
      const wrapper = getComputedStyle(document.querySelector('.autopack-loading-overlay'));
      const card = getComputedStyle(document.querySelector('.autopack-loading-modal'));
      return { bg: wrapper.backgroundColor, filter: wrapper.backdropFilter, pe: wrapper.pointerEvents, cardPe: card.pointerEvents };
    });
    assert.deepEqual(styles, { bg: 'rgba(0, 0, 0, 0)', filter: 'none', pe: 'none', cardPe: 'auto' });
    const s = await state();
    assert.deepEqual([s.owners, s.lock, s.inert], [[], false, 0], 'absorbing clicks adds no modal behaviour');
    assert.equal(await paintedAt(cx, cy), 'status', 'status paints above Editor content');
  });

  await t.test('ordinary modal paints above status, owns keyboard, and status close keeps its lock', async () => {
    await page.focus('#before');
    await page.evaluate(() => {
      window.dialog = ui.showModal({ title: 'Ordinary dialog', content: '<p>Body</p>',
        actions: [{ label: 'OK', variant: 'primary' }] });
    });
    const [cx, cy] = await statusCenter();
    assert.equal(await paintedAt(cx, cy), 'modal');
    let s = await state();
    assert.deepEqual([s.owners.length, s.lock], [1, true]);
    const inModal = () => page.evaluate(() => Boolean(document.activeElement.closest('.modal-overlay')));
    assert.equal(await inModal(), true, 'modal took focus');
    for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      assert.equal(await inModal(), true, `${key} contained by the modal`);
    }
    await page.evaluate(() => apStatus.close());
    s = await state();
    assert.deepEqual([s.present, s.owners.length, s.lock], [false, 1, true], 'status close releases nothing');
    await page.keyboard.press('Escape');
    s = await state();
    assert.deepEqual([s.owners, s.lock, s.inert], [[], false, 0]);
    assert.equal(s.opCurrent, true, 'Escape never released AutoPack');
    await page.evaluate(() => lifecycle.finishOperation(opToken));
  });

  for (const [label, show, expected] of [
    ['recoverable Error', () => errorOverlay.showNotFound({ kind: 'route' }), 'error-overlay'],
    ['Auth', () => auth.show(), 'auth'],
    ['terminal System', () => systemOverlay.show({ title: 'WebGL required', message: 'm', items: ['a'] }), 'system-overlay'],
  ]) {
    await t.test(`${label} paints above status and owns interaction; status close keeps it`, async () => {
      await load();
      await page.focus('#before');
      await page.evaluate(() => openStatus());
      const [cx, cy] = await statusCenter();
      await page.evaluate(show);
      assert.equal(await paintedAt(cx, cy), expected);
      const before = await state();
      assert.equal(before.owners.length, 1);
      assert.equal(before.lock, true);
      assert.notEqual(before.focus, 'before', 'blocker owns focus');
      await page.evaluate(() => { apStatus.close(); apStatus.close(); });
      const after = await state();
      // The removed status node may itself have been inert; the blocker's
      // isolation of the application must be untouched.
      assert.deepEqual([after.present, after.owners, after.lock, after.appInert, after.focus],
        [false, before.owners, true, true, before.focus]);
    });
  }

  await t.test('long-running notice appears once at the threshold, keeps the status and operation, and close is idempotent', async () => {
    await load();
    await page.evaluate(() => openStatus());
    assert.deepEqual(await page.evaluate(() => [timers.pending.size, timers.held.size]), [1, 1],
      'one notice timer at the production threshold');
    let s = await state();
    assert.equal(s.message, 'Checking fit, stacking, and safety rules...', 'no notice before the threshold');
    assert.equal(await page.evaluate(() => mutations), 0);
    await page.evaluate(() => elapseNoticeThreshold());
    s = await state();
    assert.deepEqual([s.present, s.message, s.opCurrent, s.owners], [true, LONG_RUNNING, true, []]);
    assert.equal(await page.evaluate(() => mutations), 1, 'announced once');
    await page.evaluate(() => elapseNoticeThreshold());
    assert.equal(await page.evaluate(() => mutations), 1, 'never repeats');
    assert.equal(await page.evaluate(() => timers.pending.size), 0);
    await page.evaluate(() => { apStatus.close(); apStatus.close(); apStatus.setMessage('Late stage'); });
    s = await state();
    assert.equal(s.present, false);
    assert.equal(await page.evaluate(() => apStatus.overlay.querySelector('.autopack-loading-message').textContent), LONG_RUNNING);
    assert.equal(await page.evaluate(() => mutations), 1, 'no detached live-region update');
    assert.equal(await page.evaluate(() => timers.intervals), 0, 'no rotating message interval');
  });

  await t.test('close before threshold clears the notice; explicit stages update once, duplicates do not rewrite', async () => {
    await load();
    await page.evaluate(() => openStatus());
    await page.evaluate(() => {
      apStatus.setMessage('Placing cargo in the truck...');
      apStatus.setMessage('Placing cargo in the truck...');
    });
    assert.equal((await state()).message, 'Placing cargo in the truck...');
    assert.equal(await page.evaluate(() => mutations), 1, 'duplicate stage is not rewritten');
    await page.evaluate(() => { apStatus.close(); apStatus.setMessage('Late stage'); });
    assert.deepEqual(await page.evaluate(() => [timers.pending.size, timers.held.size]), [0, 0], 'notice timer cleared on close');
    await page.evaluate(() => elapseNoticeThreshold());
    assert.equal(await page.evaluate(() => apStatus.overlay.querySelector('.autopack-loading-message').textContent),
      'Placing cargo in the truck...', 'the notice never appears after an early close');
    assert.equal(await page.evaluate(() => mutations), 1);
    assert.equal(await page.evaluate(() => timers.intervals), 0);
  });

  const visualStyles = () => page.evaluate(() => {
    const q = selector => getComputedStyle(document.querySelector(selector));
    return {
      image: q('.autopack-loading-image').display,
      fallback: q('.autopack-loading-fallback').display,
      spinner: q('.autopack-loading-fallback .fa-spinner').animationName,
      progress: q('.autopack-loading-progress span').animationName,
    };
  });
  const openWithImage = async () => {
    await load();
    await page.evaluate(() => openStatus());
    await page.waitForFunction(() => document.querySelector('.autopack-loading-visual')?.classList.contains('has-image'));
  };

  await t.test('reduced motion swaps the GIF for the static fallback and stops spinner and progress', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWithImage();
    assert.deepEqual(await visualStyles(), { image: 'none', fallback: 'grid', spinner: 'none', progress: 'none' });
    await page.evaluate(() => {
      const img = document.querySelector('.autopack-loading-image');
      img.dispatchEvent(new Event('error'));
    });
    assert.equal((await visualStyles()).spinner, 'none', 'image-error fallback does not spin either');
    await page.evaluate(() => apStatus.close());
  });

  await t.test('normal motion keeps the existing animated visual and progress strip', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openWithImage();
    assert.deepEqual(await visualStyles(),
      { image: 'block', fallback: 'none', spinner: 'fa-spin', progress: 'autopack-loading-progress' });
  });

  await t.test('visual: card fully visible at desktop and narrow widths with no locking backdrop', async () => {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 740 }]) {
      await page.setViewportSize(viewport);
      const box = await page.evaluate(() => {
        const r = document.querySelector('.autopack-loading-modal').getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      assert.ok(box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height,
        `card inside ${viewport.width}px viewport: ${JSON.stringify(box)}`);
      if (process.env.TP3D_10B_SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.TP3D_10B_SCREENSHOTS}/status-${viewport.width}.png` });
      }
    }
    await page.evaluate(() => apStatus.close());
  });

  assert.deepEqual(errors, []);
});
