import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated DOM fixtures using the project's installed Playwright/Chromium.
// Every request is fulfilled locally: no app boot, session, API, or data writes.
test('P0-SM-OF-5 real DOM focus and keyboard behavior', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/src/') && pathname.endsWith('.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../..${pathname}`, import.meta.url), 'utf8') });
    } else if (pathname === '/focus-fixture') {
      await route.fulfill({ contentType: 'text/html', body: '<button id="before">Page before</button><div id="modal-root"></div><button id="after">Page after</button><div id="toast-container"></div>' });
    } else await route.abort();
  });
  const setup = async () => {
    await page.goto('http://localhost:5500/focus-fixture');
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
    await page.evaluate(() => { modal.close(); modal = make('<button id="zero">Zero</button><button id="two" tabindex="2">Two</button><button id="one" tabindex="1">One</button>', { hideClose: true, actions: [] }); });
    assert.equal(await active(), 'one');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'two');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'zero');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'one');
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
      window.blocker = ui.modalOwnership.register({ kind: 'auth', priority: 2 });
      document.getElementById('before').focus();
    });
    assert.equal(await active(), 'before', 'queued ordinary initial focus is suppressed');
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
    await setup();
    await page.evaluate(async () => {
      const { createSettingsOverlay } = await import('/src/ui/overlays/settings-overlay.js');
      window.settings = createSettingsOverlay({ UIComponents: ui, PreferencesManager: { get: () => ({ units: { length: 'in', weight: 'lb' } }) }, Utils: {} });
      settings.open('resources');
    });
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true);
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
    await page.getByRole('button', { name: 'Nested', exact: true }).click();
    assert.equal(await active(), 'Cancel');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Close Nested confirmation');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'Confirm', 'no Settings trap steals child Tab');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => settingsOwner.focusRoot.contains(document.activeElement)), true);
    await page.evaluate(() => settings.close());
    assert.equal(await page.getByRole('dialog').count(), 0);
  });
});
