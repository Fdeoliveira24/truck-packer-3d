import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated DOM fixtures using the project's installed Playwright/Chromium.
// Every request is fulfilled locally: no app boot, session, API, or data writes.
test('P0-SM-OF-5/6/7 real DOM modal focus and isolation', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/src/') && pathname.endsWith('.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../..${pathname}`, import.meta.url), 'utf8') });
    } else if (pathname === '/styles/main.css') {
      await route.fulfill({ contentType: 'text/css', body: await readFile(new URL('../../styles/main.css', import.meta.url), 'utf8') });
    } else if (pathname === '/item-notes-fixture.js') {
      // Execute the actual closed-over Editor adapter with disposable in-memory
      // dependencies, without booting the renderer, auth or persistence layers.
      const source = await readFile(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8');
      const start = source.indexOf('    function openNotesModal(pack, inst) {');
      const end = source.indexOf('    // Every editor truck writer', start);
      assert.ok(start >= 0 && end > start);
      await route.fulfill({ contentType: 'text/javascript', body:
        `import { resolveNotesFocusTarget } from '/src/ui/overlays/notes-overlay.js';
         export function openItemNotes({ UIComponents, StateStore, PackLibrary, CaseLibrary, Utils, editorMutationBlocked }, pack, inst) {
           ${source.slice(start, end)}
           openNotesModal(pack, inst);
         }` });
    } else if (pathname === '/focus-fixture') {
      await route.fulfill({ contentType: 'text/html', body: '<button id="before">Page before</button><div id="modal-root"></div><button id="after">Page after</button><div id="toast-container"></div>' });
    } else if (pathname === '/isolation-fixture') {
      await route.fulfill({ contentType: 'text/html', body: `
        <link rel="stylesheet" href="/styles/main.css">
        <style>
          body { min-height: 1200px; }
          #app { padding-top: 200px; }
          #app .content { height: 100px; overflow: auto; }
        </style>
        <div id="app"><button id="before">Page before</button>
          <div class="content"><div style="height: 300px">Scrollable page</div></div>
          <button id="after">Page after</button></div>
        <div id="modal-root"></div><div id="toast-container"></div>
        <div id="background-extra" aria-hidden="true"><button id="extra">Extra</button></div>` });
    } else await route.abort();
  });
  const setup = async (fixture = 'focus-fixture') => {
    await page.goto(`http://localhost:5500/${fixture}`);
    await page.evaluate(async () => {
      const { createUIComponents } = await import('/src/ui/ui-components.js');
      window.ui = createUIComponents();
      window.make = (html, config = {}) => ui.showModal({ title: 'Fixture', content: html, ...config });
      window.tabEvents = [];
      document.addEventListener('keydown', event => {
        if (event.key === 'Tab') tabEvents.push(event.defaultPrevented);
      });
    });
  };
  const active = () => page.evaluate(() => document.activeElement.id || document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim());

  await t.test('ordinary modal isolates the page, keeps its popup usable, and restores scroll and ARIA state', async () => {
    await setup('isolation-fixture');
    await page.evaluate(() => {
      document.getElementById('before').focus();
      document.querySelector('.content').scrollTop = 80;
      window.scrollTo(0, 120);
      window.initialScroll = { page: window.scrollY, content: document.querySelector('.content').scrollTop };
      window.modal = make('<button id="anchor">Open choices</button>');
    });
    assert.deepEqual(await page.evaluate(() => ({
      pageInert: document.getElementById('app').inert,
      extraInert: document.getElementById('background-extra').inert,
      modalInert: modal.overlay.inert,
      role: modal.modal.getAttribute('role'),
      ariaModal: modal.modal.getAttribute('aria-modal'),
      named: modal.modal.getAttribute('aria-labelledby') === modal.modal.querySelector('h3').id,
      bodyLocked: document.body.classList.contains('modal-open'),
      bodyOverflow: getComputedStyle(document.body).overflow,
      contentOverflow: getComputedStyle(document.querySelector('.content')).overflow,
      pageScroll: window.scrollY,
      contentScroll: document.querySelector('.content').scrollTop,
    })), { pageInert: true, extraInert: true, modalInert: false, role: 'dialog',
      ariaModal: 'true', named: true, bodyLocked: true, bodyOverflow: 'hidden', contentOverflow: 'hidden',
      pageScroll: 120, contentScroll: 80 });
    assert.equal(await page.evaluate(() => {
      const pageControl = document.getElementById('before');
      pageControl.focus();
      return document.activeElement === pageControl;
    }), false, 'native inert prevents background focus');
    await assert.rejects(page.locator('#before').click({ timeout: 250 }), 'background click cannot activate');
    await page.evaluate(() => {
      window.popup = ui.openDropdown(document.getElementById('anchor'), [{ label: 'Choice', onClick: () => { window.chosen = true; } }]);
    });
    assert.equal(await page.evaluate(() => popup.closest('[inert]') === null), true, 'owned popup remains outside inert regions');
    assert.equal(await page.evaluate(() => popup.hasAttribute('aria-modal')), false, 'popup is not a modal dialog');
    await page.getByRole('button', { name: 'Choice', exact: true }).click();
    assert.equal(await page.evaluate(() => window.chosen), true);
    await page.evaluate(() => {
      window.beforeCloseScroll = { page: window.scrollY, content: document.querySelector('.content').scrollTop };
      modal.close();
    });
    assert.deepEqual(await page.evaluate(() => ({
      pageInert: document.getElementById('app').hasAttribute('inert'),
      extraInert: document.getElementById('background-extra').hasAttribute('inert'),
      extraAria: document.getElementById('background-extra').getAttribute('aria-hidden'),
      bodyLocked: document.body.classList.contains('modal-open'),
      page: window.scrollY,
      content: document.querySelector('.content').scrollTop,
      beforeClose: beforeCloseScroll,
    })), { pageInert: false, extraInert: false, extraAria: 'true', bodyLocked: false,
      page: await page.evaluate(() => beforeCloseScroll.page),
      content: await page.evaluate(() => beforeCloseScroll.content),
      beforeClose: await page.evaluate(() => beforeCloseScroll) });
  });

  await t.test('nested and out-of-order owners retain the lock until the last release', async () => {
    await setup('isolation-fixture');
    await page.evaluate(() => {
      window.parentModal = make('<button id="child-trigger">Open child</button>');
      document.getElementById('child-trigger').focus();
      window.childModal = make('<input id="child-field">');
    });
    assert.deepEqual(await page.evaluate(() => ({
      page: document.getElementById('app').inert,
      parent: parentModal.overlay.inert,
      child: childModal.overlay.inert,
      locked: document.body.classList.contains('tp3d-shared-modal-lock'),
    })), { page: true, parent: true, child: false, locked: true });
    await page.evaluate(() => childModal.close());
    assert.deepEqual(await page.evaluate(() => ({
      page: document.getElementById('app').inert,
      parent: parentModal.overlay.inert,
      locked: document.body.classList.contains('tp3d-shared-modal-lock'),
    })), { page: true, parent: false, locked: true });
    await page.getByRole('button', { name: 'Open child' }).click();
    await page.evaluate(() => parentModal.close());
    assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
    await page.evaluate(() => {
      window.first = make('<input id="first-modal">', { parentOwnerId: null });
      window.second = make('<input id="second-modal">', { parentOwnerId: null });
      first.close();
      first.close();
    });
    assert.equal(await page.evaluate(() => document.getElementById('app').inert && document.body.classList.contains('tp3d-shared-modal-lock')), true);
    await page.evaluate(() => { second.close(); second.close(); });
    assert.equal(await page.evaluate(() => document.getElementById('app').inert || document.body.classList.contains('tp3d-shared-modal-lock')), false);
  });

  await t.test('legacy modal-open removal cannot release shared scroll isolation', async () => {
    for (const priorModalOpen of [false, true]) {
      await setup('isolation-fixture');
      await page.evaluate(prior => {
        document.body.classList.toggle('modal-open', prior);
        document.body.style.overflow = 'scroll';
        window.first = make('<button>First</button>', { parentOwnerId: null });
      }, priorModalOpen);
      const state = () => page.evaluate(() => ({
        marker: document.body.classList.contains('tp3d-shared-modal-lock'),
        modalOpen: document.body.classList.contains('modal-open'),
        bodyOverflow: getComputedStyle(document.body).overflow,
        contentOverflow: getComputedStyle(document.querySelector('.content')).overflow,
        appInert: document.getElementById('app').inert,
      }));
      assert.deepEqual(await state(), {
        marker: true, modalOpen: true, bodyOverflow: 'hidden', contentOverflow: 'hidden', appInert: true,
      });
      await page.evaluate(() => {
        window.second = make('<button>Second</button>', { parentOwnerId: null });
        document.body.classList.remove('modal-open'); // External legacy overlay closes.
      });
      assert.deepEqual(await state(), {
        marker: true, modalOpen: false, bodyOverflow: 'hidden', contentOverflow: 'hidden', appInert: true,
      });
      await page.evaluate(() => first.close()); // Release the older owner first.
      assert.deepEqual(await state(), {
        marker: true, modalOpen: false, bodyOverflow: 'hidden', contentOverflow: 'hidden', appInert: true,
      });
      await page.evaluate(() => second.close());
      assert.deepEqual(await page.evaluate(() => ({
        marker: document.body.classList.contains('tp3d-shared-modal-lock'),
        modalOpen: document.body.classList.contains('modal-open'),
        inlineOverflow: document.body.style.overflow,
        appInert: document.getElementById('app').inert,
      })), { marker: false, modalOpen: priorModalOpen, inlineOverflow: 'scroll', appInert: false });
    }
  });

  await t.test('pre-existing inert, aria-hidden, body class and inline overflow survive a shared lock', async () => {
    await setup('isolation-fixture');
    await page.evaluate(() => {
      document.getElementById('app').setAttribute('inert', 'prior');
      document.getElementById('app').setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'scroll';
      window.modal = make('<input>');
    });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
    await page.evaluate(() => modal.close());
    assert.deepEqual(await page.evaluate(() => ({
      inert: document.getElementById('app').getAttribute('inert'),
      aria: document.getElementById('app').getAttribute('aria-hidden'),
      modalOpen: document.body.classList.contains('modal-open'),
      inlineOverflow: document.body.style.overflow,
    })), { inert: 'prior', aria: 'false', modalOpen: true, inlineOverflow: 'scroll' });
  });

  await t.test('specialized blockers cannot release another owner\'s page lock', async () => {
    await setup('isolation-fixture');
    await page.evaluate(() => {
      window.modal = make('<input id="ordinary">');
      const authRoot = document.createElement('div');
      authRoot.innerHTML = '<input id="auth-field">';
      document.body.appendChild(authRoot);
      window.authOwner = ui.modalOwnership.register({ kind: 'auth', element: authRoot, parentId: null, priority: 2 });
    });
    assert.equal(await page.evaluate(() => Boolean(modal.overlay.closest('[inert]')) && !authOwner.element.closest('[inert]')), true);
    await page.evaluate(() => authOwner.release());
    assert.equal(await page.evaluate(() => document.getElementById('app').inert && !modal.overlay.inert), true);
    await page.evaluate(() => {
      for (const kind of ['system', 'error']) {
        const root = document.createElement('div');
        root.innerHTML = '<button>Retry</button>';
        document.body.appendChild(root);
        const owner = ui.modalOwnership.register({ kind, element: root, parentId: null, priority: 1 });
        if (!document.getElementById('app').inert) throw Error('page unlocked');
        owner.release();
        if (!document.getElementById('app').inert) throw Error('specialized release unlocked ordinary modal');
      }
      modal.close();
    });
    assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
  });

  await t.test('initial target, caller focus, autofocus, task field, and root fallback', async () => {
    await setup();
    await page.evaluate(() => { window.modal = make('<input id="field"><button id="explicit">Explicit</button>', { initialFocus: () => document.getElementById('explicit') }); });
    assert.equal(await active(), 'explicit');
    await page.evaluate(() => { modal.close(); modal = make('<input id="field"><button id="preferred">Preferred</button>'); document.getElementById('preferred').focus(); });
    assert.equal(await active(), 'preferred');
    await page.evaluate(() => { modal.close(); modal = make('<input disabled><input id="field"><button id="auto" autofocus>Auto</button>', { initialFocus: document.getElementById('before') }); });
    assert.equal(await active(), 'auto', 'out-of-region explicit target cannot focus the page');
    await page.evaluate(() => { modal.close(); modal = make('<input hidden><input disabled><input style="display:none"><input style="visibility:hidden"><input tabindex="-1"><input id="usable">', { initialFocus: () => null }); });
    assert.equal(await active(), 'usable');
    await page.evaluate(() => { modal.close(); modal = make('<input id="usable"><button id="disabled" disabled>Disabled</button>', { initialFocus: () => document.getElementById('disabled') }); });
    assert.equal(await active(), 'usable');
    await page.evaluate(() => { modal.close(); modal = make('<input id="usable">', { initialFocus: () => ({ stale: true }) }); });
    assert.equal(await active(), 'usable');
    await page.evaluate(() => { modal.close(); modal = make('<button disabled>Unavailable</button>', { hideClose: true, actions: [], initialFocus: () => { throw Error('missing'); } }); modal.modal.id = 'fallback'; });
    assert.equal(await active(), 'fallback');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'fallback');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'fallback');
  });

  await t.test('native internal Tab, both wrap directions, escape recovery, and dynamic controls', async () => {
    await setup();
    await page.evaluate(() => { window.modal = make('<input id="first"><input id="second"><button disabled>Disabled</button><button hidden>Hidden</button><span style="display:none"><button>Invisible</button></span><fieldset disabled><input></fieldset><button tabindex="-1">Nonsequential</button><button id="last">Last</button>', { hideClose: true, actions: [] }); });
    assert.equal(await active(), 'first');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'second');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false, 'ordinary internal Tab is native');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'last');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false, 'native Tab skips hidden and disabled controls');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'second');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false, 'native Shift+Tab skips hidden and disabled controls');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'first');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'last');
    await page.evaluate(() => { modal.body.innerHTML = '<input id="replacement"><button id="new-last">New last</button>'; });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'replacement');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'new-last');
    await page.evaluate(() => document.getElementById('after').focus());
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'replacement');
  });

  await t.test('aria-disabled controls remain excluded even though native Tab would visit them', async () => {
    await setup();
    await page.evaluate(() => { window.modal = make('<input id="first"><button aria-disabled="true">Unavailable</button><input id="last">', { hideClose: true, actions: [] }); });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'last');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), true, 'logical exclusions still require explicit navigation');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'first');
  });

  await t.test('internal Tab scans only the logical region, independent of a large background DOM', async () => {
    await setup();
    await page.evaluate(() => {
      const background = document.createElement('div');
      background.innerHTML = '<button>Background</button>'.repeat(10000);
      document.body.appendChild(background);
      window.modal = make('<input id="first"><input id="second">', { hideClose: true, actions: [] });
      window.globalFocusScans = [];
      const query = document.querySelectorAll.bind(document);
      document.querySelectorAll = selector => {
        const result = query(selector);
        if (selector.includes('[tabindex]')) globalFocusScans.push(result.length);
        return result;
      };
    });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'second');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false, 'internal Tab still uses native navigation');
    assert.deepEqual(await page.evaluate(() => globalFocusScans), [], 'Tab must not enumerate thousands of unrelated background controls');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'first');
  });

  await t.test('ensureFocus preserves valid focus without rescanning controls, but rejects inactive children', async () => {
    await setup();
    await page.evaluate(() => {
      window.modal = make('<input id="first"><div id="inactive"><input id="excluded"></div>');
      ui.modalOwnership.register({ element: document.getElementById('inactive'), parentId: modal.owner.id, isActive: () => false });
    });
    await page.evaluate(() => {
      window.regionScans = 0;
      const query = modal.modal.querySelectorAll.bind(modal.modal);
      modal.modal.querySelectorAll = selector => { regionScans++; return query(selector); };
      modal.owner.ensureFocus();
      modal.owner.ensureFocus();
    });
    assert.equal(await active(), 'first');
    assert.equal(await page.evaluate(() => regionScans), 0, 'preserving valid focus needs no control enumeration');
    await page.evaluate(() => { document.getElementById('excluded').focus(); modal.owner.ensureFocus(); });
    assert.equal(await active(), 'first', 'the fast path must retain logical-child exclusions');
    assert.equal(await page.evaluate(() => regionScans), 1, 'invalid focus triggers one fresh control scan');
  });

  await t.test('nested dialog supersedes parent and closing returns the containment boundary', async () => {
    await setup();
    await page.evaluate(() => { window.parent = make('<input id="parent-first"><button id="parent-last">Parent last</button>', { hideClose: true, actions: [] }); });
    await page.evaluate(() => { window.child = make('<input id="child-first"><button id="child-last">Child last</button>', { hideClose: true, actions: [] }); });
    assert.equal(await active(), 'child-first');
    await page.evaluate(() => parent.owner.ensureFocus());
    assert.equal(await active(), 'child-first');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'child-last');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'child-first');
    await page.evaluate(() => child.close());
    assert.equal(await active(), 'parent-first');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'parent-last');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'parent-first');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'parent-last');
  });

  await t.test('collapsed details controls are excluded, then become reachable on expansion', async () => {
    await setup();
    await page.evaluate(() => { window.modal = make('<input id="first"><details><summary id="summary">Handling</summary><button id="inside">Inside</button></details>', { hideClose: true, actions: [] }); });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'summary');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'first', 'closed details must not hide the actual last usable control');
    await page.getByText('Handling', { exact: true }).click();
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'inside');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'first');
  });

  await t.test('radio groups, contenteditable, and positive tabindex retain usable sequential order', async () => {
    await setup();
    await page.evaluate(() => { window.modal = make('<input id="radio" type="radio" name="choice" checked><input type="radio" name="choice">', { hideClose: true, actions: [] }); });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'radio', 'unchecked radio must not conceal the true end of the Tab order');
    await page.evaluate(() => { modal.close(); modal = make('<div id="editable" contenteditable="true">Text</div>', { hideClose: true, actions: [] }); });
    assert.equal(await active(), 'editable');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'editable');
    await page.evaluate(() => {
      modal.close();
      document.getElementById('before').tabIndex = 1;
      document.getElementById('after').tabIndex = 2;
      modal = make('<button id="zero">Zero</button><button id="two" tabindex="2">Two</button><button id="one" tabindex="1">One</button>', { hideClose: true, actions: [] });
    });
    assert.equal(await active(), 'one');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'two');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'zero');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'one');
  });

  await t.test('radio grouping scales linearly and preserves separate form owners', async () => {
    await setup();
    await page.evaluate(() => {
      const group = (form, checked) => `<form>${Array.from({ length: 100 }, (_, i) =>
        `<input type="radio" name="choice" id="radio-${form}-${i}" ${i === checked ? 'checked' : ''}>`).join('')}</form>`;
      window.modal = make('<input id="first">' + group(0, 50) + group(1, -1) +
        '<input type="radio" name="choice"><input id="unowned" type="radio" name="choice" checked><button id="last">Last</button>', { hideClose: true, actions: [] });
    });
    await page.evaluate(() => {
      window.radioNameReads = 0;
      const getName = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'name').get;
      for (const radio of modal.modal.querySelectorAll('input[type="radio"]')) {
        Object.defineProperty(radio, 'name', { get() { radioNameReads++; return getName.call(this); } });
      }
    });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'radio-0-50', 'the checked radio owns its group Tab stop');
    const reads = await page.evaluate(() => radioNameReads);
    assert.ok(reads <= 202 * 8, `radio grouping must use bounded work per radio, observed ${reads} name reads`);
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'radio-1-0', 'a separate form without a checked radio retains its first radio');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'unowned', 'radios without a form remain a separate group');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'last');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'unowned');
  });

  await t.test('owned popup outside panel is logical content; popup child owns focus', async () => {
    await setup();
    await page.evaluate(() => { window.parent = make('<button id="anchor">Menu</button>', { hideClose: true, actions: [] }); });
    await page.evaluate(() => {
      window.popup = ui.openDropdown(document.getElementById('anchor'), [
        { label: 'Open child', onClick: () => { window.child = make('<input id="child-field">'); } },
        { label: 'Other' },
      ], { menuSemantics: true });
      // Exercise a real portal too, independent of the current mounting choice.
      document.body.appendChild(popup);
      popup.querySelector('button').focus();
      parent.owner.ensureFocus();
    });
    assert.equal(await active(), 'Open child');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'Other');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'anchor');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Other');
    await page.getByRole('menuitem', { name: 'Open child', exact: true }).click();
    assert.equal(await active(), 'child-field');
    assert.equal(await page.evaluate(() => child.owner.parentId === parent.owner.id), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Close Fixture');
    await page.evaluate(() => parent.owner.ensureFocus());
    assert.equal(await active(), 'Close Fixture');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'child-field');
  });

  await t.test('inactive logical child is excluded even when its DOM remains visible', async () => {
    await setup();
    await page.evaluate(() => {
      window.modal = make('<input id="first"><div id="inactive"><input id="excluded"></div><input id="last">', { hideClose: true, actions: [] });
      ui.modalOwnership.register({ element: document.getElementById('inactive'), parentId: modal.owner.id, isActive: () => false });
    });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'last');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'first');
  });

  await t.test('specialized blocker suspends ordinary containment; page popup does not trap', async () => {
    await setup();
    await page.evaluate(() => {
      window.modal = make('<input id="field">');
      const authRoot = document.createElement('div');
      authRoot.innerHTML = '<input id="auth-field">';
      document.body.appendChild(authRoot);
      window.blocker = ui.modalOwnership.register({ kind: 'auth', element: authRoot, priority: 2 });
      document.getElementById('auth-field').focus();
    });
    assert.equal(await active(), 'auth-field', 'queued ordinary initial focus is suppressed');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false);
    await page.evaluate(() => { blocker.release(); modal.close(); ui.modalOwnership.register({ kind: 'popup' }); document.getElementById('before').focus(); });
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'after');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false);
  });

  await t.test('confirmation uses existing Cancel action, imports retain dismissal policy, no stale trap', async () => {
    await setup();
    await page.evaluate(() => { ui.confirm({ danger: true }); });
    assert.equal(await active(), 'Cancel');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.modal = make('<input type="file" style="display:none"><button id="browse">Browse</button>', { dismissible: false, actions: [{ label: 'Cancel' }] }); });
    assert.equal(await active(), 'browse');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'Cancel');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'Close Fixture');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) make('<input>').close();
      document.getElementById('before').focus();
    });
    assert.equal(await active(), 'before', 'released initial focus callbacks cannot steal focus');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'after');
    assert.equal(await page.evaluate(() => tabEvents.at(-1)), false);
  });

  await t.test('actual Settings uses shared containment through tab renders, popup, and nested confirmation', async () => {
    await setup('isolation-fixture');
    await page.evaluate(async () => {
      const { createSettingsOverlay } = await import('/src/ui/overlays/settings-overlay.js');
      window.settings = createSettingsOverlay({ UIComponents: ui, PreferencesManager: { get: () => ({ units: { length: 'in', weight: 'lb' } }) }, Utils: {} });
      settings.open('resources');
    });
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true);
    assert.equal(await page.evaluate(() => document.getElementById('app').inert && document.body.classList.contains('modal-open')), true);
    await page.evaluate(() => {
      window.settingsOwner = ui.modalOwnership.getActiveOwner();
      const buttons = [...settingsOwner.focusRoot.querySelectorAll('button')].filter(el => el.getClientRects().length && !el.disabled);
      buttons.at(-1).focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => settingsOwner.focusRoot.contains(document.activeElement)), true);
    await page.evaluate(() => settings.setActive('preferences'));
    await page.waitForSelector('[data-tab-panel="preferences"]');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => settingsOwner.focusRoot.contains(document.activeElement)), true);
    await page.evaluate(() => {
      const anchor = settingsOwner.focusRoot.querySelector('button');
      window.popup = ui.openDropdown(anchor, [{ label: 'Nested', onClick: () => ui.confirm({ title: 'Nested confirmation' }) }]);
      popup.querySelector('button').focus();
      settings.render({ source: 'focus-test' });
    });
    assert.equal(await active(), 'Nested');
    assert.equal(await page.evaluate(() => popup.closest('[inert]') === null), true, 'Settings popup stays interactive');
    await page.getByRole('button', { name: 'Nested', exact: true }).click();
    assert.equal(await active(), 'Cancel');
    assert.equal(await page.evaluate(() => settingsOwner.element.inert && document.getElementById('app').inert), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Close Nested confirmation');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Confirm', 'no Settings trap steals child Tab');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !settingsOwner.element.inert && document.getElementById('app').inert), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => settingsOwner.focusRoot.contains(document.activeElement)), true);
    await page.evaluate(() => settings.close());
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => !document.getElementById('app').inert && !document.body.classList.contains('modal-open')), true);
  });

  await t.test('restores the opener once for programmatic, reentrant, Escape, X, backdrop and footer close', async () => {
    for (const method of ['programmatic', 'escape', 'x', 'backdrop', 'footer']) {
      await setup();
      await page.evaluate(() => {
        const opener = document.getElementById('before');
        opener.focus();
        window.returns = 0;
        opener.addEventListener('focus', () => returns++);
        window.modal = make('<input id="field">', { onClose: () => modal.close() });
      });
      assert.equal(await active(), 'field');
      if (method === 'programmatic') await page.evaluate(() => { modal.close(); modal.close(); });
      if (method === 'escape') await page.keyboard.press('Escape');
      if (method === 'x') await page.getByRole('button', { name: 'Close Fixture' }).click();
      if (method === 'backdrop') await page.evaluate(() => modal.overlay.click());
      if (method === 'footer') await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await active(), 'before', method);
      assert.equal(await page.evaluate(() => returns), 1, method);
      await page.evaluate(() => modal.close());
      assert.equal(await page.evaluate(() => returns), 1, 'later repeated close is inert');
    }
  });

  await t.test('nested return follows the logical parent, then the original external trigger', async () => {
    await setup();
    await page.evaluate(() => {
      document.getElementById('before').focus();
      window.parent = make('<input id="parent-field"><button id="child-trigger">Child</button>');
    });
    await page.evaluate(() => {
      document.getElementById('child-trigger').focus();
      window.child = make('<input id="child-field">');
    });
    await page.evaluate(() => child.close());
    assert.equal(await active(), 'child-trigger');
    await page.evaluate(() => {
      // A resolver cannot return a page control while the parent owns it.
      window.child = make('<input id="child-field">', {
        parentOwnerId: parent.owner.id,
        restoreFocusResolver: () => document.getElementById('after'),
      });
    });
    await page.evaluate(() => child.close());
    assert.equal(await active(), 'parent-field', 'a page source cannot override the active parent');
    await page.evaluate(() => parent.close());
    assert.equal(await active(), 'before');
  });

  await t.test('invalid sources use the current parent region and never hidden or inactive controls', async () => {
    for (const invalidation of ['removed', 'replaced', 'disabled', 'fieldset', 'hidden', 'display', 'visibility', 'details', 'inert', 'aria-hidden', 'aria-disabled', 'inactive']) {
      await setup();
      await page.evaluate(() => {
        window.parent = make('<input id="fallback"><div id="origin-region"><button id="origin">Open</button></div>');
      });
      await page.evaluate(() => {
        document.getElementById('origin').focus();
        window.child = make('<input id="child-field">');
      });
      await page.evaluate(kind => {
        const target = document.getElementById('origin');
        window.oldTarget = target;
        if (kind === 'removed') target.remove();
        if (kind === 'replaced') target.replaceWith(target.cloneNode(true));
        if (kind === 'disabled') target.disabled = true;
        if (kind === 'fieldset') {
          const fieldset = document.createElement('fieldset');
          target.replaceWith(fieldset); fieldset.appendChild(target); fieldset.disabled = true;
        }
        if (kind === 'hidden') target.parentElement.hidden = true;
        if (kind === 'display') target.parentElement.style.display = 'none';
        if (kind === 'visibility') target.style.visibility = 'hidden';
        if (kind === 'details') {
          const details = document.createElement('details');
          target.replaceWith(details); details.appendChild(target);
        }
        if (kind === 'inert') target.parentElement.inert = true;
        if (kind === 'aria-hidden') target.parentElement.setAttribute('aria-hidden', 'true');
        if (kind === 'aria-disabled') target.setAttribute('aria-disabled', 'true');
        if (kind === 'inactive') ui.modalOwnership.register({ element: target.parentElement, parentId: parent.owner.id, isActive: () => false });
        child.close();
      }, invalidation);
      assert.equal(await active(), 'fallback', invalidation);
      assert.equal(await page.evaluate(() => document.activeElement === oldTarget), false);
    }
    await setup();
    await page.evaluate(() => { document.getElementById('before').focus(); window.modal = make('<input>'); });
    await page.evaluate(() => { document.getElementById('before').remove(); modal.close(); });
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'no owner and no target fails safely');
  });

  await t.test('restoreFocus false suppresses return for both the owner lifetime and one final close', async () => {
    for (const perClose of [false, true]) {
      await setup();
      await page.evaluate(perClose => {
        document.getElementById('before').focus();
        window.modal = make('<input>', { restoreFocus: perClose });
      }, perClose);
      await page.evaluate(perClose => modal.close(perClose ? { restoreFocus: false } : undefined), perClose);
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    }
  });

  await t.test('resolver chooses the current destination after onClose cleanup and validates failures', async () => {
    await setup();
    await page.evaluate(() => {
      document.getElementById('before').focus();
      window.modal = make('<input>', {
        restoreFocusResolver: () => document.getElementById('replacement'),
        onClose: () => { document.getElementById('after').id = 'replacement'; },
      });
    });
    await page.evaluate(() => modal.close());
    assert.equal(await active(), 'replacement');
    for (const result of ['external', 'hidden', 'stale', 'object', 'throw']) {
      await setup();
      await page.evaluate(() => { window.parent = make('<input id="parent-field"><button id="hidden" hidden>Hidden</button>'); });
      await page.evaluate(result => {
        window.child = make('<input>', { restoreFocusResolver: () => {
          if (result === 'throw') throw Error('unavailable');
          if (result === 'object') return {};
          if (result === 'stale') return document.createElement('button');
          return document.getElementById(result === 'hidden' ? 'hidden' : 'before');
        } });
      }, result);
      await page.evaluate(() => child.close());
      assert.equal(await active(), 'parent-field', result);
    }
  });

  await t.test('cascade, replacement, newer owner and blocker prevent stale restoration', async () => {
    await setup();
    await page.evaluate(() => { document.getElementById('before').focus(); window.parent = make('<input id="parent-field">'); });
    await page.evaluate(() => { window.child = make('<input id="child-field">'); });
    await page.evaluate(() => {
      window.returnLog = [];
      document.addEventListener('focusin', event => returnLog.push(event.target.id));
      parent.close();
    });
    assert.deepEqual(await page.evaluate(() => returnLog), ['before'], 'only the outermost owner restores on cascade');
    await page.evaluate(() => { window.old = make('<input id="old-field">'); });
    await page.evaluate(() => {
      window.replacement = make('<input id="replacement">', { parentOwnerId: null });
      old.close();
    });
    assert.equal(await active(), 'replacement');
    await page.evaluate(() => replacement.close());
    assert.equal(await active(), 'before', 'same-parent replacement inherits the original source');
    await page.evaluate(() => {
      window.old = make('<input>', { onClose: () => { window.newer = make('<input id="newer">'); } });
    });
    await page.evaluate(() => old.close());
    assert.equal(await active(), 'newer', 'onClose can open a newer dialog without a stale return');
    await page.evaluate(() => {
      const authRoot = document.createElement('div');
      authRoot.innerHTML = '<input id="auth-field">';
      document.body.appendChild(authRoot);
      window.blocker = ui.modalOwnership.register({ kind: 'auth', element: authRoot, priority: 2 });
      document.getElementById('auth-field').focus();
      newer.close();
    });
    assert.equal(await active(), 'auth-field', 'ordinary restoration cannot override a specialized owner');
  });

  await t.test('actual Settings restores after child cancellation and tab rerender without losing the page source', async () => {
    await setup();
    await page.evaluate(async () => {
      const { createSettingsOverlay } = await import('/src/ui/overlays/settings-overlay.js');
      window.settings = createSettingsOverlay({ UIComponents: ui, PreferencesManager: { get: () => ({ units: { length: 'in', weight: 'lb' } }) }, Utils: {} });
      document.getElementById('before').focus();
      settings.open('preferences');
    });
    await page.evaluate(() => {
      window.settingsOwner = ui.modalOwnership.getActiveOwner();
      window.tabControl = settingsOwner.focusRoot.querySelector('[role="combobox"]');
      tabControl.focus();
      ui.confirm({ title: 'Nested confirmation' });
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement === tabControl), true);
    await page.evaluate(() => { ui.confirm({ title: 'Rerender confirmation' }); });
    await page.evaluate(() => settings.setActive('resources'));
    await page.waitForFunction(() => !tabControl.isConnected);
    assert.equal(await page.evaluate(() => tabControl.isConnected), false);
    assert.equal(await active(), 'Cancel', 'Settings rerender cannot steal the child focus');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => settingsOwner.focusRoot.contains(document.activeElement)), true);
    await page.evaluate(() => settings.close());
    assert.equal(await active(), 'before');
  });

  await t.test('actual Load Plan Notes resolves visible replacement triggers and rejects a changed context', async () => {
    for (const mode of ['original', 'removed', 'hidden', 'context', 'disabled']) {
      await setup();
      await page.evaluate(async mode => {
        const { openNotesOverlay } = await import('/src/ui/overlays/notes-overlay.js');
        const trigger = document.getElementById('before');
        trigger.dataset.notesEntityType = 'load plan'; trigger.dataset.notesEntityId = 'pack';
        document.getElementById('after').dataset.notesEntityType = 'load plan';
        document.getElementById('after').dataset.notesEntityId = 'pack';
        window.notesContext = 'pack';
        trigger.focus();
        window.notes = openNotesOverlay({ UIComponents: ui, entityType: 'load plan', entityId: 'pack', trigger,
          capturedContext: 'pack', getCurrentContext: () => notesContext,
          resolveEntity: () => ({ notes: '' }), readNote: entity => entity.notes,
          saveNote: () => { throw Error('unexpected write'); }, clearValue: '', title: 'Load Plan Notes' });
        if (mode === 'removed') trigger.remove();
        if (mode === 'hidden') trigger.hidden = true;
        if (mode === 'disabled') trigger.disabled = true;
        if (mode === 'context') notesContext = 'other-pack';
      }, mode);
      assert.equal(await page.evaluate(() => document.getElementById('after').inert && document.body.classList.contains('modal-open')), true);
      await page.getByRole('button', { name: 'Add Note', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(await active(), mode === 'original' ? 'before' : mode === 'context' ? 'Page beforePage after' : 'after', mode);
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.evaluate(() => document.getElementById('after').inert || document.body.classList.contains('modal-open')), false);
    }
  });

  await t.test('actual Item Notes survives empty/edit replacement cycles and resolves a current Inspector trigger', async () => {
    for (const mode of ['original', 'removed', 'hidden', 'selection']) {
      await setup();
      await page.evaluate(async mode => {
        const { openItemNotes } = await import('/item-notes-fixture.js');
        const trigger = document.getElementById('before');
        trigger.dataset.notesEntityType = 'item'; trigger.dataset.notesEntityId = 'instance';
        const next = document.getElementById('after');
        next.dataset.notesEntityType = 'item'; next.dataset.notesEntityId = 'instance';
        window.selection = ['instance'];
        const inst = { id: 'instance', caseId: 'case' };
        const pack = { id: 'pack', cases: [inst] };
        trigger.focus();
        openItemNotes({ UIComponents: ui,
          StateStore: { get: key => ({ currentScreen: 'editor', currentPackId: 'pack', selectedInstanceIds: selection })[key] },
          PackLibrary: { getById: () => pack }, CaseLibrary: { getById: () => ({ name: 'Case' }) },
          Utils: {}, editorMutationBlocked: () => false }, pack, inst);
        if (mode === 'removed') trigger.remove();
        if (mode === 'hidden') trigger.hidden = true;
        if (mode === 'selection') selection = ['other'];
      }, mode);
      assert.equal(await page.evaluate(() => document.getElementById('after').inert && document.body.classList.contains('modal-open')), true);
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Add Note', exact: true }).click();
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await active(), 'Add Note');
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.getElementById('after').inert || document.body.classList.contains('modal-open')), false);
      if (mode === 'selection') assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      else assert.equal(await active(), mode === 'original' ? 'before' : 'after', mode);
    }
  });

  await t.test('fallback skips inactive focus regions and a reentrant resolver cannot supersede a new owner', async () => {
    await setup();
    await page.evaluate(() => {
      window.parent = make('<div aria-hidden="true"><input id="hidden-field"></div><input id="allowed-field">');
    });
    await page.evaluate(() => { window.child = make('<input>', { restoreFocusResolver: () => null }); });
    await page.evaluate(() => child.close());
    assert.equal(await active(), 'allowed-field');
    await page.evaluate(() => {
      window.child = make('<input>', { restoreFocusResolver: () => {
        window.newer = make('<input id="newer-field">', { parentOwnerId: parent.owner.id });
        return document.getElementById('allowed-field');
      } });
    });
    await page.evaluate(() => child.close());
    assert.equal(await active(), 'newer-field');
  });

  await t.test('actual import dialogs preserve cancellation policy and return to their triggers', async () => {
    await setup();
    await page.evaluate(async () => {
      const { createImportCasesDialog } = await import('/src/ui/overlays/import-cases-dialog.js');
      window.importCases = createImportCasesDialog({ UIComponents: ui });
      document.getElementById('before').focus();
      importCases.open();
    });
    assert.equal(await page.evaluate(() => document.getElementById('after').inert), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1, 'Cases import still ignores Escape');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await active(), 'before');
    assert.equal(await page.evaluate(() => document.getElementById('after').inert), false);
    await page.evaluate(async () => {
      const { createImportAppDialog } = await import('/src/ui/overlays/import-app-dialog.js');
      createImportAppDialog({ UIComponents: ui }).open();
    });
    assert.equal(await page.evaluate(() => document.getElementById('after').inert), true);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await active(), 'before');
    assert.equal(await page.evaluate(() => document.getElementById('after').inert), false);
  });

  await t.test('actual Truck Change cancellation and replacement preserve the surviving parent and truck data', async () => {
    await setup();
    await page.evaluate(async () => {
      const { createTruckChangeController } = await import('/src/ui/truck-change-controller.js');
      window.pack = { id: 'pack', truck: { length: 100, width: 80, height: 80 }, cases: [{ id: 'case' }] };
      window.originalPack = JSON.stringify(pack);
      window.restoredControls = 0;
      window.controller = createTruckChangeController({ UIComponents: ui,
        CaseLibrary: { getCases: () => [] },
        PackLibrary: {
          reconcilePlacementsForTruck: () => ({ nextPack: pack, kept: [], adjusted: [], invalid: ['case'], unresolved: [], malformed: [], summary: {} }),
          stagePlacementIds: source => ({ pack: source, stagedIds: ['case'], failedIds: [] }),
          repackInvalidPlacements: () => ({ pack, repackedIds: [], failedIds: ['case'] }),
          update: () => { throw Error('Cancel must not commit'); },
        },
      });
      document.getElementById('before').focus();
      window.parent = make('<button id="truck-trigger">Update truck</button>');
    });
    await page.evaluate(() => {
      document.getElementById('truck-trigger').focus();
      controller.request({ pack, nextTruck: { ...pack.truck, length: 90 }, restoreControls: () => { restoredControls++; } });
    });
    assert.equal(await page.evaluate(() => document.getElementById('before').inert && document.body.classList.contains('modal-open')), true);
    await page.getByRole('button', { name: 'Repack invalid', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 2, 'replacement does not stack a stale Truck Change dialog');
    await page.keyboard.press('Escape');
    assert.equal(await active(), 'truck-trigger');
    assert.equal(await page.evaluate(() => JSON.stringify(pack)), await page.evaluate(() => originalPack));
    assert.equal(await page.evaluate(() => restoredControls), 1);
    assert.equal(await page.evaluate(() => controller.isActive()), false);
    await page.evaluate(() => parent.close());
    assert.equal(await active(), 'before');
    assert.equal(await page.evaluate(() => document.getElementById('before').inert || document.body.classList.contains('modal-open')), false);
  });
});

test('DOM focus uses one brand ring while selected, checked, and semantic states stay distinct', { timeout: 120000 }, async t => {
  const css = await readFile(new URL('../../styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /--focus-ring:\s*var\(--accent-primary\);/);
  assert.doesNotMatch(css.match(/\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] || '', /--focus-ring:/,
    'dark theme shares the same brand focus token');
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/:focus(?:-visible|-within)?\b/.test(selector)) continue;
    const focusDecoration = body.match(/(?:outline(?:-color)?|border-color|box-shadow)\s*:[^;]+;/g)?.join('\n') || '';
    assert.doesNotMatch(focusDecoration, /--focus-strong|var\(--info\)|#9a5100|#3b82f6|rgb\(59,\s*130,\s*246/i,
      `rejected focus color in ${selector.trim()}`);
    assert.doesNotMatch(focusDecoration, /box-shadow:\s*0 0 0 [23]px var\(--accent-primary/,
      `focus glow stacked with the ring in ${selector.trim()}`);
  }

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  page.setDefaultNavigationTimeout(5000);
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/src/') && pathname.endsWith('.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../..${pathname}`, import.meta.url), 'utf8') });
    } else if (pathname === '/styles/main.css') {
      await route.fulfill({ contentType: 'text/css', body: css });
    } else if (pathname === '/focus-visual-fixture') {
      await route.fulfill({ contentType: 'text/html', body: `
        <link rel="stylesheet" href="/styles/main.css">
        <style>
          *, *::before, *::after { transition: none !important; }
          #viewport { position: static; height: 40px; inset: auto; z-index: auto; }
        </style>
        <button id="before">Before</button>
        <button id="nav" class="nav-btn">Cases</button>
        <button id="button" class="btn">Action</button>
        <input id="input" class="input" aria-label="Name">
        <textarea id="textarea" aria-label="Notes"></textarea>
        <input id="check" type="checkbox" checked aria-label="Selected">
        <input id="range" class="input" type="range" aria-label="Opacity">
        <button id="select" class="tp3d-select" aria-label="Choice">Choice</button>
        <button id="notes" class="btn btn-ghost tp3d-management-notes-btn">Notes</button>
        <button id="warning" class="tp3d-editor-validation-status__btn" aria-label="Review">!</button>
        <div id="viewport" tabindex="0">Viewport</div>
        <div id="card" class="pack-card selected" tabindex="0">Selected card</div>
        <div class="table-wrap"><table><tbody><tr class="selected"><td id="row">Selected row</td></tr></tbody></table></div>
        <div id="option" class="tp3d-select-option is-selected"><span class="tp3d-select-option__check">✓</span>Selected option</div>
        <div id="current" class="tp3d-select-option is-active">Keyboard current option</div>` });
    } else await route.abort();
  });
  await page.goto('http://localhost:5500/focus-visual-fixture');
  await page.evaluate(async () => {
    const { createUIComponents } = await import('/src/ui/ui-components.js');
    createUIComponents();
  });
  const style = selector => page.locator(selector).evaluate(el => {
    const computed = getComputedStyle(el);
    return {
      outlineColor: computed.outlineColor,
      outlineWidth: computed.outlineWidth,
      outlineOffset: computed.outlineOffset,
      outlineStyle: computed.outlineStyle,
      borderColor: computed.borderColor,
      boxShadow: computed.boxShadow,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
    };
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await page.keyboard.press('Tab');
    for (const selector of ['#nav', '#button', '#input', '#textarea', '#check', '#range', '#select', '#notes', '#warning', '#viewport', '#card']) {
      await page.locator(selector).focus();
      const focused = await style(selector);
      assert.deepEqual([focused.outlineColor, focused.outlineWidth, focused.outlineStyle],
        ['rgb(255, 159, 28)', '2px', 'solid'], `${theme} ${selector} uses the shared brand ring`);
      assert.equal(focused.outlineOffset, selector === '#viewport' ? '-2px' : '2px');
    }
    for (const selector of ['#input', '#textarea', '#select']) {
      await page.locator('#before').focus();
      const resting = await style(selector);
      await page.locator(selector).focus();
      assert.equal(await page.locator(selector).evaluate(el => el.matches(':focus-visible')), true,
        `${theme} ${selector} is visibly focused`);
      const focused = await style(selector);
      assert.deepEqual([focused.outlineColor, focused.outlineWidth, focused.outlineStyle],
        ['rgb(255, 159, 28)', '2px', 'solid'], `${theme} ${selector} keeps the approved focus ring`);
      assert.equal(focused.boxShadow, 'none', `${theme} ${selector} has no focus glow`);
      assert.equal(focused.borderColor, resting.borderColor, `${theme} ${selector} keeps its resting border`);
    }
    await page.locator('#before').focus();
    assert.equal((await style('#card')).outlineStyle, 'none', 'selection alone does not add an outline');
    assert.match((await style('#card')).backgroundImage, /rgba\(255, 159, 28, 0\.12\)/);
    assert.equal((await style('#row')).backgroundColor, 'rgba(255, 159, 28, 0.12)');
    assert.equal((await style('#check')).backgroundColor, 'rgb(255, 159, 28)', 'checked fill is separate from focus');
    assert.notEqual((await style('#option')).backgroundColor, (await style('#current')).backgroundColor,
      'selected option tint differs from keyboard-current highlight');
    await page.locator('#button').click();
    assert.equal((await style('#button')).outlineStyle, 'none', `${theme} pointer button click has no keyboard ring`);
    await page.locator('#select').click();
    assert.equal((await style('#select')).outlineStyle, 'none', `${theme} pointer select click has no keyboard ring`);
    await page.locator('#notes').click();
    assert.equal((await style('#notes')).outlineStyle, 'none', `${theme} pointer Notes click has no keyboard ring`);
    await page.locator('#input').click();
    assert.equal((await style('#input')).outlineStyle, 'none', `${theme} pointer field click has no keyboard ring`);
    await page.keyboard.press('a');
    assert.equal((await style('#input')).outlineStyle, 'solid', `${theme} keyboard use restores the field ring`);
  }
});

test('Settings Resources Keyboard Shortcuts: native root card, in-pane reference, platform keys, quiet tokens', { timeout: 120000 }, async t => {
  const css = await readFile(new URL('../../styles/main.css', import.meta.url), 'utf8');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(3000);
  page.setDefaultNavigationTimeout(5000);
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/src/') && pathname.endsWith('.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../..${pathname}`, import.meta.url), 'utf8') });
    } else if (pathname === '/styles/main.css') {
      await route.fulfill({ contentType: 'text/css', body: css });
    } else if (pathname === '/resources-fixture') {
      await route.fulfill({ contentType: 'text/html', body: `
        <link rel="stylesheet" href="/styles/main.css">
        <style>*, *::before, *::after { transition: none !important; }</style>
        <div id="app"><button id="before">Page before</button></div>
        <div id="modal-root"></div><div id="toast-container"></div>` });
    } else await route.abort();
  });
  const MAC = { platform: 'MacIntel', uaPlatform: 'macOS' };
  const WINDOWS = { platform: 'Win32', uaPlatform: 'Windows' };
  const openResources = async platform => {
    await page.goto('http://localhost:5500/resources-fixture');
    await page.evaluate(async ({ platform, uaPlatform }) => {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform });
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({ platform: uaPlatform }) });
      const { createUIComponents } = await import('/src/ui/ui-components.js');
      window.ui = createUIComponents();
      const { createSettingsOverlay } = await import('/src/ui/overlays/settings-overlay.js');
      window.settings = createSettingsOverlay({ UIComponents: ui,
        PreferencesManager: { get: () => ({ units: { length: 'in', weight: 'lb' } }) }, Utils: {} });
      document.getElementById('before').focus();
      settings.open('resources');
    }, platform);
    await page.waitForSelector('.tp3d-resources-card-btn');
  };
  const headerTitle = () => page.locator('.tp3d-settings-right-title').textContent();
  const describeActive = () => page.evaluate(() => {
    const el = document.activeElement;
    return { inDialog: Boolean(el?.closest('[role="dialog"]')), tag: el?.tagName, name: el?.getAttribute('aria-label') ||
      el?.textContent.trim().slice(0, 40), inRightHeader: Boolean(el?.closest('.tp3d-settings-right-header')) };
  });
  // Open a Resources card by keyboard, record focus, go Back by keyboard, record focus.
  const roundTrip = async title => {
    await page.locator('.tp3d-resources-card-btn', { hasText: title }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(value => document.querySelector('.tp3d-settings-right-title')?.textContent === value, title);
    const opened = await describeActive();
    const back = page.locator('.tp3d-settings-right-header button').first();
    await back.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.tp3d-settings-right-title')?.textContent === 'Resources');
    return { opened, afterBack: await describeActive() };
  };

  await openResources(MAC);
  const cards = await page.locator('.tp3d-resources-card-btn').evaluateAll(buttons => buttons.map(button => {
    const icon = button.querySelector('.tp3d-resources-card-icon');
    const style = el => { const c = getComputedStyle(el); return [c.backgroundColor, c.borderTopColor, c.borderTopWidth,
      c.borderRadius, c.color, c.fontSize, c.padding].join('|'); };
    return {
      title: button.querySelector('.tp3d-resources-card-title').textContent,
      sub: button.querySelector('.tp3d-resources-card-sub').textContent,
      className: button.className, tag: button.tagName, type: button.type,
      iconClass: icon.querySelector('i').className, inline: [button, icon, icon.querySelector('i')].some(el => el.hasAttribute('style')),
      visual: [style(button), style(button.querySelector('.tp3d-resources-card-row')), style(icon),
        getComputedStyle(icon).width, style(button.querySelector('.tp3d-resources-card-title')),
        style(button.querySelector('.tp3d-resources-card-sub'))].join('#'),
      height: Math.round(button.getBoundingClientRect().height),
    };
  }));
  assert.deepEqual(cards.map(card => card.title), ['Release Notes', 'Roadmap', 'Keyboard Shortcuts',
    'Export App Backup', 'Import App Backup', 'Import / Export Help'], 'Keyboard Shortcuts sits with the help resources');
  const shortcutsCard = cards[2];
  assert.equal(shortcutsCard.sub, 'View keyboard and Editor controls.');
  assert.equal(shortcutsCard.iconClass, 'fa-solid fa-keyboard');
  assert.deepEqual([shortcutsCard.tag, shortcutsCard.type], ['BUTTON', 'button'], 'a real accessible button');
  assert.ok(cards.every(card => card.className === 'tp3d-resources-card-btn tp3d-settings-card--clickable'),
    'every root card uses the existing Resources card classes and never card--interactive');
  assert.ok(cards.every(card => !card.inline), 'no inline styles or icon sizes');
  assert.ok(cards.every(card => card.visual === cards[0].visual && card.height === cards[0].height),
    'the new card renders exactly like the existing Resources cards');
  assert.match(await page.locator('.tp3d-settings-right-subtitle').textContent(), /shortcuts/);

  const dialogCount = await page.getByRole('dialog').count();
  const ownerCount = await page.evaluate(() => ui.modalOwnership.getOwners().length);
  const roadmap = await roundTrip('Roadmap');
  const shortcuts = await roundTrip('Keyboard Shortcuts');
  t.diagnostic(`focus round-trip ${JSON.stringify(shortcuts)}`);
  assert.deepEqual(shortcuts, roadmap, 'focus on open and after Back matches the existing Resources subviews');
  assert.equal(await headerTitle(), 'Resources', 'Back returns to the Resources root');

  // Open the reference and inspect it in the same Settings dialog.
  await page.locator('.tp3d-resources-card-btn', { hasText: 'Keyboard Shortcuts' }).click();
  assert.equal(await headerTitle(), 'Keyboard Shortcuts');
  assert.equal(await page.locator('.tp3d-settings-right-subtitle').textContent(), 'Quick reference for keyboard and Editor controls.');
  assert.equal(await page.getByRole('dialog').count(), dialogCount, 'no nested modal');
  assert.equal(await page.evaluate(() => ui.modalOwnership.getOwners().length), ownerCount, 'no new modal owner');
  assert.deepEqual(await page.locator('[data-tab-panel="resources"] .tp3d-shortcuts-view > section').evaluateAll(sections =>
    sections.map(section => section.className)), Array(5).fill('tp3d-resources-card tp3d-shortcuts-section'),
  'rendered in the Resources pane, one existing Resources card per section');

  const readReference = () => page.locator('.tp3d-shortcuts-view').evaluate(card => {
    const spokenText = node => [...node.childNodes].map(child => {
      if (child.nodeType === Node.TEXT_NODE) return child.textContent;
      if (child.nodeType !== Node.ELEMENT_NODE || child.getAttribute('aria-hidden') === 'true') return '';
      return spokenText(child);
    }).join('');
    return {
      sections: [...card.querySelectorAll('section')].map(section => ({
        heading: section.querySelector('h3.tp3d-prefs-heading')?.textContent,
        rows: [...section.querySelectorAll('ul > li.tp3d-shortcuts-row')].map(row => ({
          action: row.querySelector('.tp3d-shortcuts-action').textContent,
          keys: [...row.querySelectorAll('.tp3d-shortcuts-keys > *')].map(el => el.textContent),
          spoken: spokenText(row),
        })),
      })),
      focusable: card.querySelectorAll('button, a, input, select, textarea, [tabindex]').length,
      kbdHidden: [...card.querySelectorAll('kbd')].every(kbd => kbd.closest('[aria-hidden="true"]') && kbd.tabIndex < 0),
      text: card.textContent,
    };
  });
  const expected = [
    ['General editing', [['Undo', '⌘ Z'], ['Redo', '⌘ ⇧ Z'], ['Select all cargo', '⌘ A'], ['Copy selected cargo', '⌘ C'],
      ['Paste copied cargo', '⌘ V'], ['Duplicate selected cargo', '⌘ D']]],
    ['Editor transforms', [['Turn selected cargo', 'R'], ['Tip selected cargo', 'T'], ['Roll selected cargo', 'E'],
      ['Flip selected cargo', 'F']]],
    ['Positioning', [['Nudge 1 inch', 'Arrow keys'], ['Nudge 6 inches', '⇧ Arrow keys'], ['Move up one level', '⌥ ↑'],
      ['Move down one level', '⌥ ↓'], ['Drop to nearest valid surface', '⌥ ⇧ ↓']]],
    ['Editor actions', [['Delete selected cargo', 'Delete'], ['Place held Case', 'Return'],
      ['Cancel move or clear selection', 'Esc']]],
    ['View', [['Toggle grid', 'G'], ['Toggle shadows', 'S']]],
  ];
  const mac = await readReference();
  assert.deepEqual(mac.sections.map(section => [section.heading, section.rows.map(row => [row.action, row.keys.join(' ')])]),
    expected, 'macOS shows ⌘ / ⌥ / ⇧ and Return');
  assert.equal(mac.focusable, 0, 'the reference has no interactive keycaps');
  assert.equal(mac.kbdHidden, true, 'keycaps are presentation only');
  assert.equal(mac.sections[0].rows[0].spoken, 'Undo, Command Z');
  assert.equal(mac.sections[2].rows[4].spoken, 'Drop to nearest valid surface, Option Shift Down Arrow');
  assert.doesNotMatch(mac.text, /Ctrl|Cmd|\bOpen\b|\bSave\b|Print|AutoPack|Focus|Deselect/,
    'no Ctrl/Cmd hybrid labels and no removed shortcuts');

  await openResources(WINDOWS);
  await page.locator('.tp3d-resources-card-btn', { hasText: 'Keyboard Shortcuts' }).click();
  const windows = await readReference();
  const windowsRows = Object.fromEntries(windows.sections.flatMap(section => section.rows.map(row => [row.action, row])));
  assert.equal(windowsRows.Undo.keys.join(' '), 'Ctrl Z');
  assert.equal(windowsRows.Redo.keys.join(' '), 'Ctrl Shift Z');
  assert.equal(windowsRows['Duplicate selected cargo'].keys.join(' '), 'Ctrl D');
  assert.equal(windowsRows['Move up one level'].keys.join(' '), 'Alt ↑');
  assert.equal(windowsRows['Delete selected cargo'].keys.join(' '), 'Delete or Backspace');
  assert.equal(windowsRows['Place held Case'].keys.join(' '), 'Enter');
  assert.equal(windowsRows.Undo.spoken, 'Undo, Control Z');
  assert.equal(windowsRows['Delete selected cargo'].spoken, 'Delete selected cargo, Delete or Backspace');
  assert.doesNotMatch(windows.text, /⌘|⌥|Cmd|Return/, 'Windows/Linux shows Ctrl / Alt / Shift conventions');

  // Keycaps, separators and headings follow the theme tokens: neutral, never the brand fill.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    const probe = await page.evaluate(() => {
      const token = name => {
        const el = document.createElement('div');
        el.style.color = `var(${name})`;
        document.body.appendChild(el);
        const value = getComputedStyle(el).color;
        el.remove();
        return value;
      };
      const kbd = getComputedStyle(document.querySelector('.tp3d-kbd'));
      const row = getComputedStyle(document.querySelector('.tp3d-shortcuts-row'));
      const heading = getComputedStyle(document.querySelector('.tp3d-shortcuts-section h3'));
      const section = getComputedStyle(document.querySelector('.tp3d-shortcuts-section'));
      return {
        section: [section.backgroundColor, section.borderTopColor, section.boxShadow],
        sectionTokens: [token('--bg-secondary'), token('--border-subtle'), 'none'],
        kbd: [kbd.backgroundColor, kbd.borderTopColor, kbd.color, kbd.boxShadow, kbd.backgroundImage],
        tokens: [token('--bg-primary'), token('--border-subtle'), token('--text-primary')],
        separator: row.borderBottomColor, heading: [heading.color, heading.textTransform, heading.fontSize],
        headingTokens: [token('--text-primary'), token('--border-subtle')], accent: token('--accent-primary'),
      };
    });
    assert.deepEqual(probe.kbd.slice(0, 3), probe.tokens, `${theme} keycaps use --bg-primary / --border-subtle / --text-primary`);
    assert.deepEqual(probe.kbd.slice(3), ['none', 'none'], `${theme} keycaps have no shadow or gradient`);
    assert.notEqual(probe.kbd[0], probe.accent, `${theme} keycaps are not orange`);
    assert.equal(probe.separator, probe.headingTokens[1], `${theme} row separators use --border-subtle`);
    assert.deepEqual(probe.heading, [probe.headingTokens[0], 'uppercase', '12px'],
      `${theme} headings keep the Settings heading pattern in the primary text color`);
    assert.deepEqual(probe.section, probe.sectionTokens, `${theme} section cards use the Resources card surface, no shadow`);
    t.diagnostic(`${theme} keycap ${probe.kbd.slice(0, 3).join(' / ')}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  // Narrow widths: rows may stack, but nothing overflows, clips or collides; the modal stays stable.
  for (const width of [899, 500, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.evaluate(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const modal = () => document.querySelector('.tp3d-settings-modal').getBoundingClientRect().toJSON();
      await frame(); await frame();
      const first = modal();
      await frame(); await frame(); await frame();
      const body = document.querySelector('.tp3d-settings-right-body');
      const problems = [];
      for (const row of document.querySelectorAll('.tp3d-shortcuts-row')) {
        const card = row.closest('.tp3d-shortcuts-section').getBoundingClientRect();
        const action = row.querySelector('.tp3d-shortcuts-action').getBoundingClientRect();
        const keys = row.querySelector('.tp3d-shortcuts-keys').getBoundingClientRect();
        const sameLine = keys.top < action.bottom - 1;
        if (sameLine && keys.left < action.right) problems.push(`collision: ${row.textContent}`);
        if (keys.right > card.right + 0.5 || action.right > card.right + 0.5) problems.push(`outside card: ${row.textContent}`);
        for (const kbd of row.querySelectorAll('kbd')) {
          const box = kbd.getBoundingClientRect();
          if (box.right > card.right + 0.5 || box.left < card.left - 0.5 || kbd.scrollWidth > kbd.clientWidth + 1) {
            problems.push(`clipped key: ${kbd.textContent}`);
          }
        }
      }
      return {
        problems, stable: JSON.stringify(first) === JSON.stringify(modal()),
        bodyOverflow: body.scrollWidth - body.clientWidth,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert.deepEqual(layout.problems, [], `${width}px: no clipped keycaps or text collisions`);
    assert.ok(layout.bodyOverflow <= 0 && layout.docOverflow <= 0, `${width}px: no horizontal overflow`);
    assert.equal(layout.stable, true, `${width}px: the Settings modal does not resize-oscillate`);
  }
});
