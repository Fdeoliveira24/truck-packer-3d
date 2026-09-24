import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { createUIComponents } from '../../src/ui/ui-components.js';
import { createKeyboardManager } from '../../src/ui/keyboard-manager.js';
import { createInteractionManager } from '../../src/screens/editor-screen.js';
import { createSettingsOverlay } from '../../src/ui/overlays/settings-overlay.js';
import { createAuthOverlay } from '../../src/ui/overlays/auth-overlay.js';
import { createSystemOverlay } from '../../src/ui/system-overlay.js';
import { createErrorOverlay } from '../../src/ui/error-overlay.js';

// Deterministic lifecycle/listener fixture, not a browser propagation proof.
// Real capture -> target -> bubble is additionally exercised in authenticated
// Chrome QA using Settings, nested dialogs, popups and Editor selection.
class Surface {
  listeners = [];
  addEventListener(type, fn, capture = false) {
    this.listeners.push({ type, fn, capture: Boolean(capture) });
  }
  removeEventListener(type, fn, capture = false) {
    this.listeners = this.listeners.filter(item =>
      item.type !== type || item.fn !== fn || item.capture !== Boolean(capture));
  }
  emit(type, event, capture = false) {
    for (const item of [...this.listeners]) {
      if (item.type === type && item.capture === capture) item.fn(event);
    }
  }
}

function installDom(t) {
  const original = new Map(['window', 'document', 'HTMLElement', 'THREE', 'requestAnimationFrame']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const doc = new Surface();
  class Element extends Surface {
    constructor(tag = 'div') {
      super();
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this.dataset = {};
      this.attributes = new Map();
      this.className = '';
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        contains: name => this.className.split(' ').includes(name),
        toggle: (name, on) => { this.classList[on ? 'add' : 'remove'](name); },
      };
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentElement = null; return child; }
    remove() { this.parentElement?.removeChild(this); }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    get isConnected() { return this === doc.body || Boolean(this.parentElement?.isConnected); }
    getBoundingClientRect() { return { left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40 }; }
    get firstChild() { return this.children[0] || null; }
    set innerHTML(value) { this.html = value; for (const child of [...this.children]) child.remove(); }
    get innerHTML() { return this.html || ''; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    matches(selector) {
      return selector.split(',').some(part => {
        const key = part.trim();
        if (key === '[data-dropdown="1"]') return this.dataset.dropdown === '1';
        if (/^\[[\w-]+\]$/.test(key)) return this.hasAttribute(key.slice(1, -1));
        return key.toUpperCase() === this.tagName;
      });
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    focus() { doc.activeElement = this; }
  }
  doc.body = new Element('body');
  doc.activeElement = doc.body;
  const roots = new Map(['modal-root', 'toast-container', 'system-overlay', 'system-title',
    'system-message', 'system-list', 'system-retry', 'error-overlay', 'error-title',
    'error-body', 'error-actions', 'error-icon'].map(id => [id, doc.body.appendChild(new Element())]));
  doc.getElementById = id => roots.get(id) || null;
  doc.createElement = tag => new Element(tag);
  doc.createTextNode = text => Object.assign(new Element('span'), { textContent: text });
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  doc.querySelector = selector => doc.body.querySelector(selector);
  const win = Object.assign(new Surface(), {
    setTimeout, clearTimeout, setInterval, clearInterval, innerWidth: 1200, innerHeight: 800,
    location: { reload() { throw new Error('Unexpected reload'); } },
  });
  Object.assign(globalThis, {
    window: win, document: doc, HTMLElement: Element, THREE,
    requestAnimationFrame: fn => { fn(); return 1; },
  });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const UI = createUIComponents();
  function key(keyName, target = doc.body, extra = {}) {
    const event = Object.assign({
      key: keyName, target, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    }, extra);
    return event;
  }
  function dispatch(event) {
    win.emit('keydown', event, true);
    if (!event.stopped) doc.emit('keydown', event, true);
    if (!event.stopped) event.target.emit('keydown', event);
    if (!event.stopped) doc.emit('keydown', event);
    if (!event.stopped) win.emit('keydown', event);
    return event;
  }
  return { doc, win, UI, roots, key, dispatch };
}

function installKeyboard(dom) {
  const state = { currentScreen: 'editor', selectedInstanceIds: ['cargo'] };
  const calls = { deselect: 0, selectAll: 0 };
  createKeyboardManager({
    UIComponents: dom.UI,
    StateStore: { get: key => state[key], set: patch => Object.assign(state, patch) },
    CaseScene: { setSelected: () => { calls.deselect++; } },
    InteractionManager: { selectAllInPack: () => { calls.selectAll++; } },
  }).init();
  return { state, calls };
}

test('P0-SM-OF-2 registry supports identity, precedence, nesting and independent release', t => {
  const { UI, doc, key } = installDom(t);
  const registry = UI.modalOwnership;
  assert.equal(registry.getActiveOwner(), null);
  assert.equal(registry.blocksKeyboardEvent(key('Escape')), false);
  const element = doc.body.appendChild(doc.createElement('div'));
  const button = element.appendChild(doc.createElement('button'));
  const parent = registry.register({ element, kind: 'settings' });
  assert.equal(registry.getActiveOwner(), parent);
  button.focus();
  const child = registry.register();
  assert.equal(child.parentId, parent.id);
  assert.ok(child.order > parent.order);
  const explicit = registry.register({ parentId: child.id });
  assert.equal(explicit.parentId, child.id);
  parent.release();
  parent.release();
  assert.equal(registry.getOwners().length, 2);
  assert.equal(child.parentId, parent.id, 'parent identity survives out-of-order release');
  child.release();
  assert.equal(registry.getActiveOwner(), explicit);
  const recovery = registry.register({ priority: 1, parentId: null });
  const ordinary = registry.register();
  assert.equal(registry.getActiveOwner(), recovery, 'recovery takes precedence over later ordinary owners');
  recovery.release();
  assert.equal(registry.getActiveOwner(), ordinary);
  explicit.release();
  ordinary.release();
  assert.deepEqual(registry.getOwners(), []);
});

test('P0-SM-OF-2 entry ownership survives release, stays event-local and refreshes on redispatch', t => {
  const { UI, win, key } = installDom(t);
  const registry = UI.modalOwnership;
  const unowned = key('Escape');
  win.emit('keydown', unowned, true);
  assert.equal(registry.blocksKeyboardEvent(unowned), false);
  const owner = registry.register();
  const owned = key('Escape');
  win.emit('keydown', owned, true);
  owner.release();
  assert.equal(registry.blocksKeyboardEvent(owned), true);
  assert.equal(owned.defaultPrevented, true, 'protected owner consumes Escape');
  assert.equal(owned.stopped, true);
  const next = key('Escape');
  win.emit('keydown', next, true);
  assert.equal(registry.blocksKeyboardEvent(next), false);
  win.emit('keydown', owned, true);
  assert.equal(registry.blocksKeyboardEvent(owned), false, 'a fresh dispatch replaces its snapshot');
  const lateOwner = registry.register();
  assert.equal(registry.blocksKeyboardEvent(next), true, 'current ownership also blocks a late-arriving key');
  lateOwner.release();
});

test('P0-SM-OF-2 generic lifecycle registers once, supports reentrancy and leaves no stale owners', t => {
  const { UI, roots, key, dispatch } = installDom(t);
  let closes = 0;
  let replacement;
  const modal = UI.showModal({ onClose() {
    closes++;
    modal.close();
    assert.equal(UI.modalOwnership.getActiveOwner(), null, 'released before callback');
    replacement = UI.showModal({});
  } });
  assert.equal(UI.modalOwnership.getActiveOwner(), modal.owner);
  dispatch(key('Escape', modal.modal));
  assert.equal(UI.modalOwnership.getActiveOwner(), replacement.owner, 'Escape dismisses exactly one owner');
  modal.close();
  modal.close();
  assert.equal(closes, 1);
  assert.equal(UI.modalOwnership.getOwners().length, 1);
  replacement.close();
  for (let i = 0; i < 10; i++) {
    const next = UI.showModal({});
    next.close();
    next.close();
  }
  assert.deepEqual(UI.modalOwnership.getOwners(), []);
  assert.equal(roots.get('modal-root').children.length, 0);
});

test('P0-SM-OF-2 KeyboardManager preserves unowned shortcuts and typing, blocks owned and consumed keys', t => {
  const dom = installDom(t);
  const { calls, state } = installKeyboard(dom);
  dom.dispatch(dom.key('a', dom.doc.body, { metaKey: true }));
  assert.equal(calls.selectAll, 1);
  for (const tag of ['input', 'textarea', 'select']) dom.dispatch(dom.key('Escape', dom.doc.createElement(tag)));
  dom.dispatch(dom.key('Escape', Object.assign(dom.doc.createElement('div'), { isContentEditable: true })));
  assert.equal(calls.deselect, 0);
  dom.dispatch(dom.key('Escape', dom.doc.body, { defaultPrevented: true }));
  assert.equal(calls.deselect, 0);
  const modal = dom.UI.showModal({});
  dom.dispatch(dom.key('a', modal.modal, { ctrlKey: true }));
  dom.dispatch(dom.key('Escape', modal.modal));
  assert.equal(calls.deselect, 0);
  assert.equal(calls.selectAll, 1);
  assert.deepEqual(state.selectedInstanceIds, ['cargo']);
  modal.close();
  dom.dispatch(dom.key('Escape'));
  assert.equal(calls.deselect, 1);
  assert.deepEqual(state.selectedInstanceIds, []);
  dom.dispatch(dom.key('a', dom.doc.body, { ctrlKey: true }));
  assert.equal(calls.selectAll, 2);
});

test('P0-SM-OF-2 actual document and Editor window listeners share the entry snapshot after capture closure', t => {
  const dom = installDom(t);
  const { calls } = installKeyboard(dom);
  let editorMutatingAttempts = 0;
  createInteractionManager({
    UIComponents: { ...dom.UI, showToast() {} },
    StateStore: { get: key => key === 'currentScreen' ? 'editor' : [] },
    CaseScene: {},
    OperationLifecycle: { isBusy() { editorMutatingAttempts++; return true; } },
  }).init(dom.doc.createElement('canvas'));
  const owner = dom.UI.modalOwnership.register({ onDismiss: () => owner.release() });
  const escape = dom.dispatch(dom.key('Escape'));
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null);
  assert.equal(dom.UI.modalOwnership.blocksKeyboardEvent(escape), true);
  assert.equal(calls.deselect, 0);
  const rotationOwner = dom.UI.modalOwnership.register();
  dom.doc.addEventListener('keydown', () => rotationOwner.release(), true);
  const rotation = dom.dispatch(dom.key('r'));
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null);
  assert.equal(editorMutatingAttempts, 0);
  assert.equal(rotation.defaultPrevented, false);
  dom.dispatch(dom.key('r', dom.doc.body, { defaultPrevented: true }));
  assert.equal(editorMutatingAttempts, 0);
  dom.dispatch(dom.key('r', dom.doc.createElement('input')));
  assert.equal(editorMutatingAttempts, 0);
  assert.equal(dom.dispatch(dom.key('r')).defaultPrevented, true);
  assert.equal(editorMutatingAttempts, 1, 'ordinary Editor dispatch resumes');
  dom.dispatch(dom.key('Escape'));
  assert.equal(calls.deselect, 1);
});

test('P0-SM-OF-2 unowned Escape still cancels a live gizmo drag after KeyboardManager consumes it', t => {
  const dom = installDom(t);
  const { calls } = installKeyboard(dom);
  const controls = { enabled: true };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  handle.userData.gizmoHandle = 'y';
  handle.updateMatrixWorld();
  t.after(() => { handle.geometry.dispose(); handle.material.dispose(); });
  const cargo = { position: new THREE.Vector3() };
  const canvas = dom.doc.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  canvas.setPointerCapture = () => {};
  createInteractionManager({
    UIComponents: dom.UI,
    StateStore: { get: key => key === 'currentScreen' ? 'editor' : ['cargo'] },
    SceneManager: { getCamera: () => camera, getControls: () => controls },
    CaseScene: {
      getGizmoHandleMeshes: () => [handle], getGizmoTargetId: () => 'cargo',
      getObject: () => cargo, setDragging() {}, setGizmoActive() {},
      updateGizmoTransform() {}, setCollision() {}, refreshGizmo() {}, setHover() {},
    },
  }).init(canvas);
  canvas.emit('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
  assert.equal(controls.enabled, false, 'actual pointer handler began a gizmo drag');
  cargo.position.y = 5;
  const owner = dom.UI.modalOwnership.register({ onDismiss: () => owner.release() });
  dom.dispatch(dom.key('Escape', canvas));
  assert.equal(controls.enabled, false, 'owned Escape cannot reach drag cancellation, even after capture close');
  assert.equal(cargo.position.y, 5);
  assert.equal(calls.deselect, 0);
  const nextEscape = dom.dispatch(dom.key('Escape', canvas));
  assert.equal(nextEscape.defaultPrevented, true);
  assert.equal(calls.deselect, 1, 'KeyboardManager handled ordinary Escape first');
  assert.equal(controls.enabled, true, 'Editor continuation releases camera controls');
  assert.equal(cargo.position.y, 0, 'Editor continuation restores the drag start');
});

test('P0-SM-OF-2 Settings reuses, closes, reopens and cleans disconnected ownership', t => {
  const dom = installDom(t);
  const { calls } = installKeyboard(dom);
  const settings = createSettingsOverlay({
    UIComponents: dom.UI, documentRef: dom.doc,
    PreferencesManager: { get: () => ({}) }, Utils: {},
  });
  for (let i = 0; i < 3; i++) {
    const unrelated = dom.UI.showModal({});
    unrelated.modal.focus();
    settings.open('resources');
    const owner = dom.UI.modalOwnership.getActiveOwner();
    assert.equal(owner.kind, 'settings');
    assert.equal(owner.parentId, null, 'Settings remains a root even when another modal had focus');
    unrelated.close();
    settings.open('resources');
    assert.equal(dom.UI.modalOwnership.getActiveOwner(), owner);
    dom.dispatch(dom.key('Escape', owner.element));
    assert.equal(settings.isOpen(), false);
    assert.equal(dom.UI.modalOwnership.getActiveOwner(), null);
    assert.equal(calls.deselect, 0, 'legacy capture close must not expose this event');
    settings.close();
  }
  settings.open('resources');
  const stale = dom.UI.modalOwnership.getActiveOwner();
  stale.element.remove();
  settings.open('resources');
  const next = dom.UI.modalOwnership.getActiveOwner();
  assert.notEqual(next.id, stale.id);
  assert.deepEqual(dom.UI.modalOwnership.getOwners(), [next]);
  stale.element._tp3dCleanup();
  assert.deepEqual(dom.UI.modalOwnership.getOwners(), [next]);
  dom.dispatch(dom.key('Escape', next.element));
  assert.equal(settings.isOpen(), false, 'stale cleanup cannot remove the new capture handler');
  dom.dispatch(dom.key('Escape'));
  assert.equal(calls.deselect, 1);
});

test('P0-SM-OF-2 Auth and recovery register presence idempotently without new dismissal', t => {
  const dom = installDom(t);
  const system = createSystemOverlay({ UIComponents: dom.UI });
  const error = createErrorOverlay({ UIComponents: dom.UI });
  const auth = createAuthOverlay({ UIComponents: dom.UI });
  system.show({});
  const systemOwner = dom.UI.modalOwnership.getActiveOwner();
  system.show({ title: 'Updated' });
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), systemOwner);
  error.showNotFound();
  const errorOwner = dom.UI.modalOwnership.getActiveOwner();
  error.showFatal();
  error.showMaintenance();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), errorOwner);
  const ordinary = dom.UI.showModal({});
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), errorOwner);
  auth.show();
  const authOwner = dom.UI.modalOwnership.getActiveOwner();
  assert.equal(authOwner.kind, 'auth');
  assert.equal(authOwner.parentId, null);
  auth.show();
  assert.equal(dom.UI.modalOwnership.getOwners().length, 4);
  dom.dispatch(dom.key('Escape'));
  assert.equal(auth.isOpen(), true);
  auth.hide();
  auth.hide();
  dom.dispatch(dom.key('Escape'));
  assert.equal(error.isVisible(), true);
  assert.equal(dom.roots.get('system-overlay').classList.contains('active'), true);
  error.hide();
  error.hide();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), systemOwner);
  system.hide();
  system.hide();
  ordinary.close();
  assert.deepEqual(dom.UI.modalOwnership.getOwners(), []);
});

test('P0-SM-OF-3 Settings popup and child consume one Escape at a time without background effects', async t => {
  const dom = installDom(t);
  const { calls, state } = installKeyboard(dom);
  const settings = createSettingsOverlay({
    UIComponents: dom.UI, documentRef: dom.doc,
    PreferencesManager: { get: () => ({}) }, Utils: {},
  });
  const registry = dom.UI.modalOwnership;
  for (let i = 0; i < 3; i++) {
    settings.open('resources');
    const parent = registry.getActiveOwner();
    const anchor = parent.element.appendChild(dom.doc.createElement('button'));
    const popup = dom.UI.openDropdown(anchor, []);
    const popupOwner = registry.getActiveOwner();
    assert.equal(popupOwner.parentId, parent.id);
    assert.equal(popup.parentElement.className, 'modal-popup-host');
    assert.equal(popup.parentElement.parentElement, parent.element);
    const escape = dom.dispatch(dom.key('Escape', anchor));
    assert.equal(registry.getEscapeClaim(escape), popupOwner.id);
    assert.equal(registry.blocksKeyboardEvent(escape), true);
    assert.equal(popup.isConnected, false);
    assert.equal(settings.isOpen(), true);
    popupOwner.release();
    assert.deepEqual(registry.getOwners(), [parent]);
    anchor.focus();
    let settlements = 0;
    const result = dom.UI.confirm({ title: 'Child' }).then(value => { settlements++; return value; });
    const child = registry.getActiveOwner();
    assert.equal(child.parentId, parent.id);
    dom.dispatch(dom.key('Escape', anchor));
    assert.equal(await result, false);
    assert.equal(settlements, 1);
    assert.equal(settings.isOpen(), true);
    assert.equal(child.element.isConnected, false);
    assert.deepEqual(registry.getOwners(), [parent]);
    dom.dispatch(dom.key('Escape', anchor));
    assert.equal(settings.isOpen(), false);
    assert.deepEqual(registry.getOwners(), []);
    assert.deepEqual(state.selectedInstanceIds, ['cargo']);
    assert.equal(calls.deselect, 0);
  }
  dom.dispatch(dom.key('Escape'));
  assert.equal(calls.deselect, 1);
});

test('P0-SM-OF-3 later child supersedes popup; parent teardown removes children and popup exactly once', t => {
  const { UI, doc, dispatch, key } = installDom(t);
  const parent = UI.showModal({});
  const anchor = parent.body.appendChild(doc.createElement('button'));
  const popup = UI.openDropdown(anchor, []);
  const popupOwner = UI.modalOwnership.getActiveOwner();
  let closes = 0;
  const child = UI.showModal({ parentOwnerId: parent.owner.id, onClose: () => { closes++; } });
  dispatch(key('Escape'));
  assert.equal(closes, 1);
  assert.equal(UI.modalOwnership.getActiveOwner(), popupOwner);
  assert.equal(popup.isConnected, true);
  assert.equal(child.overlay.isConnected, false);
  const other = UI.showModal({ parentOwnerId: parent.owner.id, onClose: () => { closes++; } });
  parent.close();
  parent.close();
  assert.equal(popup.isConnected, false);
  assert.equal(other.overlay.isConnected, false);
  assert.equal(closes, 2);
  assert.deepEqual(UI.modalOwnership.getOwners(), []);
  UI.closeAllDropdowns();
});

test('P0-SM-OF-3 user dismissal can be vetoed dynamically; programmatic close remains independent', t => {
  const { UI, dispatch, key } = installDom(t);
  let busy = true;
  let closes = 0;
  const modal = UI.showModal({ canDismiss: () => !busy, onClose: () => { closes++; } });
  assert.equal(dispatch(key('Escape')).defaultPrevented, true);
  modal.modal.children[0].children[1].emit('click', {});
  modal.overlay.emit('click', { target: modal.overlay });
  assert.equal(closes, 0);
  busy = false;
  assert.equal(modal.requestDismiss('escape'), true);
  assert.equal(closes, 1);
  const protectedModal = UI.showModal({ dismissible: false, canDismiss: () => false });
  dispatch(key('Escape'));
  assert.equal(protectedModal.overlay.isConnected, true);
  protectedModal.close();
  assert.deepEqual(UI.modalOwnership.getOwners(), []);
});

test('P0-SM-OF-3 page dropdowns retain body mounting and the shared Escape path', t => {
  const { UI, doc, dispatch, key } = installDom(t);
  const anchor = doc.body.appendChild(doc.createElement('button'));
  const popup = UI.openDropdown(anchor, []);
  assert.equal(popup.parentElement, doc.body);
  assert.equal(popup.style.zIndex, '16000');
  assert.equal(UI.modalOwnership.getActiveOwner().parentId, null);
  dispatch(key('Escape', anchor));
  assert.equal(popup.isConnected, false);
  assert.equal(UI.modalOwnership.getActiveOwner(), null);
});

test('P0-SM-OF-3 persistent surface registration and cleanup are idempotent across re-registration', t => {
  const { UI, dispatch, key } = installDom(t);
  let open = false;
  let closes = 0;
  const surface = { isOpen: () => open, close: () => { open = false; closes++; } };
  const release = UI.registerDropdownSurface(surface);
  assert.equal(UI.registerDropdownSurface(surface), release);
  assert.equal(UI.modalOwnership.getOwners().length, 1);
  assert.equal(UI.modalOwnership.blocksKeyboardEvent(key('a')), false, 'inactive surfaces do not block shortcuts');
  open = true;
  dispatch(key('Escape'));
  assert.equal(closes, 1);
  release();
  release();
  assert.deepEqual(UI.modalOwnership.getOwners(), []);
  const nextRelease = UI.registerDropdownSurface(surface);
  release();
  assert.equal(UI.modalOwnership.getOwners().length, 1, 'stale cleanup cannot unregister a new registration');
  nextRelease();
  open = true;
  assert.equal(UI.modalOwnership.blocksKeyboardEvent(key('Escape')), false, 'no orphaned active owner remains');
});

test('P0-SM-OF-3 dropdown-launched dialogs retain their modal parent after popup teardown', t => {
  const { UI, doc, dispatch, key } = installDom(t);
  const parent = UI.showModal({});
  const anchor = parent.body.appendChild(doc.createElement('button'));
  let child;
  const popup = UI.openDropdown(anchor, [{ label: 'Child', onClick: () => { child = UI.showModal({}); } }]);
  const item = popup.querySelector('button');
  item.focus();
  item.emit('click', { stopPropagation() {} });
  assert.equal(popup.isConnected, false);
  assert.equal(child.owner.parentId, parent.owner.id);
  assert.equal(child.overlay.isConnected, true);
  dispatch(key('Escape'));
  assert.equal(child.overlay.isConnected, false);
  assert.equal(parent.overlay.isConnected, true);
  parent.close();
});

test('P0-SM-OF-3 protected import-style modal consumes Escape and preserves existing X and Cancel', t => {
  const { UI, dispatch, key } = installDom(t);
  let closes = 0;
  const config = { dismissible: false, actions: [{ label: 'Cancel' }], onClose: () => { closes++; } };
  const first = UI.showModal(config);
  dispatch(key('Escape'));
  assert.equal(closes, 0);
  first.modal.children[0].children[1].emit('click', {});
  assert.equal(closes, 1);
  const second = UI.showModal(config);
  dispatch(key('Escape'));
  second.modal.children[2].children[0].emit('click', {});
  assert.equal(closes, 2);
  assert.equal(UI.modalOwnership.getActiveOwner(), null);
});

test('P0-SM-OF-2 pre-boot error renderer publishes presence only when shown', t => {
  const dom = installDom(t);
  const error = createErrorOverlay({ UIComponents: dom.UI });
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('boot.showAppStatusOverlay ='));
  assert.ok(script);
  vm.runInNewContext(script, { window: dom.win, document: dom.doc });
  dom.win.__TP3D_BOOT.onAppStatusOverlayShown = error.registerPresence;
  dom.win.__TP3D_BOOT.showAppStatusOverlay('fatal');
  assert.equal(dom.UI.modalOwnership.getActiveOwner().kind, 'error');
  error.hide();
  dom.win.__TP3D_BOOT.showAppStatusOverlay('fatal');
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null, 'ignored duplicate fatal must not claim a hidden root');
  dom.win.__TP3D_BOOT.showAppStatusOverlay('maintenance');
  assert.equal(dom.UI.modalOwnership.getActiveOwner().kind, 'error');
  error.hide();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null);
});
