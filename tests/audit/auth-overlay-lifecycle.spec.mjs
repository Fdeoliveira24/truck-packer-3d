import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Disposable Chromium context, no app boot or real auth. Every network request
// is either fulfilled from this allowlist or aborted, including localhost.
test('P0-SM-OF-8 isolated Auth lifecycle in real Chromium', { timeout: 45000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  await page.clock.install();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const allowed = new Set([
    '/src/ui/overlays/auth-overlay.js', '/src/ui/ui-components.js',
    '/src/ui/modal-focus.js', '/src/ui/keyboard-manager.js', '/styles/main.css',
  ]);
  const unexpected = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:5500') {
      unexpected.push(url.origin);
      return route.abort();
    }
    if (allowed.has(url.pathname)) {
      await route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: await readFile(new URL(`../..${url.pathname}`, import.meta.url), 'utf8') });
    } else if (url.pathname === '/auth-lifecycle-fixture') {
      await route.fulfill({ contentType: 'text/html', body: `
        <link rel="stylesheet" href="/styles/main.css">
        <div id="app"><button id="before">Old page</button><button id="after">New page</button></div>
        <div id="modal-root"></div><div id="toast-container"></div>` });
    } else {
      // Font/image URLs in the application CSS are not fixture dependencies.
      await route.abort();
    }
  });
  const setup = async (phase = 'form', show = true) => {
    await page.goto('http://localhost:5500/auth-lifecycle-fixture');
    await page.evaluate(async ({ phase, show }) => {
      const { createUIComponents } = await import('/src/ui/ui-components.js');
      const { createAuthOverlay } = await import('/src/ui/overlays/auth-overlay.js');
      const { createKeyboardManager } = await import('/src/ui/keyboard-manager.js');
      window.ui = createUIComponents();
      window.calls = { deselect: 0, selectAll: 0, escape: 0, retries: 0 };
      const state = { currentScreen: 'editor', selectedInstanceIds: ['fixture'] };
      createKeyboardManager({ UIComponents: ui,
        StateStore: { get: key => state[key], set: patch => Object.assign(state, patch) },
        CaseScene: { setSelected: () => calls.deselect++ },
        InteractionManager: { selectAllInPack: () => calls.selectAll++ },
      }).init();
      document.addEventListener('keydown', event => { if (event.key === 'Escape') calls.escape++; });
      // Record only listeners/timers installed by Auth, retaining removed
      // callbacks so tests can deliberately deliver obsolete work.
      window.tracked = { listeners: [], timers: new Map(), history: [], frames: 0 };
      for (const target of [window, document]) {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        target.addEventListener = (type, callback, options) => {
          tracked.listeners.push({ target, type, callback, active: true });
          add(type, callback, options);
        };
        target.removeEventListener = (type, callback, options) => {
          for (const item of tracked.listeners) {
            if (item.target === target && item.type === type && item.callback === callback) item.active = false;
          }
          remove(type, callback, options);
        };
      }
      const timeout = window.setTimeout.bind(window);
      const clear = window.clearTimeout.bind(window);
      window.setTimeout = (callback, ms, ...args) => {
        const record = { callback: () => callback(...args), ms };
        const id = timeout(() => { tracked.timers.delete(id); record.callback(); }, ms);
        record.fire = () => { clear(id); tracked.timers.delete(id); record.callback(); };
        tracked.timers.set(id, record);
        tracked.history.push(record);
        return id;
      };
      window.clearTimeout = id => { tracked.timers.delete(id); clear(id); };
      const frame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => { tracked.frames++; return frame(callback); };
      window.requests = [];
      window.pending = [];
      window.api = {};
      for (const method of ['signIn', 'signUp', 'resendConfirmation', 'resetPasswordForEmail', 'updateUserPassword', 'signInWithOAuth']) {
        api[method] = (...args) => {
          requests.push({ method, args });
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        };
      }
      api.getUserSingleFlight = async () => null;
      api.signOut = async () => { requests.push({ method: 'signOut' }); };
      window.auth = createAuthOverlay({ UIComponents: ui, SupabaseClient: api });
      auth.setPhase(phase, { onRetry: () => calls.retries++ });
      document.getElementById('before').focus();
      if (show) auth.show();
    }, { phase, show });
  };
  const key = name => page.locator(`[data-auth-focus="${name}"]`);
  const active = () => page.evaluate(() => document.activeElement.getAttribute('data-auth-focus') || document.activeElement.getAttribute('aria-label') || document.activeElement.id);
  const settle = (value = {}) => page.evaluate(value => pending.shift().resolve(value), value);
  const reject = () => page.evaluate(() => pending.shift().reject(new Error('fixture failure')));
  const offline = value => page.evaluate(value => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: !value });
    window.dispatchEvent(new Event(value ? 'offline' : 'online'));
  }, value);
  const signup = async () => {
    await key('signup').click();
    await key('email').fill('fixture@example.invalid');
    await key('password').fill('Fixture-Password-42');
    await key('password-confirm').fill('Fixture-Password-42');
    await key('submit').click();
  };
  const reset = async () => {
    await page.evaluate(() => auth.showResetPassword());
    await key('password').fill('Fixture-Password-42');
    await key('password-confirm').fill('Fixture-Password-42');
    await key('submit').click();
  };
  const cleanup = async () => {
    await page.evaluate(() => { auth.hide(); auth.hide(); });
    assert.deepEqual(await page.evaluate(() => ({
      owners: ui.modalOwnership.getOwners().length,
      locks: document.body.classList.contains('tp3d-shared-modal-lock'),
      inert: document.querySelectorAll('[inert]').length,
      timers: tracked.timers.size,
      listeners: tracked.listeners.filter(item => item.active).length,
      frames: tracked.frames,
    })), { owners: 0, locks: false, inert: 0, timers: 0, listeners: 0, frames: 0 });
  };

  await t.test('hide before show never mounts; repeated show/hide owns and releases once', async () => {
    await setup('checking', false);
    await page.evaluate(() => { auth.hide(); auth.hide(); });
    assert.equal(await page.locator('[data-auth-overlay]').count(), 0);
    await page.evaluate(() => {
      auth.show();
      window.firstOwner = ui.modalOwnership.getActiveOwner();
      window.firstPage = document.querySelector('.auth-page');
      auth.show(); auth.show();
    });
    assert.deepEqual(await page.evaluate(() => ({
      count: ui.modalOwnership.getOwners().length,
      sameOwner: firstOwner === ui.modalOwnership.getActiveOwner(),
      samePage: firstPage === document.querySelector('.auth-page'),
      root: firstOwner.focusRoot.getAttribute('aria-label'),
      priority: firstOwner.priority, parent: firstOwner.parentId,
      keydown: tracked.listeners.filter(item => item.type === 'keydown').length,
      network: tracked.listeners.filter(item => item.active).length,
    })), { count: 1, sameOwner: true, samePage: true, root: 'Authentication', priority: 2, parent: null, keydown: 0, network: 2 });
    await cleanup();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => auth.show());
      await cleanup();
    }
  });

  await t.test('checking focuses the accessible root and contains Tab and Escape', async () => {
    await setup('checking');
    assert.equal(await active(), 'Authentication');
    assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'), 'true');
    for (const keypress of ['Tab', 'Shift+Tab', 'Escape', 'Control+a']) {
      await page.keyboard.press(keypress);
      assert.equal(await active(), 'Authentication');
    }
    assert.deepEqual(await page.evaluate(() => [calls.deselect, calls.selectAll, calls.escape, auth.isOpen()]), [0, 0, 0, true]);
    await page.evaluate(() => document.getElementById('before').focus());
    assert.equal(await active(), 'Authentication', 'native inert blocks background focus');
    await cleanup();
  });

  await t.test('all form and phase transitions select the new task, including recovery while already open', async () => {
    await setup('checking');
    await page.evaluate(() => auth.setPhase('form'));
    assert.equal(await active(), 'email');
    await key('password').fill('Old-password-42');
    await key('signup').click();
    assert.equal(await active(), 'email');
    assert.equal(await key('password').inputValue(), '');
    await key('signin').click();
    await key('forgot').click();
    assert.equal(await active(), 'email');
    await page.evaluate(() => auth.showResetPassword());
    assert.equal(await active(), 'password');
    await key('password-confirm').focus();
    await page.evaluate(() => auth.setPhase('cantconnect'));
    assert.equal(await active(), 'retry');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => calls.retries), 1);
    await page.evaluate(() => auth.setPhase('checking'));
    assert.equal(await active(), 'Authentication');
    await page.evaluate(() => auth.showAccountDisabled('Fixture disabled notice'));
    assert.equal(await active(), 'email');
    assert.equal(await page.getByRole('alert').textContent(), 'Fixture disabled notice');
    await cleanup();
  });

  await t.test('native forward and reverse Tab stay within every Auth view', async () => {
    await setup();
    const wrap = async (first, last) => {
      await key(last).focus();
      await page.keyboard.press('Tab');
      assert.equal(await active(), first);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await active(), last);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => auth.isOpen()), true);
    };
    await wrap('email', 'signup');
    await key('signup').click();
    await wrap('email', 'signin');
    await key('signin').click();
    await key('forgot').click();
    await wrap('email', 'signin');
    await page.evaluate(() => auth.showResetPassword());
    await wrap('password', 'submit');
    await page.evaluate(() => auth.setPhase('cantconnect'));
    await wrap('retry', 'retry');
    await cleanup();
  });

  await t.test('same-view offline/online renders retain logical focus and all typed fields', async () => {
    await setup();
    await key('password').focus();
    await page.evaluate(() => {
      window.currentPage = document.querySelector('.auth-page');
      auth.setPhase('form'); auth.show();
    });
    assert.equal(await active(), 'password');
    assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
    await key('password-toggle').click();
    for (const target of ['email', 'password', 'password-toggle', 'forgot', 'signup']) {
      await key('email').fill('fixture@example.invalid');
      await key('password').fill('Fixture-Password-42');
      await key(target).focus();
      await page.evaluate(() => { window.oldControl = document.activeElement; });
      await offline(true);
      assert.equal(await active(), target);
      assert.equal(await page.evaluate(() => oldControl.isConnected), false, 'real DOM replacement');
      assert.equal(await key('email').inputValue(), 'fixture@example.invalid');
      assert.equal(await key('password').inputValue(), 'Fixture-Password-42');
      assert.equal(await key('password').getAttribute('type'), 'text', 'revealed password remains preserved');
      assert.equal(await key('submit').isDisabled(), true);
      await offline(false);
      assert.equal(await active(), target);
      assert.equal(await key('submit').isEnabled(), true);
    }
    await key('signup').click();
    await key('password').fill('Fixture-Password-42');
    await key('password-confirm').fill('Fixture-Password-42');
    await offline(true);
    assert.equal(await active(), 'password-confirm');
    assert.equal(await key('password-confirm').inputValue(), 'Fixture-Password-42');
    await offline(false);
    await key('password-confirm').fill('');
    await offline(true);
    assert.equal(await key('password-confirm').inputValue(), '', 'cleared fields stay cleared');
    await page.evaluate(() => auth.setPhase('cantconnect'));
    await offline(false);
    assert.equal(await active(), 'retry');
    await cleanup();
  });

  await t.test('confirmation initial action, fallback during resend cooldown, and same-view action focus', async () => {
    await setup();
    await signup();
    await settle({ session: null });
    assert.equal(await active(), 'resend');
    await key('signin').focus();
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'resend');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'signin');
    await key('resend').click();
    await settle();
    assert.equal(await active(), 'signin', 'disabled resend falls back to enabled action');
    await page.evaluate(() => tracked.history.at(-1).fire());
    assert.equal(await active(), 'signin');
    await offline(true);
    assert.equal(await active(), 'signin');
    await cleanup();
  });

  await t.test('same-view rerender during a request keeps the lock and displays completion on the replacement DOM', async () => {
    await setup();
    await key('email').fill('fixture@example.invalid');
    await key('password').fill('Fixture-Password-42');
    await key('submit').click();
    await key('password').focus();
    await offline(true);
    await offline(false);
    assert.equal(await key('submit').isDisabled(), true);
    await reject();
    assert.equal(await active(), 'password');
    assert.match(await page.getByRole('alert').textContent(), /fixture failure/);
    assert.equal(await key('submit').isEnabled(), true);
    assert.equal(await page.evaluate(() => requests.length), 1);
    await cleanup();
  });

  await t.test('cooldown ticks retain email/action focus, expire, and cannot affect a new render or open lifecycle', async () => {
    await setup();
    await key('forgot').click();
    await key('email').fill('fixture@example.invalid');
    await key('submit').click();
    await settle();
    await key('email').focus();
    await page.clock.runFor(1600);
    assert.equal(await active(), 'email');
    await key('signin').focus();
    await page.clock.runFor(1600);
    assert.equal(await active(), 'signin');
    await page.evaluate(() => { window.oldTick = tracked.history.at(-1).callback; });
    await offline(true);
    await page.evaluate(() => { window.currentPage = document.querySelector('.auth-page'); oldTick(); });
    assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
    await offline(false);
    await page.clock.runFor(61000);
    assert.equal(await key('submit').isEnabled(), true);
    await key('submit').click();
    await settle();
    await page.evaluate(() => { window.oldTick = tracked.history.at(-1).callback; });
    await cleanup();
    await page.evaluate(() => {
      auth.showResetPassword();
      window.currentPage = document.querySelector('.auth-page');
      oldTick();
    });
    assert.equal(await active(), 'password');
    assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
    await cleanup();
  });

  await t.test('old async success/failure/finally cannot mutate reopened, phase-changed, or context-changed UI', async () => {
    for (const transition of ['reopen', 'phase', 'account', 'recovery', 'page']) {
      await setup();
      await signup();
      await page.evaluate(transition => {
        if (transition === 'reopen') { auth.hide(); auth.showResetPassword(); }
        if (transition === 'phase') auth.setPhase('cantconnect');
        if (transition === 'account') auth.showAccountDisabled('Current context');
        if (transition === 'recovery') auth.showResetPassword();
        if (transition === 'page') document.querySelector('[data-auth-focus="signin"]').click();
        window.currentPage = document.querySelector('.auth-page');
        window.currentFocus = document.activeElement;
      }, transition);
      await settle({ session: null });
      assert.deepEqual(await page.evaluate(() => [currentPage === document.querySelector('.auth-page'), currentFocus === document.activeElement]), [true, true]);
      await cleanup();
    }
    // Old finally must not clear the new operation's in-flight guard.
    await setup();
    await signup();
    await page.evaluate(() => { auth.hide(); auth.showResetPassword(); });
    await reset();
    await page.evaluate(() => { window.currentPage = document.querySelector('.auth-page'); });
    await reject();
    assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
    assert.equal(await key('submit').isDisabled(), true);
    await settle();
    await cleanup();
  });

  await t.test('each Auth operation suppresses obsolete UI without cancelling provider work', async () => {
    for (const operation of ['signin', 'forgot', 'reset', 'resend']) {
      await setup();
      if (operation === 'resend') {
        await signup(); await settle({ session: null }); await key('resend').click();
      } else if (operation === 'reset') await reset();
      else {
        if (operation === 'forgot') await key('forgot').click();
        await key('email').fill('fixture@example.invalid');
        if (operation === 'signin') await key('password').fill('Fixture-Password-42');
        await key('submit').click();
      }
      await page.evaluate(() => {
        auth.hide(); auth.showAccountDisabled('New context');
        window.currentPage = document.querySelector('.auth-page');
      });
      await settle();
      assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true, operation);
      assert.equal(await active(), 'email');
      assert.equal(await page.getByRole('alert').textContent(), 'New context');
      await cleanup();
    }
  });

  await t.test('password-update delay transitions only the current view and is cleared at every boundary', async () => {
    for (const transition of ['none', 'hide', 'phase', 'context', 'render']) {
      await setup();
      await reset();
      await settle();
      assert.match(await page.getByRole('alert').textContent(), /Password updated/);
      if (transition === 'render') await page.clock.runFor(750);
      await page.evaluate(transition => {
        window.oldTransition = tracked.history.at(-1).fire;
        if (transition === 'hide') { auth.hide(); auth.showResetPassword(); }
        if (transition === 'phase') auth.setPhase('checking');
        if (transition === 'context') auth.showAccountDisabled('Current');
        if (transition === 'render') window.dispatchEvent(new Event('offline'));
        window.currentPage = document.querySelector('.auth-page');
        if (transition !== 'none') oldTransition();
      }, transition);
      if (transition === 'none') {
        await page.clock.runFor(1600);
        assert.equal(await active(), 'email');
      }
      else assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
      if (transition === 'render') {
        await page.clock.runFor(800);
        assert.equal(await active(), 'email', 'replacement render retains the current transition deadline');
      }
      await cleanup();
    }
  });

  await t.test('a newer password request cancels the previous success transition without cancelling the request', async () => {
    await setup();
    await reset();
    await settle();
    await page.evaluate(() => { window.oldTransition = tracked.history.at(-1).callback; });
    await key('submit').click();
    await page.evaluate(() => {
      window.currentPage = document.querySelector('.auth-page');
      oldTransition();
    });
    assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
    await page.clock.runFor(1600);
    assert.equal(await key('submit').isDisabled(), true, 'new request remains pending');
    assert.equal(await page.evaluate(() => requests.length), 2);
    await reject();
    assert.match(await page.getByRole('alert').textContent(), /fixture failure/);
    await cleanup();
  });

  await t.test('old detached controls and network callbacks cannot mutate or refocus a later view', async () => {
    for (const transition of ['reopen', 'page', 'phase', 'render']) {
      await setup();
      await page.evaluate(transition => {
        window.oldSignup = document.querySelector('[data-auth-focus="signup"]');
        window.oldNetwork = tracked.listeners.filter(item => ['online', 'offline'].includes(item.type));
        if (transition === 'reopen') { auth.hide(); auth.showResetPassword(); }
        if (transition === 'page') auth.showResetPassword();
        if (transition === 'phase') auth.setPhase('cantconnect');
        if (transition === 'render') window.dispatchEvent(new Event('offline'));
        window.currentPage = document.querySelector('.auth-page');
        oldSignup.click();
        for (const item of oldNetwork) item.callback(new Event(item.type));
      }, transition);
      assert.equal(await active(), transition === 'phase' ? 'retry' : transition === 'render' ? 'email' : 'password');
      assert.equal(await page.evaluate(() => currentPage === document.querySelector('.auth-page')), true);
      assert.equal(await page.evaluate(() => tracked.listeners.filter(item => item.active).length), 2);
      await cleanup();
    }
  });

  await t.test('Auth supersedes ordinary modal and preserves its ownership and isolation on hide', async () => {
    await setup('form', false);
    await page.evaluate(() => {
      window.modal = ui.showModal({ title: 'Ordinary', content: '<button id="ordinary">Ordinary task</button>', onClose: () => calls.closed = true });
      document.getElementById('ordinary').focus();
      auth.show();
    });
    assert.equal(await active(), 'email');
    assert.equal(await page.evaluate(() => modal.overlay.inert && document.getElementById('app').inert), true);
    await page.keyboard.press('Escape');
    await key('signup').focus();
    await page.keyboard.press('Control+a');
    assert.deepEqual(await page.evaluate(() => [calls.escape, calls.deselect, calls.selectAll, Boolean(calls.closed)]), [0, 0, 0, false]);
    await page.evaluate(() => { auth.hide(); auth.hide(); });
    assert.deepEqual(await page.evaluate(() => ({
      owners: ui.modalOwnership.getOwners().length,
      active: ui.modalOwnership.getActiveOwner().kind,
      locked: document.body.classList.contains('tp3d-shared-modal-lock'),
      page: document.getElementById('app').inert,
      ordinary: modal.overlay.inert,
      restoredStale: document.activeElement.id === 'ordinary',
    })), { owners: 1, active: 'modal', locked: true, page: true, ordinary: false, restoredStale: false });
    await page.evaluate(() => modal.close({ restoreFocus: false }));
    await cleanup();
  });

  await t.test('specialized owners retain their own locks and later owner prevents Auth rerender focus theft', async () => {
    await setup();
    await page.evaluate(() => {
      const root = document.createElement('div');
      root.innerHTML = '<button id="specialized">Specialized</button>';
      document.getElementById('modal-root').appendChild(root);
      window.special = ui.modalOwnership.register({ kind: 'system', element: root, priority: 3, parentId: null, focusRoot: root, initialFocus: () => root.firstChild });
    });
    assert.equal(await active(), 'specialized');
    await offline(true);
    assert.equal(await active(), 'specialized');
    await page.evaluate(() => { auth.hide(); auth.hide(); });
    assert.equal(await page.evaluate(() => ui.modalOwnership.getActiveOwner() === special && document.getElementById('app').inert), true);
    await page.evaluate(() => special.release({ restoreFocus: false }));
    await cleanup();
  });

  await t.test('hide suppresses stale return and queued shared entry through rapid reopen/context change', async () => {
    await setup('form', false);
    await page.evaluate(() => {
      auth.show(); auth.hide(); auth.showResetPassword(); auth.hide();
      document.getElementById('after').focus();
    });
    assert.equal(await active(), 'after');
    await cleanup();
    await page.evaluate(() => { auth.show(); auth.hide(); document.getElementById('before').remove(); document.getElementById('after').focus(); });
    assert.equal(await active(), 'after');
    await cleanup();
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
});
