import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Disposable Chromium fixture built from the real index.html overlay markup and
// pre-boot renderer. No app boot, no auth, no reloads; every network request is
// served from this allowlist or aborted.
const indexHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const overlayMarkup = ['error-overlay', 'system-overlay'].map(id => {
  const match = indexHtml.match(new RegExp(`    <div class="system-overlay" id="${id}">[\\s\\S]*?\\n    </div>\\n`));
  assert.ok(match, `${id} markup present in index.html`);
  return match[0];
}).join('');
const prebootScript = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('boot.showAppStatusOverlay ='));
assert.ok(prebootScript, 'pre-boot app-status renderer present in index.html');

test('P0-SM-OF-9 recovery, System and Error overlay lifecycle in real Chromium', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const modules = new Set([
    '/src/ui/ui-components.js', '/src/ui/modal-focus.js', '/src/ui/error-overlay.js',
    '/src/ui/system-overlay.js', '/src/ui/recoverable-error-overlay.js',
    '/src/ui/overlays/auth-overlay.js', '/styles/main.css',
  ]);
  const unexpected = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:5500') {
      unexpected.push(url.origin);
      return route.abort();
    }
    if (modules.has(url.pathname)) {
      await route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: await readFile(new URL(`../..${url.pathname}`, import.meta.url), 'utf8') });
    } else if (url.pathname === '/recovery-fixture') {
      const maintenance = url.searchParams.get('maintenance') === '1';
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <link rel="stylesheet" href="/styles/main.css"></head><body>
        <div id="app"><button id="before">Background</button></div>
        <div id="modal-root"></div><div id="toast-container"></div>
        ${overlayMarkup}
        <script>window.__TP3D_FLAGS__ = { maintenanceMode: ${maintenance} };</script>
        <script>${prebootScript}</script></body></html>` });
    } else {
      await route.abort();
    }
  });

  // Loads the static fixture; `boot` shares the modules and registry like app.js.
  const load = async (query = '') => {
    await page.goto(`http://localhost:5500/recovery-fixture${query}`);
    await page.evaluate(() => {
      window.calls = { escape: 0, back: 0 };
      document.addEventListener('keydown', event => { if (event.key === 'Escape') calls.escape++; });
      // Test-only synchronous probe: records any attempted removal of the shared
      // lock class while watched, even if it is re-added in the same task.
      window.unlocks = 0;
      const lockClass = 'tp3d-shared-modal-lock';
      const classes = document.body.classList;
      const remove = classes.remove.bind(classes);
      const toggle = classes.toggle.bind(classes);
      classes.remove = (...tokens) => {
        if (window.watchLock && tokens.includes(lockClass) && classes.contains(lockClass)) unlocks++;
        return remove(...tokens);
      };
      classes.toggle = (token, force) => {
        if (window.watchLock && token === lockClass && force !== true && classes.contains(lockClass)) unlocks++;
        return force === undefined ? toggle(token) : toggle(token, force);
      };
    });
  };
  const boot = () => page.evaluate(async () => {
    const { createUIComponents } = await import('/src/ui/ui-components.js');
    const { createErrorOverlay } = await import('/src/ui/error-overlay.js');
    const { createSystemOverlay } = await import('/src/ui/system-overlay.js');
    const { createRecoverableErrorOverlay } = await import('/src/ui/recoverable-error-overlay.js');
    const { createAuthOverlay } = await import('/src/ui/overlays/auth-overlay.js');
    window.ui = createUIComponents();
    window.errorOverlay = createErrorOverlay({ UIComponents: ui });
    window.systemOverlay = createSystemOverlay({ UIComponents: ui });
    errorOverlay.setOnBackToPacks(() => calls.back++);
    const BootState = window.__TP3D_BOOT;
    // Same handoff wiring as src/app.js.
    BootState.onAppStatusOverlayShown = errorOverlay.registerPresence;
    if (BootState.fatalOverlayShown || BootState.maintenanceMode) errorOverlay.registerPresence();
    window.appState = { currentScreen: 'packs', currentPackId: null, routeNotFound: false, packs: new Set() };
    window.recoverable = createRecoverableErrorOverlay({
      StateStore: { get: key => appState[key] },
      PackLibrary: { getById: id => (appState.packs.has(id) ? { id } : null) },
      ErrorOverlay: errorOverlay,
      BootState,
      getRouteNotFound: () => appState.routeNotFound,
    });
    window.auth = createAuthOverlay({ UIComponents: ui, SupabaseClient: { getUserSingleFlight: async () => null } });
    auth.setPhase('checking');
  });
  const snapshot = () => page.evaluate(() => {
    const activeOwner = ui.modalOwnership.getActiveOwner();
    const focused = document.activeElement;
    return {
      owners: ui.modalOwnership.getOwners().map(owner => owner.kind),
      active: activeOwner ? activeOwner.kind : null,
      focus: focused.id || focused.getAttribute('aria-label') || focused.textContent.trim() || focused.tagName,
      lock: document.body.classList.contains('tp3d-shared-modal-lock'),
      appInert: document.getElementById('app').hasAttribute('inert'),
      mode: document.getElementById('error-overlay').getAttribute('data-error-mode'),
      error: document.getElementById('error-overlay').classList.contains('active'),
      system: document.getElementById('system-overlay').classList.contains('active'),
    };
  });
  // Observable paint order: which overlay is hit at the viewport centre. Inert
  // nodes are skipped by hit testing, so lift inert for this one synchronous
  // probe and restore it before returning.
  const topmost = () => page.evaluate(() => {
    const inertNodes = [...document.querySelectorAll('[inert]')];
    inertNodes.forEach(node => node.removeAttribute('inert'));
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    inertNodes.forEach(node => node.setAttribute('inert', ''));
    if (hit?.closest('[data-auth-overlay]')) return 'auth';
    return hit?.closest('#system-overlay, #error-overlay')?.id || null;
  });
  const inert = selector => page.evaluate(selector => Boolean(document.querySelector(selector)?.closest('[inert]')), selector);
  const semantics = cardSelector => page.evaluate(cardSelector => {
    const card = document.querySelector(cardSelector);
    const title = document.getElementById(card.getAttribute('aria-labelledby'));
    return {
      role: card.getAttribute('role'), modal: card.getAttribute('aria-modal'),
      tabindex: card.getAttribute('tabindex'), title: title ? title.textContent.trim() : null,
      overlayHidden: card.parentElement.getAttribute('aria-hidden'),
    };
  }, cardSelector);
  const expectClean = async () => {
    const state = await snapshot();
    assert.deepEqual({ owners: state.owners, lock: state.lock, appInert: state.appInert,
      inert: await page.evaluate(() => document.querySelectorAll('[inert]').length) },
    { owners: [], lock: false, appInert: false, inert: 0 });
  };

  await t.test('System: one terminal owner, Try Again focus, contained Tab, Escape consumed, idempotent hide', async () => {
    await load();
    await boot();
    await page.focus('#before');
    await page.evaluate(() => systemOverlay.show({ title: 'WebGL required', message: 'm', items: ['a'] }));
    let state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.focus, state.lock, state.appInert],
      [['system'], 'system', 'system-retry', true, true]);
    assert.deepEqual(await semantics('.system-card'),
      { role: 'dialog', modal: 'true', tabindex: '-1', title: 'WebGL required', overlayHidden: null });
    await page.evaluate(() => systemOverlay.show({ title: 'Some app files could not load', items: ['b', 'c'] }));
    state = await snapshot();
    assert.deepEqual([state.owners, state.focus], [['system'], 'system-retry']);
    assert.equal(await page.locator('#system-list li').count(), 2);
    for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Escape']) {
      await page.keyboard.press(key);
      assert.equal((await snapshot()).focus, 'system-retry', `${key} stays on Try Again`);
    }
    assert.equal(await page.evaluate(() => calls.escape), 0, 'Escape does not fall through');
    assert.equal((await snapshot()).system, true);
    await page.evaluate(() => document.getElementById('before').focus());
    assert.equal((await snapshot()).focus, 'system-retry', 'background is not focusable');
    await page.evaluate(() => { systemOverlay.hide(); systemOverlay.hide(); });
    await expectClean();
    assert.notEqual((await snapshot()).focus, 'before', 'no stale focus restoration');
  });

  await t.test('Recoverable route/missing Pack: recoverable owner, Back focus, Escape kept, resolution releases', async () => {
    await load();
    await boot();
    await page.evaluate(() => { appState.routeNotFound = true; recoverable.syncRecoverableErrorOverlay(); });
    let state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.mode, state.focus, state.appInert],
      [['error'], 'error', 'route', 'Back to Load Plans', true]);
    assert.deepEqual(await semantics('.error-card'),
      { role: 'dialog', modal: 'true', tabindex: '-1', title: 'Page not found', overlayHidden: null });
    for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
      await page.keyboard.press(key);
      assert.equal((await snapshot()).focus, 'Back to Load Plans');
    }
    assert.deepEqual([(await snapshot()).error, await page.evaluate(() => calls.escape)], [true, 0]);
    // Repeated sync (every render) keeps one owner and a valid focus target.
    await page.evaluate(() => { recoverable.syncRecoverableErrorOverlay(); recoverable.syncRecoverableErrorOverlay(); });
    await page.evaluate(() => { appState.routeNotFound = false; Object.assign(appState, { currentScreen: 'editor', currentPackId: 'gone' }); recoverable.syncRecoverableErrorOverlay(); });
    state = await snapshot();
    assert.deepEqual([state.owners, state.mode, state.focus], [['error'], 'pack', 'Back to Load Plans']);
    assert.equal(await page.locator('#error-title').textContent(), 'Load plan not found');
    await page.evaluate(() => { appState.packs.add('gone'); recoverable.syncRecoverableErrorOverlay(); });
    await expectClean();
    assert.equal((await snapshot()).mode, null);
    // Back to Load Plans preserves its existing hide-then-navigate behavior.
    await page.evaluate(() => errorOverlay.showNotFound({ kind: 'pack' }));
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => calls.back), 1);
    await expectClean();
  });

  for (const [variant, title] of [['fatal', 'Something went wrong'], ['maintenance', "We'll be back soon"]]) {
    await t.test(`Terminal ${variant}: Reload focus, nondismissible, supersedes Auth and ordinary modal, survives recovery cleanup`, async () => {
      await load();
      await boot();
      await page.evaluate(() => {
        window.ordinary = ui.showModal({ title: 'Ordinary', content: '<input id="ordinary-field">' });
        auth.show();
      });
      assert.equal((await snapshot()).active, 'auth');
      await page.evaluate(variant => (variant === 'fatal' ? errorOverlay.showFatal({ message: 'Fixture failure' }) : errorOverlay.showMaintenance()), variant);
      const state = await snapshot();
      assert.deepEqual([state.active, state.mode, state.focus, state.owners.filter(kind => kind === 'error').length],
        ['error', variant, 'Reload', 1]);
      assert.equal((await semantics('.error-card')).title, title);
      assert.deepEqual([await inert('[data-auth-overlay]'), await inert('#ordinary-field')], [true, true]);
      // Visually on top of Auth as well as owning the keyboard.
      assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#error-overlay') !== null), true);
      for (const key of ['Tab', 'Shift+Tab', 'Escape']) {
        await page.keyboard.press(key);
        assert.equal((await snapshot()).focus, 'Reload');
      }
      assert.deepEqual([await page.evaluate(() => [calls.escape, auth.isOpen(), ordinary.overlay.isConnected])], [[0, true, true]]);
      // Recovery cleanup (router onScreen hide + sync) cannot hide or downgrade it,
      // even without the BootState guard.
      await page.evaluate(() => {
        errorOverlay.hide();
        appState.routeNotFound = true;
        errorOverlay.showNotFound({ kind: 'route' });
        appState.routeNotFound = false;
        recoverable.syncRecoverableErrorOverlay();
      });
      const after = await snapshot();
      assert.deepEqual([after.error, after.mode, after.active, after.focus], [true, variant, 'error', 'Reload']);
      await page.evaluate(() => { auth.hide(); ordinary.close(); errorOverlay.hide({ includeTerminal: true }); });
      await expectClean();
    });
  }

  await t.test('Precedence ordinary -> recoverable -> Auth -> System and back, with shared locks', async () => {
    await load();
    await boot();
    await page.evaluate(() => { window.ordinary = ui.showModal({ title: 'Ordinary', content: '<input id="ordinary-field">' }); });
    assert.deepEqual([(await snapshot()).active, (await snapshot()).focus], ['modal', 'ordinary-field']);
    await page.evaluate(() => { appState.routeNotFound = true; recoverable.syncRecoverableErrorOverlay(); });
    let state = await snapshot();
    assert.deepEqual([state.active, state.focus, await inert('#ordinary-field')], ['error', 'Back to Load Plans', true]);
    await page.keyboard.press('Escape');
    assert.deepEqual([(await snapshot()).error, await page.evaluate(() => ordinary.overlay.isConnected)], [true, true]);
    await page.evaluate(() => auth.show());
    state = await snapshot();
    assert.deepEqual([state.active, state.focus, await inert('#error-overlay')], ['auth', 'Authentication', true]);
    await page.evaluate(() => systemOverlay.show({ title: 'Editor unavailable' }));
    state = await snapshot();
    assert.deepEqual([state.active, state.focus, await inert('[data-auth-overlay]'), await inert('#error-overlay')],
      ['system', 'system-retry', true, true]);
    await page.evaluate(() => { window.watchLock = true; systemOverlay.hide(); });
    state = await snapshot();
    assert.deepEqual([state.active, state.lock, await inert('[data-auth-overlay]')], ['auth', true, false]);
    await page.evaluate(() => auth.hide());
    state = await snapshot();
    assert.deepEqual([state.active, state.lock, await inert('#error-overlay'), await inert('#ordinary-field')],
      ['error', true, false, true]);
    assert.notEqual(state.focus, 'ordinary-field', 'no stale focus into the covered modal');
    await page.keyboard.press('Tab');
    assert.equal((await snapshot()).focus, 'Back to Load Plans', 'recoverable resumes keyboard containment');
    await page.evaluate(() => { appState.routeNotFound = false; recoverable.syncRecoverableErrorOverlay(); });
    state = await snapshot();
    assert.deepEqual([state.active, state.lock, await inert('#ordinary-field')], ['modal', true, false]);
    assert.equal(await page.evaluate(() => unlocks), 0, 'lower/intermediate releases never unlocked the background');
    await page.evaluate(() => { window.watchLock = false; });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => ordinary.modal.contains(document.activeElement)), true,
      'surviving ordinary owner resumes keyboard containment');
    await page.keyboard.press('Escape');
    await expectClean();
  });

  await t.test('Mode transition recoverable -> fatal without Auth keeps one owner, terminal focus and no transient unlock', async () => {
    await load();
    await boot();
    await page.evaluate(() => { errorOverlay.showNotFound({ kind: 'pack' }); window.firstOwner = ui.modalOwnership.getActiveOwner(); });
    let state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.lock], [['error'], 'error', true], 'recoverable is the only owner; no Auth masks the lock');
    await page.evaluate(() => { window.watchLock = true; errorOverlay.showFatal(); window.watchLock = false; });
    state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.mode, state.focus, state.lock],
      [['error'], 'error', 'fatal', 'Reload', true]);
    assert.equal(await page.evaluate(() => ui.modalOwnership.getOwners().includes(firstOwner)), false,
      'recoverable owner is not left registered');
    assert.equal(await page.evaluate(() => unlocks), 0, 'no synchronous shared-lock removal during the transition');
    // Negative control: the probe does detect a real release of the last owner.
    await page.evaluate(() => { window.watchLock = true; errorOverlay.hide({ includeTerminal: true }); window.watchLock = false; });
    assert.equal(await page.evaluate(() => unlocks), 1, 'probe records an actual unlock');
    await expectClean();
  });

  await t.test('System then fatal Error: later Error owns keyboard and paint; repeated System.show cannot steal either', async () => {
    await load();
    await boot();
    await page.evaluate(() => { systemOverlay.show({ title: 'System' }); errorOverlay.showFatal(); });
    let state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.focus, await topmost(), await inert('#system-overlay')],
      [['system', 'error'], 'error', 'Reload', 'error-overlay', true]);
    await page.evaluate(() => systemOverlay.show({ title: 'System refreshed', items: ['x'] }));
    state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.focus, await topmost()],
      [['system', 'error'], 'error', 'Reload', 'error-overlay'], 'existing System owner is not re-stacked or focused');
    await page.evaluate(() => { window.watchLock = true; errorOverlay.hide({ includeTerminal: true }); });
    state = await snapshot();
    assert.deepEqual([state.active, state.lock, state.appInert, await inert('#system-overlay'), await topmost()],
      ['system', true, true, false, 'system-overlay']);
    await page.keyboard.press('Tab');
    assert.equal((await snapshot()).focus, 'system-retry');
    assert.equal(await page.evaluate(() => unlocks), 0);
    await page.evaluate(() => { window.watchLock = false; systemOverlay.hide(); });
    await expectClean();
  });

  await t.test('Fatal Error then System: later System owns keyboard and paint; active repeated show repairs focus', async () => {
    await load();
    await boot();
    await page.evaluate(() => { errorOverlay.showFatal(); systemOverlay.show({ title: 'System' }); });
    let state = await snapshot();
    assert.deepEqual([state.owners, state.active, state.focus, await topmost(), await inert('#error-overlay')],
      [['error', 'system'], 'system', 'system-retry', 'system-overlay', true]);
    // Displace focus, then a repeated show on the active System repairs it.
    await page.evaluate(() => document.getElementById('system-retry').blur());
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'focus displaced');
    await page.evaluate(() => systemOverlay.show({ title: 'System refreshed' }));
    state = await snapshot();
    assert.deepEqual([state.owners, state.focus, await topmost()], [['error', 'system'], 'system-retry', 'system-overlay']);
    // Hide and reopen gets a fresh owner/order normally.
    await page.evaluate(() => { systemOverlay.hide(); });
    assert.deepEqual([(await snapshot()).active, await topmost()], ['error', 'error-overlay']);
    await page.evaluate(() => systemOverlay.show({}));
    assert.deepEqual([(await snapshot()).active, (await snapshot()).focus, await topmost()], ['system', 'system-retry', 'system-overlay']);
    await page.evaluate(() => { systemOverlay.hide(); errorOverlay.hide({ includeTerminal: true }); });
    await expectClean();
    // No stale terminal stacking: a later recoverable Error stays below Auth.
    await page.evaluate(() => { errorOverlay.showNotFound({ kind: 'route' }); auth.show(); });
    assert.deepEqual([(await snapshot()).active, await topmost(),
      await page.evaluate(() => document.getElementById('error-overlay').style.zIndex)], ['auth', 'auth', '']);
    await page.evaluate(() => { auth.hide(); errorOverlay.hide(); });
    await expectClean();
  });

  for (const variant of ['fatal', 'maintenance']) {
    await t.test(`Pre-boot ${variant} works without modules and hands off to one terminal owner`, async () => {
      const maintenance = variant === 'maintenance';
      await load(maintenance ? '?maintenance=1' : '');
      await page.focus('#before');
      await page.evaluate(variant => window.__TP3D_BOOT.showAppStatusOverlay(variant, { message: 'Pre-boot failure' }), variant);
      // Basic static dialog before any module exists.
      assert.deepEqual(await semantics('.error-card'), {
        role: 'dialog', modal: 'true', tabindex: '-1',
        title: maintenance ? "We'll be back soon" : 'Something went wrong', overlayHidden: null,
      });
      assert.deepEqual(await page.evaluate(() => [document.activeElement.textContent, document.getElementById('error-overlay').getAttribute('data-error-mode')]),
        ['Reload', variant]);
      const body = await page.locator('#error-body').textContent();
      const reloadHandle = await page.evaluateHandle(() => document.querySelector('#error-actions button'));
      await boot();
      let state = await snapshot();
      assert.deepEqual([state.owners, state.active, state.focus, state.lock, state.appInert],
        [['error'], 'error', 'Reload', true, true]);
      assert.equal(await page.locator('#error-body').textContent(), body, 'content preserved');
      assert.equal(await reloadHandle.evaluate(button => button.isConnected && document.activeElement === button), true,
        'pre-boot Reload control is kept, not re-rendered');
      await page.evaluate(() => { errorOverlay.registerPresence(); window.__TP3D_BOOT.onAppStatusOverlayShown(); auth.show(); });
      state = await snapshot();
      assert.deepEqual([state.owners.filter(kind => kind === 'error').length, state.active, state.focus],
        [1, 'error', 'Reload'], 'terminal precedence above Auth after handoff');
      assert.equal(await topmost(), 'error-overlay', 'handoff keeps the terminal painted above Auth');
      await page.keyboard.press('Escape');
      assert.equal((await snapshot()).error, true);
      await page.evaluate(() => { auth.hide(); errorOverlay.hide({ includeTerminal: true }); });
      await expectClean();
    });
  }

  await t.test('Pre-boot fatal after app boot upgrades a visible recoverable overlay to terminal', async () => {
    await load();
    await boot();
    await page.evaluate(() => { errorOverlay.showNotFound({ kind: 'route' }); window.watchLock = true; });
    await page.evaluate(() => window.__TP3D_BOOT.showAppStatusOverlay('fatal'));
    const state = await snapshot();
    assert.deepEqual([state.owners, state.mode, state.focus], [['error'], 'fatal', 'Reload']);
    await page.evaluate(() => auth.show());
    assert.equal((await snapshot()).active, 'error', 'upgraded owner supersedes Auth');
    await page.evaluate(() => { errorOverlay.hide(); recoverable.syncRecoverableErrorOverlay(); auth.hide(); });
    assert.equal((await snapshot()).mode, 'fatal', 'recovery cleanup cannot clear pre-boot fatal');
    assert.equal(await page.evaluate(() => unlocks), 0);
    await page.evaluate(() => { window.watchLock = false; errorOverlay.hide({ includeTerminal: true }); });
    await expectClean();
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
});
