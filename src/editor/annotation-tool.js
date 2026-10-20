/**
 * @file annotation-tool.js
 * @description Annotations V1A controller: the Annotations panel, callout creation and editing, and the
 *   on-screen markers, labels and cards. THREE and DOM concerns live here; the data model, validation and
 *   anchor resolution live in core/annotations.js (on the Measurement anchor model), picking is the shared
 *   editor/surface-picker.js, the screen-space layout is core/annotation-layout.js, and persistence is
 *   PackLibrary. An annotation is informational: it never moves cargo, never takes part in collision,
 *   handling rules, assessment, AutoPack or any export, and moving a card never moves its anchor.
 *
 *   Ownership rules (see the V1A contract):
 *   - Markers and cards are a DOM/SVG layer above the canvas, so no canvas capture (Screenshot, PDF views,
 *     thumbnails, previews) can include them. Three.js stays authoritative for the camera and for where
 *     cargo is; the layer only projects what the scene displays.
 *   - Only one scene tool owns pointer input. While the Callout tool (or a re-attach) is armed the
 *     Editor's pointer handlers delegate here instead of selecting or dragging cargo; OrbitControls is
 *     untouched, so orbit, pan and zoom stay available. The Measurement Tool and Annotations are mutually
 *     exclusive (the Editor wires that). Markers and cards are ordinary DOM, so clicking them never reaches
 *     the canvas.
 *   - Selecting an annotation clears the cargo selection and selecting cargo clears the annotation, so
 *     Delete acts on the annotation only when it owns the selection and never deletes cargo as a side
 *     effect. Ctrl/Cmd+Z stays cargo history; only an unfinished marker or card drag is cancelled by it.
 *     Deleting a callout offers a one-level Undo button in the panel, independent of cargo history.
 *   - One Escape closes one owner, in this order: a modal, dropdown, text field or popover that owns it
 *     (they keep it), an unfinished drag, the editor card, a pending re-attach, the armed tool, the
 *     annotation selection. Anything else is left to the existing handlers (cargo deselection, drawers).
 *   - Creating, editing, moving, hiding and deleting are disabled while AutoPack, Unpack, Truck Change, a
 *     Truck Change preview or a transient AutoPack preview is active, and the message names the cause.
 *     Viewing and selecting stay available. A background thumbnail capture is a pixel readback, not an
 *     edit: it never blocks annotations or cancels an unfinished one.
 *   - Cargo anchors are only ever picked from, and resolved against, COMMITTED poses; while the Editor
 *     owns a provisional pose a pick on cargo is refused. Overlay positions follow the pose the scene
 *     displays so a marker never floats away from cargo that is being dragged or animated.
 *   - An unresolvable annotation stays stored and is listed with an explanation; it is never drawn at a
 *     fabricated position and never relocated. The only way an anchor changes is the owner's deliberate
 *     marker drag or Re-attach onto a supported surface.
 * @module editor/annotation-tool
 */

import {
  ANNOTATION_COLORS,
  ANNOTATION_STATUS,
  ANNOTATION_TYPE_CALLOUT,
  ANNOTATION_TYPE_UNREADABLE,
  CALLOUT_PRESETS,
  MAX_ANNOTATIONS_PER_PACK,
  MAX_CALLOUT_DESCRIPTION_LENGTH,
  MAX_CALLOUT_TITLE_LENGTH,
  MAX_CARD_OFFSET_PX,
  anchorSurfaceNormal,
  annotationStatusLabel,
  calloutNumbers,
  describeAnchorTarget,
  describeAnnotationReason,
  normalizeCalloutDescription,
  normalizeCalloutTitle,
} from '../core/annotations.js';
import {
  autoPlace,
  cardBudget,
  cardWidth,
  clampRect,
  estimateCardHeight,
  fitLabels,
  isCompactViewport,
  LABEL_FLIP_MARGIN,
  leaderLine,
  offsetFromRect,
  rectFromOffset,
} from '../core/annotation-layout.js';
import { createSurfacePicker } from './surface-picker.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAFT_ID = '__draft';
// A real mouse or trackpad click jitters a few pixels; anything larger is an orbit/pan drag.
const CLICK_DRAG_THRESHOLD_PX = 6;
const PIN_DRAG_THRESHOLD_PX = 5;
const CARD_DRAG_THRESHOLD_PX = 4;
const HOVER_PICK_INTERVAL_MS = 40;
const OCCLUSION_INTERVAL_MS = 100;
const STATUS_VISIBLE_MS = 3200;
const UNDO_VISIBLE_MS = 12000;
const NOTICE_INTERVAL_MS = 1400;
const OFFSCREEN_MARGIN_PX = 30;
const PIN_RECT_PX = 24;
// The ray stops this far short of the marker, so the surface the marker sits on never hides it.
const OCCLUSION_STOP_INCHES = 0.5;
const ORTHO_RAY_LENGTH = 1e4;
const MARKER_ARM_PX = 6;
const PANEL_MARGIN_PX = 10;
const PANEL_DRAG_THRESHOLD_PX = 5;
const EDITOR_WIDTH_PX = 304;
const EDITOR_FALLBACK_HEIGHT_PX = 404;
const MIN_RAY_LENGTH = 1e-6;
const HELD_POSE_NOTICE = 'Place or cancel the held case before working with annotations on cargo.';
const AMBIGUOUS_CARGO_NOTICE = 'This cargo shares its ID with another item in the Load Plan, so a callout cannot be attached to it.';
const PICK_REFUSAL_NOTICE = { provisional: HELD_POSE_NOTICE, ambiguous: AMBIGUOUS_CARGO_NOTICE };
// Operations that only read pixels back never block or cancel annotation editing.
const PASSIVE_OPERATION_KINDS = new Set(['capturingPreview']);
const BLOCKED_CAUSE_TEXT = Object.freeze({
  preview: 'an AutoPack preview is shown',
  autopacking: 'AutoPack is running',
  unpacking: 'Unpack is running',
  changingTruck: 'the truck is being changed',
  previewingTruckChange: 'a truck change preview is open',
});
const COLOR_LABELS = Object.freeze({ ink: 'Ink', blue: 'Blue', green: 'Green', red: 'Red', violet: 'Violet' });
const DISPLAY_MODES = Object.freeze([['markers', 'Markers'], ['labels', 'Labels'], ['cards', 'Cards']]);
const TOOL_DEFS = Object.freeze([
  { key: 'callout', label: 'Callout', icon: 'fa-solid fa-location-dot', available: true },
  { key: 'arrow', label: 'Arrow', icon: 'fa-solid fa-arrow-right', available: false },
  { key: 'draw', label: 'Draw', icon: 'fa-solid fa-pen', available: false },
]);

export function createAnnotationTool({
  SceneManager,
  CaseScene,
  CaseLibrary,
  PackLibrary,
  StateStore,
  UIComponents,
  OperationLifecycle = null,
  doc = typeof document !== 'undefined' ? document : null,
}) {
  // ==========================================================================
  // SECTION: STATE
  // ==========================================================================
  let els = { button: null, panel: null, layer: null, viewport: null };
  let bound = false;
  let panelOpen = false;
  let tool = null; // 'callout' while the Callout tool is armed
  let reattachId = null; // a callout whose marker is waiting for a new surface
  let draft = null; // the editor card: a new callout or an edit of an existing one
  let selectedId = null;
  let display = 'markers'; // view-level: 'markers' | 'labels' | 'cards'; not saved with the Load Plan
  let records = [];
  let results = [];
  let numbers = new Map();
  let drawableIds = new Set();
  let pinDrag = null; // { id, pointerId, startX, startY, moved, dirty, candidate, poseKey }
  let cardDrag = null; // { id, pointerId, startX, startY, startRect, marker, moved, rect, offset }
  let editorDrag = null;
  let press = null; // { x, y } of a primary press that began on the canvas while a scene tool is armed
  let hover = null;
  let hoverDirty = false;
  let lastHoverPickAt = 0;
  let lastClient = null;
  let lastNoticeAt = 0;
  let lastCursor = '';
  let rafId = null;
  let statusMessage = '';
  let statusTone = '';
  let statusTimer = null;
  let lastBlockedReason = null;
  let lastDeleted = null; // { packId, record, index } for the panel's one-level Undo
  let deletedTimer = null;
  let keyboardModality = false;
  let suppressClick = false;
  let compact = false;
  let panelCollapsed = false;
  let panelPosition = null;
  let panelParts = null;
  let panelObserver = null;
  let suppressToggleClick = false;
  let layerParts = null;
  let layerObserver = null;
  let editorParts = null;
  let visDirty = true;
  let lastVisAt = 0;
  let lastSignature = NaN;
  let selfClearing = false;
  const views = new Map(); // annotation id -> { pin, chip, badge, card, ... } DOM + per-frame state
  const rows = new Map();

  const picker = createSurfacePicker({
    SceneManager, CaseScene, CaseLibrary, PackLibrary,
    getPack: () => currentPack(),
    hasProvisionalPose: () => provisionalPoseActive(),
  });
  const { pick, liveAnchorWorld, lookupInstance, cargoPoseKey, cargoGroupFor, getCanvas } = picker;

  const raycaster = new THREE.Raycaster();
  const projected = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const normalVec = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();
  const draftWorld = new THREE.Vector3();
  const ghostWorld = new THREE.Vector3();
  const scratchScreen = { x: 0, y: 0 };
  const ghostScreen = { x: 0, y: 0 };

  // ==========================================================================
  // SECTION: SMALL HELPERS
  // ==========================================================================
  function inEditor() {
    return StateStore.get('currentScreen') === 'editor';
  }

  function currentPack() {
    return PackLibrary.getById(StateStore.get('currentPackId'));
  }

  // The Editor holds a scene-only pose (live drag, gizmo stroke, held case): meshes are not where the Load Plan says.
  function provisionalPoseActive() {
    return typeof els.hasProvisionalPose === 'function' && Boolean(els.hasProvisionalPose());
  }

  const recordById = id => records.find(record => record.id === id) || null;
  const resultById = id => {
    const index = records.findIndex(record => record.id === id);
    return index === -1 ? null : results[index];
  };
  const isCallout = record => Boolean(record) && record.type === ANNOTATION_TYPE_CALLOUT;

  /**
   * Why annotations cannot be created, edited, moved, hidden or deleted right now, or null. A transient
   * Results/Truck Change preview is named first; then the running operation. A passive thumbnail capture
   * is neither: it only reads pixels. An annotation write replaces the Pack object, which aborts a capture
   * that is mid-flight; the app re-requests it (app.js, 'pack-annotations').
   */
  function blockedReason() {
    if (CaseScene.isTransientPreview && CaseScene.isTransientPreview()) return 'preview';
    if (!OperationLifecycle || !OperationLifecycle.isBusy()) return null;
    const operation = typeof OperationLifecycle.currentOperation === 'function' ? OperationLifecycle.currentOperation() : null;
    const kind = operation && operation.kind ? operation.kind : 'busy';
    return PASSIVE_OPERATION_KINDS.has(kind) ? null : kind;
  }

  function blockedMessage(reason) {
    return `Annotations are read-only while ${BLOCKED_CAUSE_TEXT[reason] || 'an operation is running'}.`;
  }

  function setStatus(message, { sticky = false, tone = '' } = {}) {
    statusMessage = message || '';
    statusTone = statusMessage ? tone : '';
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    if (statusMessage && !sticky) {
      statusTimer = window.setTimeout(() => {
        statusMessage = '';
        statusTone = '';
        statusTimer = null;
        renderPanel();
      }, STATUS_VISIBLE_MS);
    }
    renderPanel();
  }

  /** A click that cannot be used must be noticed: toast (rate limited) plus the panel line. */
  function notice(message, tone = 'info') {
    setStatus(message);
    const now = Date.now();
    if (now - lastNoticeAt < NOTICE_INTERVAL_MS) return;
    lastNoticeAt = now;
    UIComponents.showToast(message, tone, { title: 'Annotations' });
  }

  function isTypingTarget(target) {
    if (!target || !target.matches) return false;
    if (target.isContentEditable) return true;
    return target.matches('input, textarea, select');
  }

  /** Name of what an anchor is attached to: the Case name for cargo, else the surface. */
  function anchorTargetName(anchor) {
    if (!anchor) return '';
    if (anchor.kind !== 'cargo') return describeAnchorTarget(anchor);
    const pack = currentPack();
    const { instance } = pack ? lookupInstance(pack, anchor.instanceId) : { instance: null };
    const caseData = instance ? CaseLibrary.getById(instance.caseId) : null;
    return describeAnchorTarget(anchor, caseData && caseData.name);
  }

  function svgEl(name, className) {
    const el = doc.createElementNS(SVG_NS, name);
    if (className) el.setAttribute('class', className);
    return el;
  }

  function htmlEl(name, className, text) {
    const el = doc.createElement(name);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function iconEl(classes) {
    const icon = doc.createElement('i');
    icon.className = classes;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function setHidden(el, hidden) {
    if (el.hidden !== hidden) el.hidden = hidden;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function toggleClass(el, name, on) {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
  }

  /** Focus returns to the 3D viewport when what held it is about to disappear. */
  function refocusViewportIfLost() {
    const viewport = els.viewport;
    const active = doc ? doc.activeElement : null;
    const lost = !active || active === doc.body || !active.isConnected ||
      Boolean(active.closest && active.closest('[hidden]'));
    if (!lost || !viewport || typeof viewport.focus !== 'function') return;
    if (!keyboardModality && viewport.classList) {
      viewport.classList.add('tp3d-pointer-focus');
      viewport.addEventListener('focusout', () => viewport.classList.remove('tp3d-pointer-focus'), { once: true });
    }
    viewport.focus({ preventScroll: true });
  }

  function clearCargoSelection() {
    if (typeof els.clearCargoSelection !== 'function') return;
    selfClearing = true;
    try {
      els.clearCargoSelection();
    } finally {
      selfClearing = false;
    }
  }

  // ==========================================================================
  // SECTION: SESSION (what the tool remembers while the Editor is open)
  // ==========================================================================
  function clearDeleted() {
    lastDeleted = null;
    if (deletedTimer) window.clearTimeout(deletedTimer);
    deletedTimer = null;
  }

  function resetSession() {
    closePanel();
    selectedId = null;
    clearDeleted();
    records = [];
    results = [];
    numbers = new Map();
    drawableIds = new Set();
    disposeOverlay();
  }

  // ==========================================================================
  // SECTION: SELECTION
  // ==========================================================================
  /**
   * Select (or with null, deselect) an annotation. Selecting one clears the cargo selection, so the
   * annotation owns Delete and no cargo can be deleted as a side effect. Refused while the Editor holds a
   * provisional pose, because clearing the cargo selection would abandon that hold.
   */
  function select(id, { toggle = false } = {}) {
    let target = id && recordById(id) ? id : null;
    if (toggle && target && selectedId === target) target = null;
    if (target && target !== selectedId) {
      if (provisionalPoseActive()) {
        notice(HELD_POSE_NOTICE);
        return;
      }
      clearCargoSelection();
    }
    selectedId = target;
    visDirty = true;
    renderPanel();
    refreshOverlay();
  }

  // ==========================================================================
  // SECTION: SYNC + LIFECYCLE
  // ==========================================================================
  /** Re-derive validity from committed data. Cheap; called on render and on annotation writes. */
  function sync() {
    const pack = currentPack();
    if (!pack || !inEditor()) {
      resetSession();
      return;
    }
    records = PackLibrary.getAnnotations(pack);
    results = PackLibrary.resolveAnnotations(pack);
    numbers = calloutNumbers(records);
    drawableIds = new Set();
    records.forEach((record, index) => {
      if (isCallout(record) && results[index] && results[index].status === ANNOTATION_STATUS.VALID && !record.hidden) drawableIds.add(record.id);
    });
    if (selectedId && !recordById(selectedId)) selectedId = null;
    if (reattachId && !recordById(reattachId)) reattachId = null;
    if (draft) {
      if (draft.editId && !recordById(draft.editId)) cancelDraft('The callout was removed, so editing was cancelled.');
      else if (!draft.editId && cargoPoseKey(pack, draft.anchor) !== draft.poseKey) cancelDraft('The cargo changed, so the new callout was cancelled.');
    }
    if (pinDrag && pinDrag.id !== DRAFT_ID) {
      const record = recordById(pinDrag.id);
      const result = resultById(pinDrag.id);
      if (!record || !result || result.status !== ANNOTATION_STATUS.VALID) cancelPinDrag('The callout changed, so the move was cancelled.');
      else if (cargoPoseKey(pack, record.anchor) !== pinDrag.poseKey) cancelPinDrag('The cargo changed, so the move was cancelled.');
    }
    if (pinDrag && pinDrag.id === DRAFT_ID && draft && cargoPoseKey(pack, draft.anchor) !== pinDrag.poseKey) {
      cancelPinDrag('The cargo changed, so the move was cancelled.');
    }
    if (cardDrag && !recordById(cardDrag.id)) cancelCardDrag();
    if (lastDeleted && lastDeleted.packId !== pack.id) clearDeleted();
    visDirty = true;
    renderPanel();
    ensureLoop();
    refreshOverlay();
  }

  function bind(elements) {
    els = { ...els, ...elements };
    if (bound) return;
    bound = true;
    StateStore.subscribe(changes => {
      if (changes._replace || !inEditor() || Object.prototype.hasOwnProperty.call(changes, 'currentPackId')) {
        if (panelOpen || selectedId || draft || records.length) resetSession();
        return;
      }
      if (changes._undo || changes._redo) {
        if (pinDrag) cancelPinDrag('Undo or redo cancelled the move.');
        if (cardDrag) cancelCardDrag();
        if (reattachId) cancelReattach('Undo or redo cancelled the re-attach.');
      }
      // Selecting cargo (or clicking empty space) deselects the annotation; our own clearing is not that.
      if (Object.prototype.hasOwnProperty.call(changes, 'selectedInstanceIds') && !selfClearing && selectedId) {
        selectedId = null;
        visDirty = true;
        renderPanel();
      }
    });
    if (OperationLifecycle && typeof OperationLifecycle.subscribe === 'function') {
      OperationLifecycle.subscribe(() => {
        if (wantsLoop() || panelOpen) syncBlocked();
      });
    }
    if (doc) doc.addEventListener('keydown', onKeyDownCapture, true);
    if (els.layer) attachLayerEvents(els.layer);
    if (typeof ResizeObserver === 'function' && els.layer) {
      layerObserver = new ResizeObserver(() => { visDirty = true; });
      layerObserver.observe(els.layer);
    }
    syncButton();
  }

  // Leaves the panel, removes the overlay and detaches the document listener. The store subscriptions
  // registered once by bind() belong to the application-lifetime singleton, so they stay.
  function destroy() {
    resetSession();
    if (doc) doc.removeEventListener('keydown', onKeyDownCapture, true);
    if (layerObserver) layerObserver.disconnect();
    layerObserver = null;
    if (layerParts && layerParts.svg.parentNode) layerParts.svg.parentNode.removeChild(layerParts.svg);
    layerParts = null;
  }

  // ==========================================================================
  // SECTION: PANEL OPEN / CLOSE, TOOL, DISPLAY
  // ==========================================================================
  function syncButton() {
    if (els.button) els.button.setAttribute('aria-pressed', panelOpen ? 'true' : 'false');
  }

  function openPanel() {
    if (panelOpen) return true;
    if (!inEditor() || !currentPack() || !els.panel) return false;
    panelOpen = true;
    CaseScene.setHover(null);
    const entryFocus = doc ? doc.activeElement : null;
    keyboardModality = Boolean(entryFocus && typeof entryFocus.matches === 'function' && entryFocus.matches(':focus-visible'));
    lastBlockedReason = blockedReason();
    els.panel.hidden = false;
    syncButton();
    const host = panelHost();
    if (host && typeof ResizeObserver === 'function') {
      panelObserver = new ResizeObserver(() => applyPanelPosition());
      panelObserver.observe(host);
    }
    sync();
    const unreadable = records.filter(record => record.type === ANNOTATION_TYPE_UNREADABLE).length;
    if (unreadable) {
      UIComponents.showToast(
        `${unreadable === 1 ? 'A saved annotation' : `${unreadable} saved annotations`} couldn't be read. The original data is kept.`,
        'warning', { title: 'Annotations' }
      );
    }
    return true;
  }

  /**
   * Close the panel and stop everything it started: the armed tool, a pending re-attach, an unfinished
   * drag and an open editor card (an unsaved callout writes nothing). Saved annotations and the selection stay.
   */
  function closePanel() {
    const wasOpen = panelOpen;
    cancelPinDrag();
    cancelCardDrag();
    if (draft) cancelDraft();
    tool = null;
    reattachId = null;
    hover = null;
    press = null;
    panelOpen = false;
    clearDeleted();
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    statusMessage = '';
    statusTone = '';
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    if (els.panel) els.panel.hidden = true;
    rows.forEach(row => row.el.remove());
    rows.clear();
    syncButton();
    updateCursor();
    if (wasOpen) refocusViewportIfLost();
    return wasOpen;
  }

  function togglePanel() {
    if (panelOpen) {
      closePanel();
      return false;
    }
    return openPanel();
  }

  function setTool(key) {
    const def = TOOL_DEFS.find(item => item.key === key);
    if (!def || !def.available) return;
    const reason = blockedReason();
    if (reason && tool !== key) {
      notice(blockedMessage(reason));
      return;
    }
    if (draft) cancelDraft();
    reattachId = null;
    tool = tool === key ? null : key;
    hover = null;
    hoverDirty = true;
    press = null;
    selectedId = tool ? null : selectedId;
    setStatus('', { sticky: true });
    updateCursor();
  }

  function setDisplay(mode) {
    if (!DISPLAY_MODES.some(([key]) => key === mode) || mode === display) return;
    display = mode;
    visDirty = true;
    renderPanel();
    refreshOverlay();
  }

  // ==========================================================================
  // SECTION: SCENE PICKING (the shared picker; click = place, drag = orbit)
  // ==========================================================================
  function onPointerDown(ev) {
    if (!isActive() || ev.button !== 0) return;
    press = { x: ev.clientX, y: ev.clientY };
    lastClient = { x: ev.clientX, y: ev.clientY };
    keyboardModality = false;
  }

  function onPointerMove(ev) {
    if (!isActive()) return;
    lastClient = { x: ev.clientX, y: ev.clientY };
    hoverDirty = true;
  }

  function onPointerCancel() {
    press = null;
  }

  function onPointerUp(ev) {
    if (!isActive() || !press) return;
    const moved = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
    press = null;
    if (ev.button !== 0 || moved > CLICK_DRAG_THRESHOLD_PX) return; // an orbit/pan drag, not a click
    handleSceneClick(ev.clientX, ev.clientY);
  }

  /** A double-click must neither start two callouts nor focus the camera on cargo. */
  function onDoubleClick(ev) {
    if (!isActive()) return false;
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    return true;
  }

  function handleSceneClick(clientX, clientY) {
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    if (!pack) return;
    if (draft && draft.editId) {
      setStatus('Save or cancel the open callout first.');
      return;
    }
    if (!reattachId && !draft && records.length >= MAX_ANNOTATIONS_PER_PACK) {
      notice(`Limit of ${MAX_ANNOTATIONS_PER_PACK} annotations reached. Delete one to add another.`, 'warning');
      return;
    }
    const outcome = {};
    const picked = pick(clientX, clientY, outcome);
    hover = picked;
    if (!picked) {
      notice(PICK_REFUSAL_NOTICE[outcome.blocked] || 'Nothing to annotate there. Click cargo, the truck or the ground.');
      return;
    }
    if (reattachId) {
      commitReattach(reattachId, picked);
      return;
    }
    if (draft) {
      moveDraftAnchor(picked, pack);
      return;
    }
    openNewDraft(picked, pack);
  }

  // ==========================================================================
  // SECTION: THE EDITOR CARD (new callout / edit callout)
  // ==========================================================================
  function openNewDraft(picked, pack) {
    clearCargoSelection();
    selectedId = null;
    draft = {
      editId: null,
      anchor: picked.anchor,
      world: picked.world.clone(),
      poseKey: cargoPoseKey(pack, picked.anchor),
      title: '',
      description: '',
      color: 'ink',
      keepExpanded: false,
      preset: null,
      editorPos: null,
    };
    showEditor();
    setStatus('', { sticky: true });
    visDirty = true;
    refreshOverlay();
  }

  function moveDraftAnchor(picked, pack) {
    draft.anchor = picked.anchor;
    draft.world = picked.world.clone();
    draft.poseKey = cargoPoseKey(pack, picked.anchor);
    syncEditorFields();
    setStatus('Marker moved. Click elsewhere or drag it to move it again.');
    refreshOverlay();
  }

  function openEditor(id) {
    const record = recordById(id);
    if (!isCallout(record)) return;
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    if (draft) cancelDraft();
    reattachId = null;
    draft = {
      editId: id,
      anchor: record.anchor,
      world: null,
      poseKey: null,
      title: record.title,
      description: record.description || '',
      color: record.color,
      keepExpanded: record.keepExpanded,
      preset: null,
      editorPos: null,
    };
    select(id);
    showEditor();
    setStatus('', { sticky: true });
    refreshOverlay();
  }

  function cancelDraft(message = '') {
    if (!draft) return;
    const restore = Boolean(editorParts && editorParts.root.contains(doc.activeElement));
    draft = null;
    editorDrag = null;
    if (editorParts) setHidden(editorParts.root, true);
    visDirty = true;
    if (message) setStatus(message);
    else renderPanel();
    refreshOverlay();
    if (restore) refocusViewportIfLost();
  }

  function saveDraft() {
    if (!draft) return;
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    if (!pack) return;
    const title = normalizeCalloutTitle(draft.title);
    if (!title) {
      setStatus('Add a title to save this callout.');
      if (editorParts) editorParts.title.focus();
      return;
    }
    const fields = {
      title,
      description: normalizeCalloutDescription(draft.description),
      color: draft.color,
      keepExpanded: draft.keepExpanded,
    };
    let id;
    if (draft.editId) {
      const outcome = PackLibrary.updateCallout(pack.id, draft.editId, fields);
      if (!outcome.ok) {
        UIComponents.showToast('Could not save this callout.', 'error', { title: 'Annotations' });
        return;
      }
      id = draft.editId;
    } else {
      // The cargo the marker sits on must still be posed as it was when the point was picked.
      if (cargoPoseKey(pack, draft.anchor) !== draft.poseKey) {
        cancelDraft('The cargo changed, so the new callout was cancelled.');
        return;
      }
      const outcome = PackLibrary.addCallout(pack.id, { anchor: draft.anchor, ...fields });
      if (!outcome.ok) {
        UIComponents.showToast(outcome.reason === 'limit'
          ? `Annotation limit reached (${MAX_ANNOTATIONS_PER_PACK}).`
          : 'Could not save this callout.', 'error', { title: 'Annotations' });
        return;
      }
      id = outcome.annotation.id;
    }
    clearDeleted();
    const target = anchorTargetName(draft.anchor);
    const wasEdit = Boolean(draft.editId);
    const restore = Boolean(editorParts && editorParts.root.contains(doc.activeElement));
    draft = null;
    editorDrag = null;
    if (editorParts) setHidden(editorParts.root, true);
    selectedId = id;
    visDirty = true;
    setStatus(wasEdit ? 'Callout updated.' : `Callout saved to ${target}.`, { tone: 'success' });
    refreshOverlay();
    if (restore) refocusViewportIfLost();
  }

  function buildEditor() {
    const root = htmlEl('div', 'tp3d-annot-editor');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'New callout');
    root.hidden = true;

    const head = htmlEl('div', 'tp3d-annot-editor__head');
    head.title = 'Drag to move this card';
    const headline = htmlEl('div', 'tp3d-annot-editor__headline');
    headline.append(gripEl(), htmlEl('span', 'tp3d-annot-editor__heading'));
    const target = htmlEl('div', 'tp3d-annot-editor__target');
    target.append(iconEl('fa-solid fa-cube'), htmlEl('span', 'tp3d-annot-editor__target-text'));
    head.append(headline, target);

    const body = htmlEl('div', 'tp3d-annot-editor__body');
    const presetsWrap = htmlEl('div', 'tp3d-annot-editor__field');
    presetsWrap.append(htmlEl('div', 'tp3d-annot-editor__label', 'Presets'));
    const presets = htmlEl('div', 'tp3d-annot-editor__presets');
    presets.setAttribute('role', 'group');
    presets.setAttribute('aria-label', 'Text presets');
    const presetButtons = CALLOUT_PRESETS.map(preset => {
      const button = htmlEl('button', 'tp3d-annot-chip', preset.key);
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (!draft) return;
        draft.title = preset.title;
        draft.description = preset.description;
        draft.preset = preset.key;
        syncEditorFields();
      });
      presets.appendChild(button);
      return { key: preset.key, button };
    });
    presetsWrap.appendChild(presets);

    const titleLabel = htmlEl('label', 'tp3d-annot-editor__field');
    titleLabel.append(htmlEl('span', 'tp3d-annot-editor__label', 'Title'));
    const title = htmlEl('input', 'tp3d-annot-editor__input');
    title.type = 'text';
    title.maxLength = MAX_CALLOUT_TITLE_LENGTH;
    title.placeholder = 'e.g. UNLOAD FIRST';
    title.autocomplete = 'off';
    title.addEventListener('input', () => {
      if (!draft) return;
      draft.title = title.value;
      draft.preset = null;
      syncEditorFields({ keepInputs: true });
    });
    titleLabel.appendChild(title);

    const descLabel = htmlEl('label', 'tp3d-annot-editor__field');
    descLabel.append(htmlEl('span', 'tp3d-annot-editor__label', 'Description (optional)'));
    const description = htmlEl('textarea', 'tp3d-annot-editor__input tp3d-annot-editor__textarea');
    description.rows = 3;
    description.maxLength = MAX_CALLOUT_DESCRIPTION_LENGTH;
    description.placeholder = 'Short instruction for the crew';
    description.addEventListener('input', () => {
      if (draft) draft.description = description.value;
    });
    descLabel.appendChild(description);

    const options = htmlEl('div', 'tp3d-annot-editor__options');
    const colors = htmlEl('div', 'tp3d-annot-swatches');
    colors.setAttribute('role', 'group');
    colors.setAttribute('aria-label', 'Callout color');
    colors.appendChild(htmlEl('span', 'tp3d-annot-editor__label', 'Color'));
    const swatches = ANNOTATION_COLORS.map(color => {
      const swatch = htmlEl('button', 'tp3d-annot-swatch');
      swatch.type = 'button';
      swatch.dataset.color = color;
      swatch.title = COLOR_LABELS[color];
      swatch.setAttribute('aria-label', COLOR_LABELS[color]);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.addEventListener('click', () => {
        if (!draft) return;
        draft.color = color;
        syncEditorFields({ keepInputs: true });
      });
      colors.appendChild(swatch);
      return { color, swatch };
    });
    const keepLabel = htmlEl('label', 'tp3d-annot-editor__keep');
    const keep = htmlEl('input');
    keep.type = 'checkbox';
    keep.addEventListener('change', () => {
      if (draft) draft.keepExpanded = keep.checked;
    });
    keepLabel.append(keep, doc.createTextNode('Keep expanded'));
    options.append(colors, keepLabel);
    body.append(presetsWrap, titleLabel, descLabel, options);

    const foot = htmlEl('div', 'tp3d-annot-editor__foot');
    const del = htmlEl('button', 'tp3d-annot-btn tp3d-annot-btn--danger');
    del.type = 'button';
    del.title = 'Delete callout';
    del.setAttribute('aria-label', 'Delete callout');
    del.appendChild(iconEl('fa-solid fa-trash-can'));
    del.addEventListener('click', () => {
      if (draft && draft.editId) removeAnnotation(draft.editId);
    });
    const spacer = htmlEl('span', 'tp3d-annot-editor__spacer');
    const cancel = htmlEl('button', 'tp3d-annot-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => cancelDraft());
    const save = htmlEl('button', 'tp3d-annot-btn tp3d-annot-btn--primary', 'Save callout');
    save.type = 'button';
    save.addEventListener('click', saveDraft);
    foot.append(del, spacer, cancel, save);

    root.append(head, body, foot);
    // The card is not modal: it owns Escape and Enter only while focus is inside it.
    root.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelDraft();
      } else if (ev.key === 'Enter' && ev.target === title && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        saveDraft();
      }
    });
    head.addEventListener('pointerdown', ev => beginEditorDrag(ev, root));
    return {
      root, head, heading: headline.querySelector('.tp3d-annot-editor__heading'),
      targetText: target.querySelector('.tp3d-annot-editor__target-text'),
      presetButtons, title, description, swatches, keep, del, cancel, save,
    };
  }

  function ensureEditor() {
    if (editorParts && editorParts.root.isConnected) return editorParts;
    if (!els.layer || !doc) return null;
    editorParts = buildEditor();
    els.layer.appendChild(editorParts.root);
    return editorParts;
  }

  /** Make the editor card show `draft`. `keepInputs` leaves the text fields alone while the user types in them. */
  function syncEditorFields({ keepInputs = false } = {}) {
    const parts = ensureEditor();
    if (!parts || !draft) return;
    const editing = Boolean(draft.editId);
    setText(parts.heading, editing ? 'Edit callout' : 'New callout');
    parts.root.setAttribute('aria-label', editing ? 'Edit callout' : 'New callout');
    setText(parts.targetText, `Attached to ${anchorTargetName(draft.anchor)}`);
    if (!keepInputs) {
      if (parts.title.value !== draft.title) parts.title.value = draft.title;
      if (parts.description.value !== draft.description) parts.description.value = draft.description;
    }
    parts.keep.checked = draft.keepExpanded;
    parts.presetButtons.forEach(({ key, button }) => setAttr(button, 'aria-pressed', draft.preset === key ? 'true' : 'false'));
    parts.swatches.forEach(({ color, swatch }) => setAttr(swatch, 'aria-pressed', draft.color === color ? 'true' : 'false'));
    setHidden(parts.del, !editing);
    setText(parts.save, editing ? 'Save changes' : 'Save callout');
    parts.save.disabled = !normalizeCalloutTitle(draft.title);
  }

  function showEditor() {
    const parts = ensureEditor();
    if (!parts || !draft) return;
    syncEditorFields();
    parts.root.dataset.measured = '';
    setHidden(parts.root, false);
    parts.title.focus({ preventScroll: true });
    parts.title.select();
  }

  function beginEditorDrag(ev, root) {
    if (ev.button !== 0 || compact || !draft || (ev.target.closest && ev.target.closest('button'))) return;
    const layerRect = els.layer.getBoundingClientRect();
    const rect = root.getBoundingClientRect();
    editorDrag = {
      pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY,
      startLeft: rect.left - layerRect.left, startTop: rect.top - layerRect.top, w: rect.width, h: rect.height, moved: false,
    };
    const onMove = moveEv => {
      if (!editorDrag || moveEv.pointerId !== editorDrag.pointerId || !draft) return;
      const dx = moveEv.clientX - editorDrag.startX;
      const dy = moveEv.clientY - editorDrag.startY;
      if (!editorDrag.moved && Math.hypot(dx, dy) < CARD_DRAG_THRESHOLD_PX) return;
      editorDrag.moved = true;
      moveEv.preventDefault();
      const placed = clampRect({ x: editorDrag.startLeft + dx, y: editorDrag.startTop + dy, w: editorDrag.w, h: editorDrag.h },
        { width: layerRect.width, height: layerRect.height });
      draft.editorPos = { x: placed.x, y: placed.y };
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      editorDrag = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  // ==========================================================================
  // SECTION: WRITES THAT SELECT / HIDE / DELETE / RE-ATTACH
  // ==========================================================================
  function toggleHidden(id) {
    const reason = blockedReason();
    if (reason) {
      setStatus(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    const record = recordById(id);
    if (!pack || !isCallout(record)) return;
    clearDeleted();
    const outcome = PackLibrary.updateCallout(pack.id, id, { hidden: !record.hidden });
    if (!outcome.ok) UIComponents.showToast('Could not change this callout.', 'error', { title: 'Annotations' });
  }

  /**
   * A single click deletes: no confirm step, and the one-level Undo button in the panel brings it back.
   * Cargo is never touched. Focus only moves on when the delete came from the keyboard.
   */
  function removeAnnotation(id, viaKeyboard = false) {
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    if (!pack) return;
    const index = records.findIndex(record => record.id === id);
    const removed = recordById(id);
    if (!removed) return;
    if (draft && draft.editId === id) cancelDraft();
    if (pinDrag && pinDrag.id === id) cancelPinDrag();
    if (cardDrag && cardDrag.id === id) cancelCardDrag();
    if (reattachId === id) reattachId = null;
    if (selectedId === id) selectedId = null;
    const outcome = PackLibrary.deleteAnnotation(pack.id, id);
    if (!outcome.ok) {
      renderPanel();
      return;
    }
    clearDeleted();
    lastDeleted = { packId: pack.id, record: outcome.removed, index: outcome.index };
    deletedTimer = window.setTimeout(() => {
      lastDeleted = null;
      deletedTimer = null;
      renderPanel();
    }, UNDO_VISIBLE_MS);
    setStatus('', { sticky: true });
    if (!viaKeyboard) return;
    const next = records[Math.min(index, records.length - 1)];
    const row = next ? rows.get(next.id) : null;
    const target = row && !row.select.disabled ? row.select : (panelParts && panelParts.toggle);
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    else refocusViewportIfLost();
  }

  /** The panel's one-level Undo for a delete: the same record, ID and position, independent of cargo history. */
  function undoDelete() {
    const pending = lastDeleted;
    if (!pending) return;
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const outcome = PackLibrary.restoreAnnotation(pending.packId, pending.record, pending.index);
    clearDeleted();
    if (!outcome.ok) {
      setStatus(outcome.reason === 'limit' ? 'The annotation limit is reached, so it could not be restored.' : 'It could not be restored.');
      return;
    }
    if (pending.record.type === ANNOTATION_TYPE_CALLOUT) selectedId = pending.record.id;
    setStatus('Restored.', { tone: 'success' });
  }

  function startReattach(id) {
    const record = recordById(id);
    if (!isCallout(record)) return;
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    if (draft) cancelDraft();
    tool = null;
    reattachId = id;
    hover = null;
    hoverDirty = true;
    select(id);
    setStatus('', { sticky: true });
    updateCursor();
  }

  function cancelReattach(message = '') {
    if (!reattachId) return;
    reattachId = null;
    hover = null;
    updateCursor();
    if (message) setStatus(message);
    else renderPanel();
  }

  /** Move a callout's marker onto a surface the owner chose. Annotation-only: cargo is never touched. */
  function commitReattach(id, picked) {
    const pack = currentPack();
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return false;
    }
    if (!pack || !recordById(id)) return false;
    clearDeleted();
    const outcome = PackLibrary.reattachCallout(pack.id, id, picked.anchor);
    if (!outcome.ok) {
      UIComponents.showToast('Could not move this callout.', 'error', { title: 'Annotations' });
      return false;
    }
    reattachId = null;
    hover = null;
    selectedId = id;
    updateCursor();
    setStatus('Callout re-attached.', { tone: 'success' });
    return true;
  }

  // ==========================================================================
  // SECTION: DRAGS (marker onto a new surface, card to a new place)
  // ==========================================================================
  function beginPinDrag(ev, id) {
    if (ev.button !== 0 || pinDrag || cardDrag) return;
    const pack = currentPack();
    if (!pack) return;
    let poseKey;
    if (id === DRAFT_ID) {
      if (!draft) return;
      poseKey = cargoPoseKey(pack, draft.anchor);
    } else {
      const record = recordById(id);
      const result = resultById(id);
      if (!isCallout(record) || !result || result.status !== ANNOTATION_STATUS.VALID || blockedReason()) return;
      poseKey = cargoPoseKey(pack, record.anchor);
    }
    const target = ev.currentTarget || ev.target;
    pinDrag = { id, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY, moved: false, dirty: false, candidate: null, poseKey, target };
    lastClient = { x: ev.clientX, y: ev.clientY };
    window.addEventListener('pointermove', onPinDragMove);
    window.addEventListener('pointerup', onPinDragUp);
    window.addEventListener('pointercancel', onPinDragCancel);
  }

  function onPinDragMove(ev) {
    if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
    lastClient = { x: ev.clientX, y: ev.clientY };
    if (!pinDrag.moved) {
      if (Math.hypot(ev.clientX - pinDrag.startX, ev.clientY - pinDrag.startY) < PIN_DRAG_THRESHOLD_PX) return;
      pinDrag.moved = true;
      try {
        if (pinDrag.target && typeof pinDrag.target.setPointerCapture === 'function') pinDrag.target.setPointerCapture(ev.pointerId);
      } catch (_) {
        // Capture is a convenience; the window listeners still end the drag.
      }
      CaseScene.setHover(null);
    }
    ev.preventDefault();
    pinDrag.dirty = true;
    updateCursor();
  }

  function onPinDragUp(ev) {
    if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
    const finished = pinDrag;
    endPinDrag();
    if (!finished.moved) return; // an ordinary click: the click handler selects
    suppressNextClick();
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const outcome = {};
    const picked = pick(ev.clientX, ev.clientY, outcome);
    if (!picked) {
      notice(`${PICK_REFUSAL_NOTICE[outcome.blocked] || 'Drop the marker on cargo, the truck or the ground.'} It was left where it was.`);
      return;
    }
    const pack = currentPack();
    if (finished.id === DRAFT_ID) {
      if (draft && pack) moveDraftAnchor(picked, pack);
      return;
    }
    commitReattach(finished.id, picked);
  }

  function onPinDragCancel(ev) {
    if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
    cancelPinDrag('Move cancelled.');
  }

  function endPinDrag() {
    if (!pinDrag) return;
    const { target, pointerId } = pinDrag;
    try {
      if (target && typeof target.releasePointerCapture === 'function' && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch (_) {
      // Already released.
    }
    window.removeEventListener('pointermove', onPinDragMove);
    window.removeEventListener('pointerup', onPinDragUp);
    window.removeEventListener('pointercancel', onPinDragCancel);
    pinDrag = null;
    visDirty = true;
    updateCursor();
  }

  /** Abandon the marker drag; the anchor is simply never changed, so there is nothing to restore. */
  function cancelPinDrag(message = '') {
    if (!pinDrag) return;
    const moved = pinDrag.moved;
    endPinDrag();
    if (message && moved) setStatus(message);
    else if (message) renderPanel();
  }

  function beginCardDrag(ev, id) {
    if (ev.button !== 0 || pinDrag || cardDrag || blockedReason()) return;
    const view = views.get(id);
    if (!view || !view.cardRect || !view.screen) return;
    cardDrag = {
      id, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY, target: ev.currentTarget || ev.target,
      startRect: { ...view.cardRect }, marker: { x: view.screen.x, y: view.screen.y }, moved: false, rect: null, offset: null,
    };
    window.addEventListener('pointermove', onCardDragMove);
    window.addEventListener('pointerup', onCardDragUp);
    window.addEventListener('pointercancel', onCardDragCancel);
  }

  function onCardDragMove(ev) {
    if (!cardDrag || ev.pointerId !== cardDrag.pointerId) return;
    const dx = ev.clientX - cardDrag.startX;
    const dy = ev.clientY - cardDrag.startY;
    if (!cardDrag.moved) {
      if (Math.hypot(dx, dy) < CARD_DRAG_THRESHOLD_PX) return;
      cardDrag.moved = true;
      try {
        if (cardDrag.target && typeof cardDrag.target.setPointerCapture === 'function') cardDrag.target.setPointerCapture(ev.pointerId);
      } catch (_) {
        // Capture is a convenience; the window listeners still end the drag.
      }
    }
    ev.preventDefault();
    const layerRect = els.layer.getBoundingClientRect();
    cardDrag.rect = clampRect({ ...cardDrag.startRect, x: cardDrag.startRect.x + dx, y: cardDrag.startRect.y + dy },
      { width: layerRect.width, height: layerRect.height });
    cardDrag.offset = offsetFromRect(cardDrag.marker, cardDrag.rect);
    visDirty = true;
  }

  function onCardDragUp(ev) {
    if (!cardDrag || ev.pointerId !== cardDrag.pointerId) return;
    const finished = cardDrag;
    endCardDrag();
    if (!finished.moved) return; // an ordinary click: the click handler selects
    suppressNextClick();
    const pack = currentPack();
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    if (!pack || !recordById(finished.id) || !finished.offset) return;
    const clamp = value => Math.max(-MAX_CARD_OFFSET_PX, Math.min(MAX_CARD_OFFSET_PX, value));
    clearDeleted();
    const outcome = PackLibrary.setCalloutOffset(pack.id, finished.id, { dx: clamp(finished.offset.dx), dy: clamp(finished.offset.dy) });
    if (!outcome.ok) UIComponents.showToast('Could not move this card.', 'error', { title: 'Annotations' });
    else setStatus('Card moved. The callout stays attached to its cargo.', { tone: 'success' });
  }

  function onCardDragCancel(ev) {
    if (!cardDrag || ev.pointerId !== cardDrag.pointerId) return;
    cancelCardDrag();
  }

  function endCardDrag() {
    if (!cardDrag) return;
    const { target, pointerId } = cardDrag;
    try {
      if (target && typeof target.releasePointerCapture === 'function' && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch (_) {
      // Already released.
    }
    window.removeEventListener('pointermove', onCardDragMove);
    window.removeEventListener('pointerup', onCardDragUp);
    window.removeEventListener('pointercancel', onCardDragCancel);
    cardDrag = null;
    visDirty = true;
  }

  /** Abandon the card drag; the stored offset was never changed. */
  function cancelCardDrag() {
    endCardDrag();
  }

  /** The click that follows a drag released over a marker or card must not also select it. */
  function suppressNextClick() {
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
  }

  // ==========================================================================
  // SECTION: OVERLAY EVENTS (markers and cards are ordinary DOM above the canvas)
  // ==========================================================================
  function attachLayerEvents(layer) {
    layer.addEventListener('pointerdown', ev => {
      keyboardModality = false;
      const pin = ev.target.closest && ev.target.closest('.tp3d-annot-pin');
      if (pin && layer.contains(pin)) {
        beginPinDrag({ button: ev.button, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, currentTarget: pin, target: pin }, pin.dataset.annotId);
        return;
      }
      const head = ev.target.closest && ev.target.closest('.tp3d-annot-card__head');
      if (head && !ev.target.closest('button')) {
        const card = head.closest('.tp3d-annot-card');
        beginCardDrag({ button: ev.button, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, currentTarget: head, target: head }, card.dataset.annotId);
      }
    });
    layer.addEventListener('click', ev => {
      if (suppressClick) return;
      const act = ev.target.closest && ev.target.closest('[data-act]');
      if (act && layer.contains(act)) {
        const id = act.closest('.tp3d-annot-card')?.dataset.annotId;
        if (act.dataset.act === 'edit') openEditor(id);
        else if (act.dataset.act === 'collapse') select(null);
        return;
      }
      const pin = ev.target.closest && ev.target.closest('.tp3d-annot-pin');
      if (pin && layer.contains(pin)) {
        if (pin.dataset.annotId === DRAFT_ID) return;
        select(pin.dataset.annotId, { toggle: true });
        return;
      }
      const head = ev.target.closest && ev.target.closest('.tp3d-annot-card__head');
      if (head && layer.contains(head)) {
        const id = head.closest('.tp3d-annot-card').dataset.annotId;
        if (id !== selectedId) select(id);
      }
    });
    layer.addEventListener('pointerover', ev => {
      // Hover feedback belongs to the canvas: entering a marker or card clears it.
      if (hover && ev.target !== layer) hover = null;
    });
    // The wheel keeps zooming the 3D view when the pointer is over a marker or card.
    layer.addEventListener('wheel', ev => {
      if (ev.target === layer || (ev.target.closest && ev.target.closest('.tp3d-annot-editor'))) return;
      const canvas = getCanvas();
      if (!canvas) return;
      ev.preventDefault();
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX: ev.deltaX, deltaY: ev.deltaY, deltaZ: ev.deltaZ, deltaMode: ev.deltaMode,
        clientX: ev.clientX, clientY: ev.clientY, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey,
        bubbles: true, cancelable: true,
      }));
    }, { passive: false });
  }

  // ==========================================================================
  // SECTION: KEYBOARD OWNERSHIP (capture phase)
  // ==========================================================================
  function ownsEscape() {
    return Boolean(pinDrag || cardDrag || draft || reattachId || tool || selectedId);
  }

  function onKeyDownCapture(ev) {
    if (!bound || !inEditor()) return;
    if (ev.defaultPrevented) return;
    if (panelOpen && ev.key !== 'Escape' && !['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) keyboardModality = true;
    if (UIComponents.modalOwnership && UIComponents.modalOwnership.blocksKeyboardEvent(ev)) return;
    const key = String(ev.key || '').toLowerCase();
    if (key === 'escape') {
      if (!ownsEscape()) return;
      // A text field, dropdown or popover that owns Escape keeps it (the editor card handles its own fields).
      if (isTypingTarget(ev.target)) return;
      if (typeof els.escapeOwnedElsewhere === 'function' && els.escapeOwnedElsewhere()) return;
      closeOneOwner();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      if (!selectedId || draft || isTypingTarget(ev.target)) return;
      const target = ev.target;
      const owned = target === els.viewport || Boolean(els.layer && els.layer.contains(target)) ||
        Boolean(els.panel && els.panel.contains(target));
      if (!owned) return;
      // The annotation owns this key: cargo is never deleted as a side effect.
      ev.preventDefault();
      ev.stopPropagation();
      removeAnnotation(selectedId, true);
      return;
    }
    // Undo / Redo mid-drag cancels only that drag; cargo history is untouched.
    if (key === 'z' && (ev.metaKey || ev.ctrlKey) && !ev.altKey && (pinDrag || cardDrag) && !isTypingTarget(ev.target)) {
      if (pinDrag) cancelPinDrag('Move cancelled.');
      else cancelCardDrag();
      ev.preventDefault();
    }
  }

  /** One Escape press closes exactly one owner. */
  function closeOneOwner() {
    if (pinDrag) {
      cancelPinDrag('Move cancelled.');
    } else if (cardDrag) {
      cancelCardDrag();
    } else if (draft) {
      cancelDraft();
    } else if (reattachId) {
      cancelReattach('Re-attach cancelled.');
    } else if (tool) {
      tool = null;
      hover = null;
      updateCursor();
      renderPanel();
    } else if (selectedId) {
      selectedId = null;
      visDirty = true;
      renderPanel();
    }
    refreshOverlay();
    refocusViewportIfLost();
  }

  // ==========================================================================
  // SECTION: PANEL POSITION (drag by the header grip, like the Measurements and AutoPack Results panels)
  // ==========================================================================
  // The positioned ancestor the panel's left/top are measured from.
  function panelHost() {
    return els.panel ? (els.panel.offsetParent || els.panel.parentElement) : null;
  }

  function clampPanelPosition(position) {
    const host = panelHost();
    const panel = els.panel;
    if (!host || !panel || !position) return null;
    const maxX = Math.max(PANEL_MARGIN_PX, host.clientWidth - panel.offsetWidth - PANEL_MARGIN_PX);
    const maxY = Math.max(PANEL_MARGIN_PX, host.clientHeight - panel.offsetHeight - PANEL_MARGIN_PX);
    return {
      x: Math.min(Math.max(Number(position.x) || 0, PANEL_MARGIN_PX), maxX),
      y: Math.min(Math.max(Number(position.y) || 0, PANEL_MARGIN_PX), maxY),
    };
  }

  /**
   * Place the panel at the dragged position (clamped to what fits right now) or at its default spot. The
   * preferred position is kept as dragged, so a panel pushed in by a small window returns toward it.
   */
  function applyPanelPosition() {
    const panel = els.panel;
    if (!panel || panel.hidden) return;
    if (!panelPosition || compact) {
      if (panel.classList.contains('is-dragged')) {
        panel.classList.remove('is-dragged');
        panel.style.left = '';
        panel.style.top = '';
      }
      return;
    }
    const next = clampPanelPosition(panelPosition);
    if (!next) return;
    panel.classList.add('is-dragged');
    panel.style.left = `${next.x}px`;
    panel.style.top = `${next.y}px`;
  }

  function attachPanelDrag(handle) {
    handle.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || !els.panel || compact) return;
      const host = panelHost();
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const panelRect = els.panel.getBoundingClientRect();
      const start = {
        pointerX: ev.clientX,
        pointerY: ev.clientY,
        left: panelRect.left - hostRect.left - host.clientLeft,
        top: panelRect.top - hostRect.top - host.clientTop,
      };
      let moved = false;
      const onMove = moveEv => {
        const dx = moveEv.clientX - start.pointerX;
        const dy = moveEv.clientY - start.pointerY;
        if (!moved && Math.hypot(dx, dy) < PANEL_DRAG_THRESHOLD_PX) return;
        if (!moved) {
          moved = true;
          els.panel.classList.add('is-dragging');
        }
        moveEv.preventDefault();
        panelPosition = clampPanelPosition({ x: start.left + dx, y: start.top + dy });
        applyPanelPosition();
      };
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        if (els.panel) els.panel.classList.remove('is-dragging');
        if (!moved) return;
        // The click that follows a drag released over the title must not toggle the panel.
        suppressToggleClick = true;
        window.setTimeout(() => { suppressToggleClick = false; }, 0);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });
  }

  function gripEl() {
    const grip = htmlEl('span', 'tp3d-annot-grip');
    grip.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < 6; dot += 1) grip.appendChild(htmlEl('span', 'tp3d-annot-grip__dot'));
    return grip;
  }

  // ==========================================================================
  // SECTION: PANEL (compact, collapsible; updated in place so a click is never lost)
  // ==========================================================================
  function segmented(label, className) {
    const group = htmlEl('div', `tp3d-annot-seg ${className || ''}`.trim());
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    return group;
  }

  function ensurePanel() {
    if (panelParts && panelParts.root === els.panel && els.panel.contains(panelParts.head)) return panelParts;
    if (!els.panel || !doc) return null;
    const head = htmlEl('div', 'tp3d-annot-panel__head');
    const toggleButton = htmlEl('button', 'tp3d-annot-panel__toggle');
    toggleButton.type = 'button';
    toggleButton.setAttribute('aria-controls', 'editor-annotation-panel-body');
    const title = htmlEl('span', 'tp3d-annot-panel__title', 'Annotations');
    const count = htmlEl('span', 'tp3d-annot-panel__count');
    const chevron = iconEl('fa-solid fa-chevron-up tp3d-annot-panel__chevron');
    toggleButton.append(title, count, chevron);
    toggleButton.addEventListener('click', () => {
      // A drag that began on the title must not also collapse or expand the panel.
      if (suppressToggleClick) return;
      panelCollapsed = !panelCollapsed;
      renderPanel();
    });
    head.append(gripEl(), toggleButton);
    attachPanelDrag(head);

    const body = htmlEl('div', 'tp3d-annot-panel__body');
    body.id = 'editor-annotation-panel-body';
    const blocked = htmlEl('div', 'tp3d-annot-panel__blocked');
    blocked.hidden = true;
    blocked.append(iconEl('fa-solid fa-lock'), htmlEl('span'));

    const toolGroup = segmented('Annotation tool', 'tp3d-annot-seg--tools');
    const toolButtons = TOOL_DEFS.map(def => {
      const button = htmlEl('button', 'tp3d-annot-seg__btn');
      button.type = 'button';
      button.dataset.tool = def.key;
      button.append(iconEl(def.icon), doc.createTextNode(def.label));
      if (def.available) {
        button.addEventListener('click', () => setTool(def.key));
      } else {
        // Arrows and drawings arrive in a later release: clearly unavailable, never pretending to work.
        button.disabled = true;
        button.title = `${def.label} is not available yet`;
        button.setAttribute('aria-label', `${def.label} (not available yet)`);
      }
      toolGroup.appendChild(button);
      return { key: def.key, button, available: def.available };
    });

    const hint = htmlEl('div', 'tp3d-annot-panel__hint');
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    const undoBar = htmlEl('div', 'tp3d-annot-panel__undo');
    undoBar.hidden = true;
    undoBar.setAttribute('role', 'status');
    const undoText = htmlEl('span');
    const undoButton = htmlEl('button', 'tp3d-annot-panel__undo-btn', 'Undo');
    undoButton.type = 'button';
    undoButton.addEventListener('click', undoDelete);
    undoBar.append(undoText, undoButton);

    const view = htmlEl('div', 'tp3d-annot-panel__view');
    view.appendChild(htmlEl('span', 'tp3d-annot-panel__view-label', 'Callouts'));
    const displayGroup = segmented('Callout display', 'tp3d-annot-seg--small');
    const displayButtons = DISPLAY_MODES.map(([key, label]) => {
      const button = htmlEl('button', 'tp3d-annot-seg__btn', label);
      button.type = 'button';
      button.addEventListener('click', () => setDisplay(key));
      displayGroup.appendChild(button);
      return { key, button };
    });
    view.appendChild(displayGroup);

    const empty = htmlEl('div', 'tp3d-annot-panel__empty', 'No callouts yet. A callout marks a spot on cargo, the truck or the ground. Annotations are notes only and do not change the load.');
    const warning = htmlEl('div', 'tp3d-annot-panel__notice', "Some saved annotations couldn't be read. The original data is kept until you delete it.");
    warning.hidden = true;
    const list = htmlEl('ul', 'tp3d-annot-panel__list');
    body.append(blocked, toolGroup, hint, undoBar, view, warning, empty, list);

    els.panel.replaceChildren(head, body);
    rows.clear();
    panelParts = {
      root: els.panel, head, toggle: toggleButton, chevron, count, body, blocked, blockedText: blocked.querySelector('span'),
      toolButtons, hint, undoBar, undoText, displayButtons, empty, warning, list,
    };
    return panelParts;
  }

  function iconButton(className, iconClass, label) {
    const button = htmlEl('button', `tp3d-annot-row__btn ${className}`);
    button.type = 'button';
    button.title = label;
    button.appendChild(iconEl(iconClass));
    return button;
  }

  function createRow() {
    const el = htmlEl('li', 'tp3d-annot-row');
    const selectButton = htmlEl('button', 'tp3d-annot-row__select');
    selectButton.type = 'button';
    const badge = htmlEl('span', 'tp3d-annot-row__badge');
    const text = htmlEl('span', 'tp3d-annot-row__text');
    const name = htmlEl('span', 'tp3d-annot-row__name');
    const sub = htmlEl('span', 'tp3d-annot-row__sub');
    text.append(name, sub);
    selectButton.append(badge, text);
    const actions = htmlEl('div', 'tp3d-annot-row__actions');
    const eye = iconButton('tp3d-annot-row__eye', 'fa-solid fa-eye', 'Hide');
    const edit = iconButton('tp3d-annot-row__edit', 'fa-solid fa-pen', 'Edit');
    const remove = iconButton('tp3d-annot-row__delete', 'fa-solid fa-trash-can', 'Delete');
    actions.append(eye, edit, remove);
    const issue = htmlEl('div', 'tp3d-annot-row__issue');
    issue.hidden = true;
    const issueText = htmlEl('div');
    const reattach = htmlEl('button', 'tp3d-annot-btn tp3d-annot-btn--small', 'Re-attach');
    reattach.type = 'button';
    issue.append(issueText, reattach);
    el.append(selectButton, actions, issue);
    const row = { el, select: selectButton, badge, name, sub, eye, edit, remove, issue, issueText, reattach, id: null, eyeIcon: eye.firstChild };
    selectButton.addEventListener('click', () => select(row.id, { toggle: true }));
    eye.addEventListener('click', () => toggleHidden(row.id));
    edit.addEventListener('click', () => openEditor(row.id));
    // A click event with detail 0 is a keyboard activation (Enter / Space).
    remove.addEventListener('click', ev => removeAnnotation(row.id, ev.detail === 0));
    reattach.addEventListener('click', () => startReattach(row.id));
    return row;
  }

  function updateRow(row, record, result, blocked) {
    row.id = record.id;
    row.el.dataset.annotId = record.id;
    const callout = isCallout(record);
    const status = callout && result ? result.status : ANNOTATION_STATUS.UNRESOLVED;
    const valid = status === ANNOTATION_STATUS.VALID;
    const title = callout ? record.title : 'Unreadable annotation';
    setText(row.name, title);
    let sub;
    if (!callout) sub = 'Data could not be read';
    else if (!valid) sub = annotationStatusLabel(status);
    else sub = `${anchorTargetName(record.anchor)}${record.hidden ? ' · Hidden' : ''}`;
    setText(row.sub, sub);
    row.sub.dataset.status = callout ? status : 'unreadable';
    const selected = record.id === selectedId;
    toggleClass(row.el, 'is-selected', selected);
    toggleClass(row.el, 'is-hidden', callout && record.hidden === true);
    row.el.dataset.status = callout ? status : 'unreadable';
    // Number badge: colored when Valid, a dashed ring when it needs attention, a warning icon when unreadable.
    const number = numbers.get(record.id);
    if (callout) {
      setText(row.badge, number ? String(number) : '');
      row.badge.dataset.color = record.color;
      toggleClass(row.badge, 'is-flagged', !valid);
    } else {
      row.badge.dataset.color = '';
      toggleClass(row.badge, 'is-flagged', true);
      if (!row.badge.firstChild || row.badge.firstChild.nodeType !== 1) row.badge.replaceChildren(iconEl('fa-solid fa-triangle-exclamation'));
    }
    row.select.disabled = !callout;
    setAttr(row.select, 'aria-pressed', selected ? 'true' : 'false');
    setAttr(row.select, 'aria-label', `${callout ? `Callout ${number}: ` : ''}${title}, ${sub}${selected ? ', selected' : ''}`);
    row.select.title = callout ? 'Select to show its card' : '';

    setHidden(row.eye, !callout);
    setHidden(row.edit, !callout);
    row.eye.disabled = blocked;
    row.edit.disabled = blocked;
    row.remove.disabled = blocked;
    if (callout) {
      const hiddenNow = record.hidden === true;
      const eyeClass = `fa-solid ${hiddenNow ? 'fa-eye-slash' : 'fa-eye'}`;
      if (row.eyeIcon.className !== eyeClass) row.eyeIcon.className = eyeClass;
      setAttr(row.eye, 'aria-label', `${hiddenNow ? 'Show' : 'Hide'} ${title}`);
      row.eye.title = hiddenNow ? 'Show' : 'Hide';
      setAttr(row.edit, 'aria-label', `Edit ${title}`);
    }
    setAttr(row.remove, 'aria-label', `Delete ${title}`);

    const issue = !callout ? describeAnnotationReason('unreadable') : (valid ? '' : describeAnnotationReason(result ? result.reason : 'unreadable'));
    setText(row.issueText, issue);
    setHidden(row.issue, !issue);
    setHidden(row.reattach, !callout || valid);
    row.reattach.disabled = blocked;
  }

  /** Context-sensitive guidance: empty unless something is relevant right now. */
  function guidanceText(blockedNow) {
    if (blockedNow) return blockedMessage(blockedNow);
    if (statusMessage) return statusMessage;
    if (pinDrag && pinDrag.moved) return 'Drag the marker onto a surface. Esc cancels.';
    if (reattachId) return 'Click cargo, the truck or the ground to re-attach this callout. Esc cancels.';
    if (draft) {
      return draft.editId
        ? 'Editing callout. Drag its marker or card to move them. Esc cancels.'
        : 'Add a title, then save. Click the scene or drag the marker to move it. Esc cancels.';
    }
    if (tool === 'callout') return 'Click cargo, the truck or the ground to place a callout.';
    if (records.length >= MAX_ANNOTATIONS_PER_PACK) return `Limit of ${MAX_ANNOTATIONS_PER_PACK} annotations reached. Delete one to add another.`;
    if (!records.length) return 'Choose Callout, then click cargo, the truck or the ground.';
    return '';
  }

  /** Colour of the dot beside the guidance: orange while a gesture is under way or something needs attention, green after a save. */
  function guidanceTone(blockedNow) {
    if (blockedNow) return 'active';
    if (statusMessage) return statusTone || (tool || draft || reattachId ? 'active' : '');
    if (tool || draft || reattachId || (pinDrag && pinDrag.moved) || records.length >= MAX_ANNOTATIONS_PER_PACK) return 'active';
    return '';
  }

  function renderPanel() {
    if (!panelOpen || !doc) return;
    const parts = ensurePanel();
    if (!parts) return;
    const blockedNow = blockedReason();

    const countText = records.length ? String(records.length) : '';
    setText(parts.count, countText);
    parts.toggle.setAttribute('aria-expanded', panelCollapsed ? 'false' : 'true');
    const chevronClass = `fa-solid fa-chevron-${panelCollapsed ? 'down' : 'up'} tp3d-annot-panel__chevron`;
    if (parts.chevron.className !== chevronClass) parts.chevron.className = chevronClass;
    toggleClass(parts.root, 'is-collapsed', panelCollapsed);
    toggleClass(parts.root, 'is-compact', compact);
    toggleClass(parts.root, 'is-covered', compact && Boolean(draft));
    setHidden(parts.body, panelCollapsed);

    setHidden(parts.blocked, !blockedNow);
    if (blockedNow) setText(parts.blockedText, `${blockedMessage(blockedNow)} You can still select and view annotations.`);
    parts.toolButtons.forEach(({ key, button, available }) => {
      if (!available) return;
      setAttr(button, 'aria-pressed', tool === key ? 'true' : 'false');
      button.disabled = Boolean(blockedNow) && tool !== key;
    });
    parts.displayButtons.forEach(({ key, button }) => setAttr(button, 'aria-pressed', display === key ? 'true' : 'false'));

    const hintText = guidanceText(blockedNow);
    setText(parts.hint, hintText);
    const hintTone = guidanceTone(blockedNow);
    if ((parts.hint.dataset.tone || '') !== hintTone) {
      if (hintTone) parts.hint.dataset.tone = hintTone;
      else delete parts.hint.dataset.tone;
    }
    setHidden(parts.undoBar, !lastDeleted);
    if (lastDeleted) {
      setText(parts.undoText, lastDeleted.record.type === ANNOTATION_TYPE_CALLOUT ? 'Callout deleted. Cargo is unchanged.' : 'Unreadable annotation deleted.');
      parts.undoBar.querySelector('button').disabled = Boolean(blockedNow);
    }
    setHidden(parts.empty, records.length > 0);
    setHidden(parts.warning, !records.some(record => record.type === ANNOTATION_TYPE_UNREADABLE));

    const seen = new Set();
    records.forEach((record, index) => {
      let row = rows.get(record.id);
      if (!row) {
        row = createRow();
        rows.set(record.id, row);
      }
      updateRow(row, record, results[index], Boolean(blockedNow));
      if (parts.list.children[index] !== row.el) parts.list.insertBefore(row.el, parts.list.children[index] || null);
      seen.add(record.id);
    });
    rows.forEach((row, id) => {
      if (seen.has(id)) return;
      row.el.remove();
      rows.delete(id);
    });
    applyPanelPosition(); // rows or collapsing change the panel size: keep it inside the viewport
  }

  /** React to a change in what (if anything) makes annotations read-only. A blocking operation cancels unfinished edits. */
  function syncBlocked() {
    const reason = blockedReason();
    if (reason === lastBlockedReason) return reason;
    lastBlockedReason = reason;
    if (reason) {
      if (pinDrag) cancelPinDrag(blockedMessage(reason));
      if (cardDrag) cancelCardDrag();
      if (reattachId) cancelReattach(blockedMessage(reason));
      if (draft && !draft.editId) cancelDraft(blockedMessage(reason));
      else if (draft) cancelDraft(blockedMessage(reason));
      if (tool) {
        tool = null;
        hover = null;
        updateCursor();
      }
      clearDeleted();
    }
    renderPanel();
    return reason;
  }

  // ==========================================================================
  // SECTION: FRAME LOOP (runs while there is anything to draw or edit)
  // ==========================================================================
  /** True while a scene tool (the armed Callout tool or a re-attach) owns primary pointer input on the canvas. */
  function isActive() {
    return Boolean(tool || reattachId);
  }

  function wantsLoop() {
    return bound && inEditor() && Boolean(currentPack()) &&
      (panelOpen || draft || tool || reattachId || pinDrag || cardDrag || drawableIds.size > 0);
  }

  function ensureLoop() {
    if (rafId === null && wantsLoop()) rafId = window.requestAnimationFrame(loop);
  }

  /**
   * Draw the overlay now instead of waiting for the next frame, so a state change (a save, a selection, a
   * deletion) is visible at once even when frames are slow. Never starts the loop by itself.
   */
  function refreshOverlay() {
    if (!wantsLoop() || !SceneManager.getCamera()) return;
    render(window.performance.now());
  }

  function loop(now) {
    rafId = null;
    if (!wantsLoop()) {
      disposeOverlay();
      return;
    }
    frame(now);
    rafId = window.requestAnimationFrame(loop);
  }

  function updateCursor() {
    const canvas = getCanvas();
    if (!canvas) return;
    let cursor = 'default';
    if (isActive()) cursor = pinDrag && pinDrag.moved ? 'grabbing' : (hover ? 'crosshair' : 'default');
    if (cursor === lastCursor) return;
    lastCursor = cursor;
    canvas.style.cursor = cursor;
  }

  function frame(now) {
    const reason = syncBlocked();
    if (pinDrag && pinDrag.moved) {
      if (pinDrag.dirty && lastClient) {
        pinDrag.dirty = false;
        pinDrag.candidate = reason ? null : pick(lastClient.x, lastClient.y);
      }
    } else if (isActive() && hoverDirty && lastClient && now - lastHoverPickAt >= HOVER_PICK_INTERVAL_MS) {
      hoverDirty = false;
      lastHoverPickAt = now;
      hover = reason ? null : pick(lastClient.x, lastClient.y);
    } else if (!isActive() && hover) {
      hover = null;
    }
    render(now);
    updateCursor();
  }

  // ==========================================================================
  // SECTION: OVERLAY (projection, facing/occlusion, layout, DOM)
  // ==========================================================================
  function ensureLayerParts() {
    if (layerParts && layerParts.svg.isConnected) return layerParts;
    if (!els.layer || !doc) return null;
    const svg = svgEl('svg', 'tp3d-annot-svg');
    svg.setAttribute('aria-hidden', 'true');
    const hoverUnder = svgEl('path', 'tp3d-annot-svg__under');
    const hoverMark = svgEl('path', 'tp3d-annot-svg__mark');
    const ghost = svgEl('circle', 'tp3d-annot-svg__ghost');
    ghost.setAttribute('r', '9');
    ghost.style.display = 'none';
    const draftLeaderUnder = svgEl('path', 'tp3d-annot-svg__under');
    const draftLeader = svgEl('path', 'tp3d-annot-svg__leader is-selected');
    svg.append(ghost, hoverUnder, hoverMark, draftLeaderUnder, draftLeader);
    els.layer.prepend(svg);
    const tip = htmlEl('div', 'tp3d-annot-tip');
    tip.hidden = true;
    const overflow = htmlEl('div', 'tp3d-annot-overflow');
    overflow.hidden = true;
    overflow.setAttribute('role', 'status');
    overflow.append(iconEl('fa-solid fa-circle-info'), htmlEl('span'));
    const draftPin = makePin(DRAFT_ID);
    draftPin.pin.classList.add('is-draft');
    draftPin.badge.textContent = '+';
    draftPin.pin.setAttribute('aria-label', 'New callout marker. Drag to move it.');
    draftPin.pin.title = 'Drag to move the marker';
    draftPin.pin.hidden = true;
    els.layer.append(tip, overflow);
    layerParts = {
      svg, hoverUnder, hoverMark, ghost, tip, overflow, overflowText: overflow.querySelector('span'),
      draftLeaderUnder, draftLeader, draftPin, leaders: new Map(), keys: { hover: '', ghost: '', draftLeader: '' },
    };
    return layerParts;
  }

  function makePin(id) {
    const pin = htmlEl('button', 'tp3d-annot-pin');
    pin.type = 'button';
    pin.dataset.annotId = id;
    const badge = htmlEl('span', 'tp3d-annot-pin__badge');
    const chip = htmlEl('span', 'tp3d-annot-pin__chip');
    chip.hidden = true;
    pin.append(badge, chip);
    els.layer.appendChild(pin);
    return { pin, badge, chip };
  }

  function makeCard(id) {
    const card = htmlEl('div', 'tp3d-annot-card');
    card.dataset.annotId = id;
    card.setAttribute('role', 'group');
    const head = htmlEl('div', 'tp3d-annot-card__head');
    head.title = 'Drag to move this card';
    const swatch = htmlEl('span', 'tp3d-annot-card__swatch');
    const title = htmlEl('span', 'tp3d-annot-card__title');
    const edit = htmlEl('button', 'tp3d-annot-card__btn');
    edit.type = 'button';
    edit.dataset.act = 'edit';
    edit.title = 'Edit callout';
    edit.setAttribute('aria-label', 'Edit callout');
    edit.appendChild(iconEl('fa-solid fa-pen'));
    const collapse = htmlEl('button', 'tp3d-annot-card__btn');
    collapse.type = 'button';
    collapse.dataset.act = 'collapse';
    collapse.title = 'Collapse callout';
    collapse.setAttribute('aria-label', 'Collapse callout');
    collapse.appendChild(iconEl('fa-solid fa-chevron-up'));
    head.append(swatch, title, edit, collapse);
    const desc = htmlEl('div', 'tp3d-annot-card__desc');
    const foot = htmlEl('div', 'tp3d-annot-card__foot');
    const target = htmlEl('span', 'tp3d-annot-card__target');
    const behind = htmlEl('span', 'tp3d-annot-card__behind', 'Behind cargo');
    foot.append(iconEl('fa-solid fa-cube'), target, behind);
    card.append(head, desc, foot);
    els.layer.appendChild(card);
    return { card, swatch, title, edit, collapse, desc, target, behind };
  }

  function getView(id) {
    let view = views.get(id);
    if (!view) {
      const pinParts = makePin(id);
      view = {
        id, ...pinParts, cardParts: null, world: new THREE.Vector3(), screen: null, front: true, measured: false, slot: null,
        cardKey: '', cardSize: null, cardRect: null, pinKey: '', transformKey: '', cardTransformKey: '', shown: false,
      };
      views.set(id, view);
      visDirty = true;
    }
    return view;
  }

  function hideView(view) {
    if (view.shown) {
      view.pin.hidden = true;
      if (view.cardParts) {
        view.cardParts.card.hidden = true;
        view.cardParts.card.classList.remove('is-selected');
      }
      view.shown = false;
      view.screen = null;
      view.cardRect = null;
    }
  }

  function removeView(id) {
    const view = views.get(id);
    if (!view) return;
    view.pin.remove();
    if (view.cardParts) view.cardParts.card.remove();
    views.delete(id);
    if (layerParts) {
      const leader = layerParts.leaders.get(id);
      if (leader) {
        leader.under.remove();
        leader.line.remove();
        layerParts.leaders.delete(id);
      }
    }
  }

  /** Remove every drawn element (the loop has stopped, the panel closed with nothing to show, or the Editor was left). */
  function disposeOverlay() {
    [...views.keys()].forEach(removeView);
    if (editorParts) setHidden(editorParts.root, true);
    if (layerParts) {
      layerParts.draftPin.pin.hidden = true;
      layerParts.tip.hidden = true;
      layerParts.overflow.hidden = true;
      layerParts.ghost.style.display = 'none';
      layerParts.hoverMark.setAttribute('d', '');
      layerParts.hoverUnder.setAttribute('d', '');
      layerParts.draftLeader.setAttribute('d', '');
      layerParts.draftLeaderUnder.setAttribute('d', '');
      layerParts.keys = { hover: '', ghost: '', draftLeader: '' };
    }
    lastSignature = NaN;
  }

  function setPath(el, d) {
    if (el.getAttribute('d') !== d) el.setAttribute('d', d);
  }

  /** Project a world point to layer pixels; null when it is behind a perspective camera. */
  function projectToLayer(point, camera, width, height, out) {
    projected.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if (camera.isPerspectiveCamera && projected.z > -(camera.near + 0.001)) return null;
    projected.applyMatrix4(camera.projectionMatrix);
    out.x = (projected.x * 0.5 + 0.5) * width;
    out.y = (-projected.y * 0.5 + 0.5) * height;
    return out;
  }

  function cameraSignature(camera) {
    const e = camera.matrixWorld.elements;
    const p = camera.projectionMatrix.elements;
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i] * (i + 1.37);
    return sum + p[0] * 7.1 + p[5] * 3.3 + p[10] * 1.9 + p[14] * 0.7;
  }

  /**
   * Whether the marker's surface faces the camera and nothing is in front of it. Derived on demand (never
   * stored); a marker that fails either test is drawn hollow, but a selected one keeps its card.
   */
  function computeFront(entry, camera, meshes) {
    const { record, view } = entry;
    const spec = anchorSurfaceNormal(record.anchor);
    const scale = picker.toWorldScale();
    let hasNormal = false;
    if (spec) {
      if (spec.frame === 'world') {
        normalVec.set(spec.x, spec.y, spec.z);
        hasNormal = true;
      } else {
        const group = cargoGroupFor(record.anchor);
        if (group) {
          group.updateMatrixWorld(true);
          normalVec.set(spec.x, spec.y, spec.z).transformDirection(group.matrixWorld);
          hasNormal = true;
        }
      }
    }
    const ortho = Boolean(camera.isOrthographicCamera);
    if (ortho) camera.getWorldDirection(viewDir);
    else camera.getWorldPosition(camPos);
    if (hasNormal) {
      const facing = ortho ? normalVec.dot(viewDir) < 0 : normalVec.dot(rayDir.subVectors(camPos, view.world)) > 0;
      if (!facing) return false;
    }
    // Cast from the camera TOWARD the marker, stopping just short of it: whatever is hit on the way hides it.
    // (Casting from the marker would start inside any cargo that was moved onto it, where back faces are culled.)
    let far;
    if (ortho) {
      rayDir.copy(viewDir);
      rayOrigin.copy(view.world).addScaledVector(viewDir, -ORTHO_RAY_LENGTH);
      far = ORTHO_RAY_LENGTH - OCCLUSION_STOP_INCHES * scale;
    } else {
      rayDir.subVectors(view.world, camPos);
      far = rayDir.length() - OCCLUSION_STOP_INCHES * scale;
      if (far <= MIN_RAY_LENGTH) return true;
      rayDir.normalize();
      rayOrigin.copy(camPos);
    }
    raycaster.set(rayOrigin, rayDir);
    raycaster.near = 0;
    raycaster.far = far;
    return raycaster.intersectObjects(meshes, false).length === 0;
  }

  function updatePin(view, entry, flags) {
    const { record } = entry;
    const key = `${record.title}|${record.color}|${entry.number}|${flags.chipText}|${flags.selected}|${flags.hollow}|${flags.dragging}`;
    if (view.pinKey !== key) {
      view.pinKey = key;
      setText(view.badge, String(entry.number));
      view.pin.dataset.color = record.color;
      setAttr(view.pin, 'aria-label', `Callout ${entry.number}: ${record.title}`);
      setAttr(view.pin, 'aria-pressed', flags.selected ? 'true' : 'false');
      view.pin.title = record.title;
      toggleClass(view.pin, 'is-selected', flags.selected);
      toggleClass(view.pin, 'is-hollow', flags.hollow);
      toggleClass(view.pin, 'is-dragging', flags.dragging);
      setText(view.chip, flags.chipText);
      setHidden(view.chip, !flags.chipText);
    }
    toggleClass(view.pin, 'is-chip-left', view.screen.x > flags.width - LABEL_FLIP_MARGIN);
    const transform = `translate(${view.screen.x.toFixed(1)}px, ${view.screen.y.toFixed(1)}px)`;
    if (view.transformKey !== transform) {
      view.transformKey = transform;
      view.pin.style.transform = transform;
    }
    if (view.pin.hidden) view.pin.hidden = false;
  }

  function updateCardContent(view, entry, cardW, behind, selected) {
    if (!view.cardParts) view.cardParts = makeCard(entry.record.id);
    const parts = view.cardParts;
    const { record } = entry;
    const targetName = anchorTargetName(record.anchor);
    const key = `${record.title}\n${record.description || ''}\n${record.color}\n${entry.number}\n${targetName}\n${cardW}`;
    const wasHidden = parts.card.hidden;
    if (wasHidden) parts.card.hidden = false;
    if (view.cardKey !== key) {
      view.cardKey = key;
      parts.card.dataset.color = record.color;
      parts.card.style.width = `${cardW}px`;
      setAttr(parts.card, 'aria-label', `Callout ${entry.number}: ${record.title}`);
      setText(parts.swatch, String(entry.number));
      setText(parts.title, record.title);
      setText(parts.desc, record.description || '');
      setHidden(parts.desc, !record.description);
      setText(parts.target, targetName);
      view.cardSize = null;
    }
    toggleClass(parts.card, 'is-selected', selected);
    toggleClass(parts.card, 'is-behind', behind);
    setHidden(parts.behind, !behind);
    setHidden(parts.edit, !selected);
    setHidden(parts.collapse, !selected);
    if (!view.cardSize || view.cardSize.w !== cardW) {
      // Measured once per content change (not per frame): the placement needs the real height.
      view.cardSize = { w: cardW, h: parts.card.offsetHeight || estimateCardHeight(record.description, cardW) };
    }
    return view.cardSize;
  }

  function placeCard(view, rect) {
    const transform = `translate(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px)`;
    if (view.cardTransformKey !== transform) {
      view.cardTransformKey = transform;
      view.cardParts.card.style.transform = transform;
    }
    view.cardRect = rect;
  }

  function leaderFor(parts, id) {
    let leader = parts.leaders.get(id);
    if (!leader) {
      leader = { under: svgEl('path', 'tp3d-annot-svg__under'), line: svgEl('path', 'tp3d-annot-svg__leader') };
      parts.svg.append(leader.under, leader.line);
      parts.leaders.set(id, leader);
    }
    return leader;
  }

  function render(now) {
    const camera = SceneManager.getCamera();
    const parts = ensureLayerParts();
    if (!camera || !parts || !doc || !inEditor()) return;
    const layerRect = els.layer.getBoundingClientRect();
    const width = layerRect.width > 0 ? layerRect.width : 1;
    const height = layerRect.height > 0 ? layerRect.height : 1;
    const viewport = { width, height };
    const nextCompact = isCompactViewport(width);
    if (nextCompact !== compact) {
      compact = nextCompact;
      toggleClass(els.layer, 'is-compact', compact);
      if (panelOpen) renderPanel();
    }

    // 1. Which callouts are drawn, and where they project.
    const entries = [];
    const live = new Set();
    records.forEach((record, index) => {
      if (!isCallout(record)) return;
      live.add(record.id);
      if (!drawableIds.has(record.id)) {
        const stale = views.get(record.id);
        if (stale) hideView(stale);
        return;
      }
      const view = getView(record.id);
      const dragging = Boolean(pinDrag && pinDrag.moved && pinDrag.id === record.id);
      const ok = dragging && pinDrag.candidate
        ? view.world.copy(pinDrag.candidate.world)
        : liveAnchorWorld(record.anchor, results[index].point, view.world);
      const screen = ok ? projectToLayer(view.world, camera, width, height, view.screen || {}) : null;
      if (!screen || screen.x < -OFFSCREEN_MARGIN_PX || screen.x > width + OFFSCREEN_MARGIN_PX ||
          screen.y < -OFFSCREEN_MARGIN_PX || screen.y > height + OFFSCREEN_MARGIN_PX) {
        hideView(view);
        return;
      }
      view.screen = screen;
      view.shown = true;
      entries.push({ record, view, number: numbers.get(record.id), selected: record.id === selectedId, dragging });
    });
    [...views.keys()].forEach(id => { if (!live.has(id)) removeView(id); });

    // 2. Facing and occlusion, refreshed only after something moved and at most every OCCLUSION_INTERVAL_MS.
    let signature = cameraSignature(camera);
    entries.forEach((entry, i) => {
      const p = entry.view.world;
      signature += (i + 1) * (p.x * 1.1 + p.y * 1.3 + p.z * 1.7);
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      visDirty = true;
    }
    // A marker that has never been measured is measured at once, so it is never first drawn as facing the camera.
    const unmeasured = entries.filter(entry => !entry.view.measured);
    const due = visDirty && now - lastVisAt >= OCCLUSION_INTERVAL_MS;
    if ((due || unmeasured.length) && entries.length) {
      if (due) {
        visDirty = false;
        lastVisAt = now;
      }
      const meshes = CaseScene.getRaycastMeshes().filter(mesh => mesh.parent && mesh.parent.visible !== false);
      (due ? entries : unmeasured).forEach(entry => {
        entry.view.front = computeFront(entry, camera, meshes);
        entry.view.measured = true;
      });
    }

    // 3. Which cards are shown: selected, kept expanded and (in Cards mode) every visible one, within a budget.
    const editingId = draft && draft.editId;
    const wantsCard = entry => entry.record.id !== editingId &&
      (entry.selected || entry.record.keepExpanded || display === 'cards') && (entry.view.front || entry.selected || entry.record.keepExpanded);
    const candidates = entries.filter(wantsCard).sort((a, b) =>
      (Number(b.selected) - Number(a.selected)) ||
      (Number(b.record.keepExpanded) - Number(a.record.keepExpanded)) ||
      (Number(b.view.front) - Number(a.view.front)) || (a.number - b.number));
    const budget = cardBudget(width, height);
    const shown = candidates.slice(0, budget);
    const shownIds = new Set(shown.map(entry => entry.record.id));
    const overflow = candidates.length - shown.length;

    // 4. Pins first (cards avoid every marker), then cards in priority order.
    const pinRects = entries.map(entry => ({ id: entry.record.id, x: entry.view.screen.x - PIN_RECT_PX / 2, y: entry.view.screen.y - PIN_RECT_PX / 2, w: PIN_RECT_PX, h: PIN_RECT_PX }));
    const panelBox = panelObstacle();
    const labelIds = display === 'markers' ? new Set() : fitLabels(
      entries.filter(entry => entry.view.front && !shownIds.has(entry.record.id))
        .sort((a, b) => a.number - b.number)
        .map(entry => ({ id: entry.record.id, marker: { x: entry.view.screen.x, y: entry.view.screen.y }, text: entry.record.title })),
      panelBox ? pinRects.concat({ id: '', ...panelBox }) : pinRects, width);
    entries.forEach(entry => {
      const showLabel = labelIds.has(entry.record.id);
      updatePin(entry.view, entry, {
        selected: entry.selected,
        hollow: !entry.view.front && !entry.selected,
        dragging: entry.dragging,
        chipText: showLabel ? entry.record.title : '',
        width,
      });
    });
    const cardW = cardWidth(width);
    const placed = [];
    const activeLeaders = new Set();
    shown.forEach(entry => {
      const { view, record } = entry;
      const size = updateCardContent(view, entry, cardW, !view.front, entry.selected);
      const marker = { x: view.screen.x, y: view.screen.y };
      let rect;
      if (cardDrag && cardDrag.id === record.id && cardDrag.rect) {
        rect = cardDrag.rect;
      } else if (record.offset) {
        rect = rectFromOffset(marker, record.offset, size, viewport);
      } else {
        const occupied = [...pinRects.filter(pinRect => pinRect.id !== record.id), ...placed, ...(panelBox ? [panelBox] : [])];
        const auto = autoPlace({ marker, size, viewport, occupied, previousSlot: view.slot });
        view.slot = auto.slot;
        rect = { x: auto.x, y: auto.y, w: auto.w, h: auto.h };
      }
      placed.push(rect);
      placeCard(view, rect);
      const line = leaderLine(marker, rect);
      const leader = leaderFor(parts, record.id);
      activeLeaders.add(record.id);
      const d = line ? `M${line.x1.toFixed(1)} ${line.y1.toFixed(1)}L${line.x2.toFixed(1)} ${line.y2.toFixed(1)}` : '';
      setPath(leader.under, d);
      setPath(leader.line, d);
      toggleClass(leader.line, 'is-selected', entry.selected);
    });
    entries.forEach(entry => {
      if (shownIds.has(entry.record.id)) return;
      const card = entry.view.cardParts && entry.view.cardParts.card;
      if (card && !card.hidden) {
        card.hidden = true;
        card.classList.remove('is-selected');
      }
      entry.view.cardRect = null;
    });
    parts.leaders.forEach((leader, id) => {
      if (activeLeaders.has(id)) return;
      setPath(leader.under, '');
      setPath(leader.line, '');
    });

    // 5. The overflow notice, the new-callout marker and editor card, the hover mark and its tip, the drag ghost.
    setHidden(parts.overflow, overflow <= 0);
    if (overflow > 0) {
      setText(parts.overflowText, `${overflow} more ${overflow === 1 ? 'callout is' : 'callouts are'} shown without a card. Zoom in or hide some to see their cards.`);
    }
    renderDraft(parts, camera, width, height, viewport, pinRects);
    renderHover(parts, camera, width, height);
    renderGhost(parts, camera, width, height, entries);
  }

  function renderDraft(parts, camera, width, height, viewport, pinRects) {
    const pin = parts.draftPin;
    if (!draft) {
      if (!pin.pin.hidden) pin.pin.hidden = true;
      setPath(parts.draftLeader, '');
      setPath(parts.draftLeaderUnder, '');
      return;
    }
    // The new callout's marker, or (when editing) the existing marker is drawn by its own view.
    let screen;
    if (!draft.editId) {
      const dragging = pinDrag && pinDrag.moved && pinDrag.id === DRAFT_ID && pinDrag.candidate;
      // Cargo follows the scene's displayed pose; any other surface is a fixed point in space.
      if (dragging) draftWorld.copy(pinDrag.candidate.world);
      else if (!liveAnchorWorld(draft.anchor, null, draftWorld)) draftWorld.copy(draft.world);
      screen = projectToLayer(draftWorld, camera, width, height, scratchScreen);
    } else {
      const view = views.get(draft.editId);
      screen = view && view.screen ? view.screen : null;
    }
    if (!draft.editId) {
      if (screen) {
        const transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px)`;
        if (pin.pin.style.transform !== transform) pin.pin.style.transform = transform;
        if (pin.pin.hidden) pin.pin.hidden = false;
        toggleClass(pin.pin, 'is-dragging', Boolean(pinDrag && pinDrag.moved && pinDrag.id === DRAFT_ID));
      } else if (!pin.pin.hidden) {
        pin.pin.hidden = true;
      }
    } else if (!pin.pin.hidden) {
      pin.pin.hidden = true;
    }
    const parts2 = ensureEditor();
    if (!parts2) return;
    toggleClass(parts2.root, 'is-sheet', compact);
    if (compact || !screen) {
      parts2.root.style.transform = '';
      setPath(parts.draftLeader, '');
      setPath(parts.draftLeaderUnder, '');
      return;
    }
    const size = { w: EDITOR_WIDTH_PX, h: parts2.root.offsetHeight || EDITOR_FALLBACK_HEIGHT_PX };
    let rect;
    if (draft.editorPos) {
      rect = clampRect({ x: draft.editorPos.x, y: draft.editorPos.y, w: size.w, h: size.h }, viewport);
    } else {
      const panelRect = panelObstacle();
      const occupied = pinRects.filter(p => p.id !== draft.editId).concat(panelRect ? [panelRect] : []);
      const auto = autoPlace({ marker: { x: screen.x, y: screen.y }, size, viewport, occupied, previousSlot: draft.slot });
      draft.slot = auto.slot;
      rect = { x: auto.x, y: auto.y, w: auto.w, h: auto.h };
    }
    const transform = `translate(${rect.x.toFixed(1)}px, ${rect.y.toFixed(1)}px)`;
    if (parts2.root.style.transform !== transform) parts2.root.style.transform = transform;
    const line = leaderLine({ x: screen.x, y: screen.y }, rect);
    const d = line ? `M${line.x1.toFixed(1)} ${line.y1.toFixed(1)}L${line.x2.toFixed(1)} ${line.y2.toFixed(1)}` : '';
    setPath(parts.draftLeader, d);
    setPath(parts.draftLeaderUnder, d);
  }

  /** The Annotations panel as a rectangle in layer pixels, so the automatic editor placement avoids covering it. */
  function panelObstacle() {
    if (!panelOpen || !els.panel || els.panel.hidden || !els.layer) return null;
    const layerRect = els.layer.getBoundingClientRect();
    const rect = els.panel.getBoundingClientRect();
    return { x: rect.left - layerRect.left, y: rect.top - layerRect.top, w: rect.width, h: rect.height };
  }

  function renderHover(parts, camera, width, height) {
    const show = isActive() && hover && hover.world && !(pinDrag && pinDrag.moved) && !blockedReason();
    if (!show) {
      if (parts.keys.hover !== '') {
        parts.keys.hover = '';
        setPath(parts.hoverMark, '');
        setPath(parts.hoverUnder, '');
      }
      if (!parts.tip.hidden) parts.tip.hidden = true;
      return;
    }
    const screen = projectToLayer(hover.world, camera, width, height, scratchScreen);
    if (!screen) {
      if (!parts.tip.hidden) parts.tip.hidden = true;
      return;
    }
    const x = screen.x.toFixed(1);
    const y = screen.y.toFixed(1);
    const key = `${x},${y}`;
    if (parts.keys.hover !== key) {
      parts.keys.hover = key;
      const arm = MARKER_ARM_PX;
      const d = `M${(screen.x - arm).toFixed(1)} ${y}L${(screen.x + arm).toFixed(1)} ${y}M${x} ${(screen.y - arm).toFixed(1)}L${x} ${(screen.y + arm).toFixed(1)}`;
      setPath(parts.hoverMark, d);
      setPath(parts.hoverUnder, d);
    }
    // What a click would attach to, next to the pointer.
    const name = anchorTargetName(hover.anchor);
    setText(parts.tip, name);
    const px = lastClient ? lastClient.x - els.layer.getBoundingClientRect().left : screen.x;
    const py = lastClient ? lastClient.y - els.layer.getBoundingClientRect().top : screen.y;
    const tx = Math.max(4, Math.min(width - 190, px + 14));
    const ty = Math.max(4, Math.min(height - 30, py + 16));
    const transform = `translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px)`;
    if (parts.tip.style.transform !== transform) parts.tip.style.transform = transform;
    if (parts.tip.hidden) parts.tip.hidden = false;
  }

  /** While a saved marker is dragged: a faint ring where it was. */
  function renderGhost(parts, camera, width, height, entries) {
    const entry = pinDrag && pinDrag.moved && pinDrag.id !== DRAFT_ID ? entries.find(e => e.record.id === pinDrag.id) : null;
    let shownGhost = false;
    if (entry) {
      const index = records.findIndex(record => record.id === entry.record.id);
      if (index !== -1 && liveAnchorWorld(entry.record.anchor, results[index].point, ghostWorld)) {
        const screen = projectToLayer(ghostWorld, camera, width, height, ghostScreen);
        if (screen) {
          parts.ghost.setAttribute('cx', screen.x.toFixed(1));
          parts.ghost.setAttribute('cy', screen.y.toFixed(1));
          shownGhost = true;
        }
      }
    }
    parts.ghost.style.display = shownGhost ? '' : 'none';
  }

  // ==========================================================================
  // SECTION: PUBLIC API
  // ==========================================================================
  return {
    bind,
    sync,
    destroy,
    openPanel,
    closePanel,
    togglePanel,
    isPanelOpen: () => panelOpen,
    isActive,
    hasDraft: () => Boolean(draft),
    selectedId: () => selectedId,
    onPointerDown,
    onPointerMove,
    onPointerCancel,
    onPointerUp,
    onDoubleClick,
  };
}
