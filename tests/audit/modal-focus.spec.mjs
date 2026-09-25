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
      window.tabControl = settingsOwner.focusRoot.querySelector('select');
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
