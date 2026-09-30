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
    removeAttribute(key) { this.attributes.delete(key); }
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
    dispatchEvent(event) { this.emit(event.type, event); return true; }
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
  const state = { currentScreen: 'editor', currentPackId: 'pack', selectedInstanceIds: ['cargo'] };
  const calls = { deselect: 0, selectAll: 0 };
  const pack = { id: 'pack', cases: [{ id: 'cargo' }] };
  createKeyboardManager({
    UIComponents: dom.UI,
    StateStore: { get: key => state[key], set: patch => Object.assign(state, patch) },
    PackLibrary: { getById: id => (id === pack.id ? pack : null) },
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

// The real KeyboardManager over stub collaborators: every call is recorded so a
// test can tell an owned key (acted + prevented) from a pass-through (neither).
function installOwnedKeyboard(dom) {
  const viewport = dom.doc.body.appendChild(dom.doc.createElement('div'));
  const getRoot = dom.doc.getElementById;
  dom.doc.getElementById = id => (id === 'viewport' ? viewport : getRoot(id));
  const pack = { id: 'pack', cases: [{ id: 'cargo', caseId: 'case' }, { id: 'other', caseId: 'case' }] };
  const state = { currentScreen: 'editor', currentPackId: 'pack', selectedInstanceIds: ['cargo'] };
  const calls = { undo: 0, redo: 0, selectAll: 0, delete: 0, duplicate: [], grid: 0, shadows: 0, toasts: [] };
  let busy = false;
  let copyIndex = 0;
  createKeyboardManager({
    UIComponents: { ...dom.UI, showToast: message => calls.toasts.push(message) },
    StateStore: {
      get: key => state[key], set: patch => Object.assign(state, patch),
      undo: () => { calls.undo++; return true; }, redo: () => { calls.redo++; return true; },
    },
    PackLibrary: {
      getById: id => (id === pack.id ? pack : null),
      duplicateInstancesSafely: (_packId, source) => {
        calls.duplicate.push(source.map(inst => inst.id));
        const copies = source.map(inst => ({ ...inst, id: `copy-${++copyIndex}` }));
        pack.cases.push(...copies);
        return { newIds: copies.map(inst => inst.id), placement: 'packed' };
      },
    },
    CaseLibrary: { getCases: () => [] },
    CaseScene: { setSelected() {} },
    SceneManager: { toggleGrid: () => { calls.grid++; return true; }, toggleShadows: () => { calls.shadows++; return true; } },
    InteractionManager: {
      selectAllInPack: () => { calls.selectAll++; }, deleteSelection: () => { calls.delete++; },
    },
    OperationLifecycle: { isBusy: () => busy },
    Utils: { deepClone: value => JSON.parse(JSON.stringify(value)) },
  }).init();
  const cmd = { metaKey: true };
  const ctrl = { ctrlKey: true };
  const press = (key, target = dom.doc.body, extra = {}) => dom.dispatch(dom.key(key, target, extra));
  return { viewport, state, calls, cmd, ctrl, press, setBusy: value => { busy = value; } };
}

test('Shortcut contract: removed Cmd/Ctrl+O, Cmd/Ctrl+S and Cmd/Ctrl+Shift+A stay with the browser', t => {
  const dom = installDom(t);
  const kb = installOwnedKeyboard(dom);
  for (const screen of ['editor', 'packs']) {
    kb.state.currentScreen = screen;
    for (const modifier of [kb.cmd, kb.ctrl]) {
      for (const [key, extra] of [['o', {}], ['s', {}], ['a', { shiftKey: true }], ['A', { shiftKey: true }]]) {
        const event = kb.press(key, dom.doc.body, { ...modifier, ...extra });
        assert.equal(event.defaultPrevented, false, `${screen} ${JSON.stringify(modifier)} ${key}: not intercepted`);
      }
    }
  }
  assert.deepEqual(kb.state.selectedInstanceIds, ['cargo'], 'Cmd/Ctrl+Shift+A no longer deselects');
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null, 'Cmd/Ctrl+O opens no Load Plan dialog');
  assert.deepEqual(kb.calls.toasts, [], 'Cmd/Ctrl+S shows no save feedback');
});

test('Shortcut contract: Cmd/Ctrl+D duplicates only in a valid Editor context, once per press', t => {
  const dom = installDom(t);
  const kb = installOwnedKeyboard(dom);
  for (const modifier of [kb.cmd, kb.ctrl]) {
    const owned = kb.press('d', dom.doc.body, modifier);
    assert.equal(owned.defaultPrevented, true, 'Editor + selected cargo owns Duplicate');
  }
  assert.equal(kb.calls.duplicate.length, 2);
  assert.deepEqual(kb.calls.duplicate[0], ['cargo']);
  const held = kb.press('d', dom.doc.body, { ...kb.ctrl, repeat: true });
  assert.equal(held.defaultPrevented, true, 'an auto-repeat stays owned so Bookmark cannot open mid-hold');
  assert.equal(kb.calls.duplicate.length, 2, 'auto-repeat never duplicates again');

  const passes = label => {
    const before = kb.calls.duplicate.length;
    for (const modifier of [kb.cmd, kb.ctrl]) {
      assert.equal(kb.press('d', dom.doc.body, modifier).defaultPrevented, false, `${label}: Bookmark stays available`);
    }
    assert.equal(kb.calls.duplicate.length, before, `${label}: nothing is duplicated`);
  };
  kb.setBusy(true);
  passes('busy operation');
  kb.setBusy(false);
  kb.state.selectedInstanceIds = ['missing'];
  passes('stale selection');
  kb.state.selectedInstanceIds = [];
  passes('empty selection');
  kb.state.selectedInstanceIds = ['cargo'];
  kb.state.currentScreen = 'packs';
  passes('Load Plans screen');
  kb.state.currentScreen = 'editor';
  const modal = dom.UI.showModal({});
  passes('modal owner');
  modal.close();
  assert.equal(kb.press('d', dom.doc.createElement('input'), kb.cmd).defaultPrevented, false, 'text fields keep native keys');
});

test('Shortcut contract: Copy, Paste and Select All are owned only when they act', t => {
  const dom = installDom(t);
  const kb = installOwnedKeyboard(dom);
  // Paste with an empty app clipboard is native Paste.
  assert.equal(kb.press('v', dom.doc.body, kb.cmd).defaultPrevented, false);
  assert.equal(kb.calls.duplicate.length, 0);
  // Copy with selected cargo is the app's.
  assert.equal(kb.press('c', dom.doc.body, kb.cmd).defaultPrevented, true);
  assert.match(kb.calls.toasts.at(-1), /Copied 1 case/);
  assert.equal(kb.press('c', dom.doc.body, { ...kb.ctrl, repeat: true }).defaultPrevented, true);
  assert.equal(kb.calls.toasts.filter(message => /Copied/.test(message)).length, 1, 'held Copy does not repeat its toast');
  // Paste with a usable app clipboard is the app's, once per press.
  assert.equal(kb.press('v', dom.doc.body, kb.ctrl).defaultPrevented, true);
  assert.deepEqual(kb.calls.duplicate, [['cargo']]);
  assert.equal(kb.press('v', dom.doc.body, { ...kb.cmd, repeat: true }).defaultPrevented, true);
  assert.equal(kb.calls.duplicate.length, 1, 'auto-repeat never pastes again');
  // Without selected cargo, off-Editor or in a text field, Copy is native.
  kb.state.selectedInstanceIds = [];
  assert.equal(kb.press('c', dom.doc.body, kb.cmd).defaultPrevented, false, 'nothing selected: native text Copy');
  kb.state.selectedInstanceIds = ['cargo'];
  assert.equal(kb.press('c', dom.doc.createElement('textarea'), kb.cmd).defaultPrevented, false);
  kb.state.currentScreen = 'cases';
  for (const key of ['c', 'v', 'a']) {
    assert.equal(kb.press(key, dom.doc.body, kb.cmd).defaultPrevented, false, `off-Editor ${key}: native behavior`);
  }
  // Select All is the app's only in the Editor with Pack cargo.
  kb.state.currentScreen = 'editor';
  assert.equal(kb.press('a', dom.doc.body, kb.ctrl).defaultPrevented, true);
  assert.equal(kb.calls.selectAll, 1);
  assert.equal(kb.press('a', dom.doc.body, { ...kb.cmd, repeat: true }).defaultPrevented, true);
  assert.equal(kb.calls.selectAll, 1, 'held Select All does not repeat');
  assert.equal(kb.press('a', dom.doc.createElement('input'), kb.cmd).defaultPrevented, false, 'text Select All stays native');
  kb.state.currentPackId = 'none';
  assert.equal(kb.press('a', dom.doc.body, kb.cmd).defaultPrevented, false, 'no Pack cargo: native Select All');
  assert.equal(kb.calls.selectAll, 1);
});

test('Shortcut contract: Undo/Redo are Editor-only, text-safe, and reach checkboxes', t => {
  const dom = installDom(t);
  const kb = installOwnedKeyboard(dom);
  assert.equal(kb.press('z', dom.doc.body, kb.cmd).defaultPrevented, true);
  assert.equal(kb.press('z', dom.doc.body, { ...kb.ctrl, shiftKey: true }).defaultPrevented, true);
  assert.deepEqual([kb.calls.undo, kb.calls.redo], [1, 1]);
  for (const tag of ['input', 'textarea']) {
    assert.equal(kb.press('z', dom.doc.createElement(tag), kb.cmd).defaultPrevented, false, `${tag}: native text Undo`);
  }
  const checkbox = Object.assign(dom.doc.createElement('input'), { type: 'checkbox' });
  const radio = Object.assign(dom.doc.createElement('input'), { type: 'radio' });
  assert.equal(kb.press('z', checkbox, kb.ctrl).defaultPrevented, true, 'a checkbox is not a text field');
  assert.equal(kb.press('Escape', radio).defaultPrevented, true, 'Escape still deselects from a radio');
  assert.deepEqual(kb.state.selectedInstanceIds, []);
  assert.equal(kb.press(' ', checkbox).defaultPrevented, false, 'Space toggling stays native');
  assert.deepEqual([kb.calls.undo, kb.calls.redo], [2, 1]);
  kb.state.currentScreen = 'packs';
  assert.equal(kb.press('z', dom.doc.body, kb.cmd).defaultPrevented, false, 'outside the Editor: browser Undo');
  assert.equal(kb.press('z', dom.doc.body, { ...kb.cmd, shiftKey: true }).defaultPrevented, false);
  assert.deepEqual([kb.calls.undo, kb.calls.redo], [2, 1]);
});

test('Shortcut contract: G/S and Delete are bare, viewport-owned Editor keys; Escape owns only a selection', t => {
  const dom = installDom(t);
  const kb = installOwnedKeyboard(dom);
  assert.equal(kb.press('g', kb.viewport).defaultPrevented, true);
  assert.equal(kb.press('s', kb.viewport).defaultPrevented, true);
  assert.equal(kb.press('g', kb.viewport, { repeat: true }).defaultPrevented, true);
  assert.deepEqual([kb.calls.grid, kb.calls.shadows], [1, 1], 'auto-repeat never toggles again');
  for (const extra of [kb.cmd, kb.ctrl, { altKey: true }, { shiftKey: true }]) {
    assert.equal(kb.press('g', kb.viewport, extra).defaultPrevented, false, `G with ${JSON.stringify(extra)}`);
    assert.equal(kb.press('s', kb.viewport, extra).defaultPrevented, false, `S with ${JSON.stringify(extra)}`);
  }
  assert.equal(kb.press('g', dom.doc.body).defaultPrevented, false, 'G off the viewport is not a shortcut');
  assert.equal(kb.press('Delete', dom.doc.body).defaultPrevented, false);
  assert.equal(kb.press('Backspace', kb.viewport).defaultPrevented, true);
  assert.equal(kb.calls.delete, 1);
  kb.state.currentScreen = 'packs';
  for (const key of ['g', 's', 'Delete', 'Backspace']) {
    assert.equal(kb.press(key, kb.viewport).defaultPrevented, false, `off-Editor ${key}: not intercepted`);
  }
  assert.deepEqual([kb.calls.grid, kb.calls.shadows, kb.calls.delete], [1, 1, 1]);
  assert.equal(kb.press('Escape').defaultPrevented, false, 'off-Editor Escape is free for the next owner');
  assert.deepEqual(kb.state.selectedInstanceIds, ['cargo']);
  kb.state.currentScreen = 'editor';
  assert.equal(kb.press('Escape').defaultPrevented, true, 'Escape owns an Editor selection');
  assert.deepEqual(kb.state.selectedInstanceIds, []);
  assert.equal(kb.press('Escape').defaultPrevented, false, 'with nothing selected, Escape passes on');
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
  }).init(dom.doc.body.appendChild(dom.doc.createElement('div')).appendChild(dom.doc.createElement('canvas')));
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
  assert.equal(dom.dispatch(dom.key('r')).defaultPrevented, false, 'unfocused Editor key does not rotate');
  const viewport = dom.doc.body.children.at(-1);
  assert.equal(dom.dispatch(dom.key('r', viewport)).defaultPrevented, true);
  assert.equal(editorMutatingAttempts, 1, 'focused viewport dispatch resumes');
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

test('Editor pointer cancellation restores gizmo pose and camera without committing', t => {
  const dom = installDom(t);
  const controls = { enabled: true };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  handle.userData.gizmoHandle = 'y';
  handle.updateMatrixWorld();
  t.after(() => { handle.geometry.dispose(); handle.material.dispose(); });
  const cargo = { position: new THREE.Vector3() };
  const selection = ['cargo'];
  const canvas = dom.doc.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  canvas.setPointerCapture = () => {};
  createInteractionManager({
    UIComponents: dom.UI,
    StateStore: { get: key => key === 'currentScreen' ? 'editor' : selection },
    SceneManager: { getCamera: () => camera, getControls: () => controls },
    CaseScene: {
      getGizmoHandleMeshes: () => [handle], getGizmoTargetId: () => 'cargo',
      getObject: () => cargo, setDragging() {}, setGizmoActive() {},
      updateGizmoTransform() {}, setCollision() {}, refreshGizmo() {}, setHover() {},
    },
  }).init(canvas);
  canvas.emit('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
  assert.equal(controls.enabled, false);
  cargo.position.y = 5;
  canvas.emit('pointercancel', { pointerId: 1 });
  assert.equal(cargo.position.y, 0);
  assert.equal(controls.enabled, true);
  assert.deepEqual(selection, ['cargo']);
  canvas.emit('lostpointercapture', { pointerId: 1 });
  assert.equal(cargo.position.y, 0, 'a following lost-capture event is harmless');
});

// Real InteractionManager over stub collaborators: the gizmo stroke and its
// not-directly-valid release run the production pointer handlers, so a held
// (scene-only) pose and a live drag are the genuine Editor states.
function installProvisionalEditor(t, dom) {
  const controls = { enabled: true };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  handle.userData.gizmoHandle = 'y';
  handle.updateMatrixWorld();
  t.after(() => { handle.geometry.dispose(); handle.material.dispose(); });
  const cargo = new THREE.Object3D();
  cargo.userData.halfWorld = { x: 0.5, y: 0.5, z: 0.5 };
  const inst = { id: 'cargo', caseId: 'case', placement: 'packed',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } };
  const pack = { id: 'pack', cases: [inst] };
  const state = { currentScreen: 'editor', currentPackId: 'pack', selectedInstanceIds: ['cargo'] };
  const commits = [];
  const toasts = [];
  let placement = { ok: false, code: 'support-rules', reason: 'Needs support below.' };
  const viewport = dom.doc.body.appendChild(dom.doc.createElement('div'));
  const canvas = viewport.appendChild(dom.doc.createElement('canvas'));
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  canvas.setPointerCapture = () => {};
  createInteractionManager({
    UIComponents: { ...dom.UI, showToast: message => toasts.push(message) },
    StateStore: { get: key => state[key], set: patch => Object.assign(state, patch) },
    SceneManager: {
      getCamera: () => camera, getControls: () => controls, toWorld: value => value,
      vecWorldToInches: v => ({ x: v.x, y: v.y, z: v.z }),
      vecInchesToWorld: p => new THREE.Vector3(p.x, p.y, p.z),
    },
    CaseScene: {
      getGizmoHandleMeshes: () => [handle], getGizmoTargetId: () => 'cargo', getGizmoTargetMode: () => 'packed',
      getObject: () => cargo, setDragging() {}, setGizmoActive() {}, updateGizmoTransform() {},
      setCollision() {}, refreshGizmo() {}, setHover() {}, setSelected() {}, applyOOGHighlights() {}, sync() {},
      checkCollision: () => ({ collides: false, insideTruck: true }), settleY: () => null,
    },
    PackLibrary: {
      getById: () => pack,
      isOrientationAllowedByCasePolicy: () => true,
      findManualVerticalPlacement: (_pack, _cases, _id, options) => ({ ...placement, mode: options.mode }),
      updateCasesWithManualRevalidation: (...args) => { commits.push(args); return { pack, stagedIds: [] }; },
    },
    CaseLibrary: { getById: () => ({ id: 'case', dimensions: { length: 1, width: 1, height: 1 } }), getCases: () => [] },
    OperationLifecycle: { isBusy: () => false },
  }).init(canvas);
  const press = (key, extra) => dom.dispatch(dom.key(key, viewport, extra));
  const beginStroke = () => canvas.emit('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
  const endStroke = () => dom.win.emit('pointerup', { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
  return { cargo, controls, commits, toasts, press, beginStroke, endStroke,
    allowPlacement: position => { placement = { ok: true, position }; } };
}

test('Editor provisional pose owns R/T/E/F and arrow keys until it is placed or cancelled', t => {
  const dom = installDom(t);
  const editor = installProvisionalEditor(t, dom);
  editor.beginStroke();
  editor.cargo.position.y = 3;
  editor.endStroke();
  assert.equal(editor.commits.length, 0, 'a not-directly-valid release holds a scene-only pose');
  assert.match(editor.toasts.at(-1), /Case held above the load/);
  for (const key of ['r', 'T', 'e', 'F', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const event = editor.press(key);
    assert.equal(event.defaultPrevented, true, `${key}: the viewport still owns the key`);
    assert.equal(editor.commits.length, 0, `${key}: a held pose never commits through a transform or nudge`);
  }
  assert.equal(editor.cargo.position.y, 3, 'the held scene pose is untouched');
  assert.equal(editor.cargo.rotation.x, 0, 'no rotation was applied to the held case');
  editor.allowPlacement({ x: 0, y: 3, z: 0 });
  editor.press('Enter');
  assert.equal(editor.commits.length, 1, 'Enter still places the held case through the validated resolve');
  editor.press('r');
  assert.equal(editor.commits.length, 2, 'once placed, R turns the case normally');
});

test('Editor live drag owns R/T/E/F and arrow keys; Escape still cancels it', t => {
  const dom = installDom(t);
  const editor = installProvisionalEditor(t, dom);
  editor.beginStroke();
  assert.equal(editor.controls.enabled, false, 'a live gizmo stroke is active');
  editor.cargo.position.y = 2;
  for (const key of ['R', 't', 'E', 'f', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    editor.press(key);
    assert.equal(editor.commits.length, 0, `${key}: a live drag never commits through a transform or nudge`);
  }
  for (const key of ['ArrowUp', 'ArrowDown']) {
    editor.press(key, { altKey: true });
    assert.equal(editor.commits.length, 0, `Alt+${key}: a live drag never commits a vertical move`);
  }
  assert.equal(editor.cargo.position.y, 2);
  editor.press('Escape');
  assert.equal(editor.controls.enabled, true, 'Escape still cancels the live stroke');
  assert.equal(editor.cargo.position.y, 0, 'the stroke returns to its start pose');
  assert.equal(editor.commits.length, 0);
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
  assert.equal(dom.doc.body.classList.contains('modal-open'), true);
  system.show({ title: 'Updated' });
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), systemOwner);
  error.showNotFound();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), systemOwner, 'recoverable error stays under terminal System');
  error.showFatal();
  const errorOwner = dom.UI.modalOwnership.getActiveOwner();
  assert.equal(errorOwner.kind, 'error', 'fatal replaces the recoverable owner at terminal precedence');
  error.showMaintenance();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), errorOwner);
  const ordinary = dom.UI.showModal({});
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), errorOwner);
  auth.show();
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), errorOwner, 'terminal error supersedes Auth');
  const authOwner = dom.UI.modalOwnership.getOwners().find(owner => owner.kind === 'auth');
  assert.equal(authOwner.parentId, null);
  assert.equal(dom.doc.body.classList.contains('modal-open'), true);
  auth.show();
  assert.equal(dom.UI.modalOwnership.getOwners().length, 4);
  dom.dispatch(dom.key('Escape'));
  assert.equal(auth.isOpen(), true);
  auth.hide();
  auth.hide();
  assert.equal(dom.doc.body.classList.contains('modal-open'), true, 'Auth release keeps recovery and ordinary locks');
  dom.dispatch(dom.key('Escape'));
  assert.equal(error.isVisible(), true);
  assert.equal(dom.roots.get('system-overlay').classList.contains('active'), true);
  error.hide();
  assert.equal(error.isVisible(), true, 'recovery cleanup cannot hide a terminal error');
  error.hide({ includeTerminal: true });
  error.hide({ includeTerminal: true });
  assert.equal(dom.doc.body.classList.contains('modal-open'), true, 'Error release keeps System and ordinary locks');
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), systemOwner);
  system.hide();
  system.hide();
  assert.equal(dom.doc.body.classList.contains('modal-open'), true, 'System release keeps the ordinary lock');
  ordinary.close();
  assert.deepEqual(dom.UI.modalOwnership.getOwners(), []);
  assert.equal(dom.doc.body.classList.contains('modal-open'), false);
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

test('shared select uses one popup lifecycle, preserves value semantics, and skips disabled options', async t => {
  const { UI, doc, win, dispatch, key } = installDom(t);
  const select = doc.body.appendChild(UI.createSelect({
    label: 'Test choice', value: 'a',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Blocked', disabled: true },
      { value: 'c', label: 'Charlie' },
    ],
  }));
  let changes = 0;
  select.addEventListener('change', () => { changes++; });
  assert.equal(select.value, 'a');
  assert.equal(select.getAttribute('role'), 'combobox');
  assert.equal(select.getAttribute('aria-expanded'), 'false');
  assert.match(select.getAttribute('aria-label'), /Test choice: Alpha/);
  select.value = 'c';
  assert.equal(changes, 0, 'programmatic assignments stay silent');
  assert.match(select.getAttribute('aria-label'), /Charlie/);
  select.value = 'a';

  select.disabled = true;
  select.emit('click', {});
  assert.equal(doc.querySelector('[data-dropdown="1"]'), null);
  assert.equal(select.getAttribute('aria-disabled'), 'true');
  select.disabled = false;
  select.focus();
  dispatch(key('Enter', select));
  let popup = doc.querySelector('[data-dropdown="1"]');
  assert.ok(popup);
  assert.equal(select.getAttribute('aria-expanded'), 'true');
  assert.equal(select.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(popup.children[0].getAttribute('role'), 'listbox');
  assert.equal(select.getAttribute('aria-controls'), popup.children[0].id);
  const options = popup.children[0].children;
  assert.equal(options[0].getAttribute('aria-selected'), 'true');
  assert.equal(options[1].getAttribute('aria-disabled'), 'true');
  options[1].emit('click', { stopPropagation() {} });
  assert.equal(select.value, 'a', 'disabled option cannot commit');
  assert.equal(changes, 0);
  dispatch(key('ArrowDown', select));
  assert.equal(select.getAttribute('aria-activedescendant'), options[2].id);
  dispatch(key('Home', select));
  assert.equal(select.getAttribute('aria-activedescendant'), options[0].id);
  dispatch(key('End', select));
  assert.equal(select.getAttribute('aria-activedescendant'), options[2].id);
  dispatch(key('ArrowUp', select));
  assert.equal(select.getAttribute('aria-activedescendant'), options[0].id);
  dispatch(key('ArrowDown', select));
  dispatch(key(' ', select));
  assert.equal(select.value, 'c');
  assert.equal(changes, 1);
  assert.equal(select.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, select);

  dispatch(key(' ', select));
  popup = doc.querySelector('[data-dropdown="1"]');
  assert.ok(popup, 'Space reopens the same primitive');
  dispatch(key('Escape', select));
  assert.equal(popup.isConnected, false);
  assert.equal(doc.activeElement, select);
  assert.equal(select.getAttribute('aria-controls'), null);

  select.emit('click', {});
  popup = doc.querySelector('[data-dropdown="1"]');
  assert.ok(popup, 'click opens');
  await new Promise(resolve => setTimeout(resolve, 0));
  doc.emit('click', {}, true);
  assert.equal(popup.isConnected, false, 'outside click closes');

  select.setOptions([{ value: 'd', label: 'Delta' }]);
  assert.equal(select.value, 'd');
  assert.match(select.getAttribute('aria-label'), /Delta/);
  win.innerWidth = 220;
  select.getBoundingClientRect = () => ({ left: 175, top: 100, right: 215, bottom: 140, width: 40, height: 40 });
  select.emit('click', {});
  popup = doc.querySelector('[data-dropdown="1"]');
  assert.ok(Number.parseInt(popup.style.width, 10) <= 204, 'popup width is viewport-clamped');
  assert.ok(Number.parseInt(popup.style.left, 10) >= 8, 'popup stays in the viewport');
  UI.closeAllDropdowns();
});

test('shared select popup belongs to its modal and closes with the parent', t => {
  const { UI, doc, dispatch, key } = installDom(t);
  const parent = UI.showModal({});
  const select = parent.body.appendChild(UI.createSelect({
    label: 'Modal choice', options: [{ value: 'a', label: 'Alpha' }],
  }));
  select.focus();
  select.emit('click', {});
  const popup = doc.querySelector('[data-dropdown="1"]');
  assert.equal(popup.parentElement.parentElement, parent.overlay);
  assert.equal(UI.modalOwnership.getActiveOwner().parentId, parent.owner.id);
  dispatch(key('Escape', select));
  assert.equal(popup.isConnected, false);
  assert.equal(parent.overlay.isConnected, true);
  select.emit('click', {});
  const reopened = doc.querySelector('[data-dropdown="1"]');
  parent.close();
  assert.equal(reopened.isConnected, false);
  assert.deepEqual(UI.modalOwnership.getOwners(), []);
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
  error.hide({ includeTerminal: true });
  dom.win.__TP3D_BOOT.showAppStatusOverlay('fatal');
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null, 'ignored duplicate fatal must not claim a hidden root');
  dom.win.__TP3D_BOOT.showAppStatusOverlay('maintenance');
  assert.equal(dom.UI.modalOwnership.getActiveOwner().kind, 'error');
  error.hide({ includeTerminal: true });
  assert.equal(dom.UI.modalOwnership.getActiveOwner(), null);
});
