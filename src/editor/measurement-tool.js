/**
 * @file measurement-tool.js
 * @description Measurement Tool V1 controller: Measurement Mode, picking, the on-screen dimension
 *   lines and the compact measurement list. THREE and DOM concerns live here; the data model,
 *   validation and geometry resolution live in core/measurements.js and persistence lives in
 *   PackLibrary. The tool is an illustrative, informational ruler: it never moves cargo, never
 *   changes the cargo selection, and never participates in collision, assessment, AutoPack or exports.
 *
 *   A point can be placed on anything visible: any cargo surface (any shape), the truck floor,
 *   wheel-well tops and deck, the truck walls, ceiling and end planes, and the ground anywhere,
 *   including outside the truck. A completed measurement can be selected and either endpoint
 *   dragged onto any other supported surface.
 *
 *   Ownership rules (docs/product/TP3D-MASTER-TODO-V6.md Section 4.1):
 *   - While the mode is active the Editor's pointer handlers delegate here instead of selecting or
 *     dragging cargo. OrbitControls is untouched, so orbit, pan and zoom stay available. The one
 *     exception is a press on a selected measurement's grip: that press is claimed in the capture
 *     phase so neither OrbitControls nor the Editor sees it, and it ends on release or cancel.
 *   - One Escape exits the mode through exit(): an unfinished Point A or endpoint drag is dropped
 *     without writing, saved measurements stay, and the event is consumed in the capture phase so
 *     cargo deselection, the mobile drawers and other Escape handlers never see it. A modal, dropdown,
 *     text field or popover that owns Escape keeps it. Undo with an unfinished Point A or endpoint
 *     drag cancels only that gesture. Cargo keys (including Delete) act on the cargo selection as
 *     they always do; a gesture that loses its cargo is cancelled by sync() and writes nothing.
 *   - Lines, ticks and labels are drawn as an SVG/DOM layer above the canvas, so they can never
 *     appear in a canvas capture (Screenshot, PDF views, thumbnails, previews).
 *   - The list panel can be dragged by its header grip (the same 2x3 dot grip as the AutoPack
 *     Results panel) so it never has to cover content. The position is a per-session view
 *     convenience: it is not saved with the Load Plan and never touches cargo or camera.
 *   - A background thumbnail capture is a read-only pixel readback, not an edit. It does not make
 *     measurements read-only and never cancels an unfinished measurement. AutoPack, Unpack, Truck
 *     Change and AutoPack/Truck Change previews do, and the message names the real cause.
 * @module editor/measurement-tool
 */

import {
  MAX_MEASUREMENTS_PER_PACK,
  MEASUREMENT_STATUS,
  MEASUREMENT_TYPE_POINT_TO_POINT,
  MEASUREMENT_TYPE_UNREADABLE,
  buildCargoAnchor,
  buildFloorAnchor,
  buildSpaceAnchor,
  cargoAnchorLocal,
  defaultMeasurementName,
  describeMeasurementReason,
  formatMeasurementLength,
  measureBetween,
  measurementStatusLabel,
  resolveAnchor,
} from '../core/measurements.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// A real mouse or trackpad click jitters a few pixels; anything larger is an orbit/pan drag.
const CLICK_DRAG_THRESHOLD_PX = 6;
const HOVER_PICK_INTERVAL_MS = 40;
const MIN_SEGMENT_INCHES = 0.05;
const MIN_MOVE_INCHES = 0.05;
const STATUS_VISIBLE_MS = 2600;
const NOTICE_INTERVAL_MS = 1400;
const GROUND_MAX_DISTANCE_WORLD = 800;
const INCH_TO_WORLD_FALLBACK = 0.05;
const LABEL_MARGIN_PX = 12;
// Dimension-line geometry, in screen pixels. The hit radii are invisible and deliberately larger
// than the drawn grips, so a precise drag is easy without making the grips look heavy.
const TICK_HALF_PX = 5;
const GRIP_HALF_PX = 8;
const MARKER_ARM_PX = 5;
const GRIP_HIT_RADIUS_PX = 16;
const LINE_HIT_PX = 6;
// Near an endpoint a click places a point instead of selecting, so a new measurement can start from
// the corner of an existing one (length, then width from the same corner).
const ENDPOINT_CLICK_ZONE_PX = 14;
// The list panel drags like the AutoPack Results panel: 5px threshold, kept 10px inside its host.
const PANEL_MARGIN_PX = 10;
const PANEL_DRAG_THRESHOLD_PX = 5;
// Operations that only read pixels back never block or cancel measurement editing.
const PASSIVE_OPERATION_KINDS = new Set(['capturingPreview']);
const BLOCKED_CAUSE_TEXT = Object.freeze({
  preview: 'an AutoPack preview is shown',
  autopacking: 'AutoPack is running',
  unpacking: 'Unpack is running',
  changingTruck: 'the truck is being changed',
  previewingTruckChange: 'a truck change preview is open',
});

export function createMeasurementTool({
  SceneManager,
  CaseScene,
  CaseLibrary,
  PackLibrary,
  StateStore,
  PreferencesManager,
  UIComponents,
  OperationLifecycle = null,
  doc = typeof document !== 'undefined' ? document : null,
}) {
  // ==========================================================================
  // SECTION: STATE
  // ==========================================================================
  let els = { button: null, panel: null, labels: null, viewport: null };
  let bound = false;
  let active = false;
  let pending = null; // { anchor, world: THREE.Vector3 } — Point A of a measurement being created
  let selectedId = null; // the completed measurement that shows grips
  let drag = null; // { id, which, pointerId, candidate, dirty } — an endpoint being repositioned
  let hover = null; // latest surface pick under the pointer
  let hoverGrip = null; // 'start' | 'end' when the pointer is over the selected measurement's grip
  let hoverMeasurementId = null;
  let press = null; // { x, y } of a primary press that began on the canvas while active
  let keyboardModality = false; // keyboard (not pointer) was the last input while active: decides the viewport's focus ring on Escape
  let lastClient = null;
  let hoverDirty = false;
  let lastHoverPickAt = 0;
  let lastNoticeAt = 0;
  let lastCursor = '';
  let rafId = null;
  let records = [];
  let results = [];
  let lengthUnit = 'in';
  let statusMessage = '';
  let statusTimer = null;
  let renamingId = null;
  let lastBlockedReason = null;
  let panelCollapsed = false;
  let panelParts = null;
  let panelPosition = null; // { x, y } the user dragged the panel to, relative to its host; null = default spot
  let panelObserver = null;
  let suppressToggleClick = false;
  let svg = null;
  const rows = new Map(); // measurement id -> { el, select, name, value, rename, remove, issue, input }
  const visuals = new Map(); // measurement id -> segment visual
  const overlayOrigin = { left: 0, top: 0 };
  let previewVisual = null;
  let ghostVisual = null;
  let hoverMarker = null;
  let pendingMarker = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const scratchC = new THREE.Vector3();
  const scratchD = new THREE.Vector3();
  const viewA = new THREE.Vector3();
  const viewB = new THREE.Vector3();

  // ==========================================================================
  // SECTION: SMALL HELPERS
  // ==========================================================================
  const toWorldScale = () => (typeof SceneManager.toWorld === 'function' ? SceneManager.toWorld(1) : INCH_TO_WORLD_FALLBACK);
  const inEditor = () => StateStore.get('currentScreen') === 'editor';
  const currentPack = () => PackLibrary.getById(StateStore.get('currentPackId'));
  const getCanvas = () => {
    const renderer = SceneManager.getRenderer && SceneManager.getRenderer();
    return renderer ? renderer.domElement : null;
  };
  // The positioned ancestor the panel's left/top are measured from.
  const panelHost = () => (els.panel ? (els.panel.offsetParent || els.panel.parentElement) : null);

  /**
   * Why measurements cannot be created, moved, renamed or deleted right now, or null. A transient
   * Results/Truck Change preview is named first; then the running operation. A passive thumbnail
   * capture is neither: it only reads pixels, and a measurement write simply makes it retry.
   */
  function blockedReason() {
    if (CaseScene.isTransientPreview && CaseScene.isTransientPreview()) return 'preview';
    if (!OperationLifecycle || !OperationLifecycle.isBusy()) return null;
    const operation = typeof OperationLifecycle.currentOperation === 'function' ? OperationLifecycle.currentOperation() : null;
    const kind = operation && operation.kind ? operation.kind : 'busy';
    return PASSIVE_OPERATION_KINDS.has(kind) ? null : kind;
  }

  function blockedMessage(reason) {
    return `Measurements are read-only while ${BLOCKED_CAUSE_TEXT[reason] || 'an operation is running'}.`;
  }

  function inchesToWorldVector(point, target) {
    const scale = toWorldScale();
    return target.set(point.x * scale, point.y * scale, point.z * scale);
  }

  function worldVectorToInches(vector) {
    const scale = toWorldScale();
    return { x: vector.x / scale, y: vector.y / scale, z: vector.z / scale };
  }

  function setStatus(message, { sticky = false } = {}) {
    statusMessage = message || '';
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    if (statusMessage && !sticky) {
      statusTimer = window.setTimeout(() => {
        statusMessage = '';
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
    UIComponents.showToast(message, tone, { title: 'Measurements' });
  }

  // ==========================================================================
  // SECTION: PICKING (anything visible: cargo, truck floor, truck shell, ground)
  // ==========================================================================
  function describeCargoHit(hit, pack) {
    const instanceId = hit.object && hit.object.userData ? hit.object.userData.instanceId : null;
    const instance = instanceId ? (pack.cases || []).find(inst => inst && inst.id === instanceId) : null;
    if (!instance) return null;
    const caseData = CaseLibrary.getById(instance.caseId);
    hit.object.updateWorldMatrix(true, false);
    const local = worldVectorToInches(hit.object.worldToLocal(hit.point.clone()));
    // Any shape: the picked point is the real surface hit on the cargo's own mesh, stored in the
    // cargo's frame so it follows the cargo. If the Case definition is missing there is nothing to
    // anchor to, so keep the point fixed in space.
    const anchor = buildCargoAnchor({ instanceId, local, caseData }) ||
      buildSpaceAnchor({ surface: 'free', point: worldVectorToInches(hit.point) });
    if (!anchor) return null;
    return { kind: anchor.kind, anchor, world: hit.point.clone(), distance: hit.distance };
  }

  // Ray / axis-aligned box entry distance (slab method) in world units, or null.
  function rayBoxEntry(ray, min, max) {
    let tMin = 0;
    let tMax = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      const origin = ray.origin[axis];
      const direction = ray.direction[axis];
      if (Math.abs(direction) < 1e-9) {
        if (origin < min[axis] || origin > max[axis]) return null;
        continue;
      }
      let t1 = (min[axis] - origin) / direction;
      let t2 = (max[axis] - origin) / direction;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
    return tMin;
  }

  function pickFloor(ray, pack) {
    const floors = PackLibrary.getMeasurementFloors(pack);
    if (!floors.length || ray.direction.y >= -1e-6) return null;
    const scale = toWorldScale();
    // Solid bodies under raised floors (Wheel Wells, the over-cab deck) occlude floor behind them.
    const bodies = floors.filter(floor => floor.elevation > 0.01).map(floor => ({
      min: { x: floor.xMin * scale, y: 0, z: floor.zMin * scale },
      max: { x: floor.xMax * scale, y: floor.elevation * scale, z: floor.zMax * scale },
    }));
    let best = null;
    floors.forEach(floor => {
      const elevation = floor.elevation * scale;
      const t = (elevation - ray.origin.y) / ray.direction.y;
      if (!(t > 0)) return;
      const x = (ray.origin.x + ray.direction.x * t) / scale;
      const z = (ray.origin.z + ray.direction.z * t) / scale;
      if (x < floor.xMin || x > floor.xMax || z < floor.zMin || z > floor.zMax) return;
      if (best && best.distance <= t) return;
      const blocked = bodies.some(body => {
        const entry = rayBoxEntry(ray, body.min, body.max);
        return entry !== null && entry > 0 && entry < t - 1e-3;
      });
      if (blocked) return;
      const anchor = buildFloorAnchor({ surface: floor.surface, point: { x, y: floor.elevation, z } });
      if (!anchor) return;
      best = { kind: 'floor', anchor, world: new THREE.Vector3(x * scale, elevation, z * scale), distance: t };
    });
    return best;
  }

  /**
   * Truck walls, ceiling and end planes. The shell is see-through, so the surface the user sees
   * "behind" is the far side: the point where the ray leaves the truck envelope.
   */
  function pickShell(ray, pack) {
    const shell = PackLibrary.getMeasurementShell(pack);
    if (!shell) return null;
    const scale = toWorldScale();
    const min = { x: shell.xMin * scale, y: shell.yMin * scale, z: shell.zMin * scale };
    const max = { x: shell.xMax * scale, y: shell.yMax * scale, z: shell.zMax * scale };
    let tNear = -Infinity;
    let tFar = Infinity;
    let exitAxis = null;
    let exitSign = 0;
    for (const axis of ['x', 'y', 'z']) {
      const origin = ray.origin[axis];
      const direction = ray.direction[axis];
      if (Math.abs(direction) < 1e-9) {
        if (origin < min[axis] || origin > max[axis]) return null;
        continue;
      }
      const t1 = (min[axis] - origin) / direction;
      const t2 = (max[axis] - origin) / direction;
      tNear = Math.max(tNear, Math.min(t1, t2));
      const far = Math.max(t1, t2);
      if (far < tFar) {
        tFar = far;
        exitAxis = axis;
        exitSign = direction > 0 ? 1 : -1;
      }
    }
    if (exitAxis === null || tNear > tFar || tFar <= 0) return null;
    // +X is the cab end, +Z the truck's left; the bottom face is the floor, handled by pickFloor.
    let surface = null;
    if (exitAxis === 'x') surface = exitSign > 0 ? 'wall-front' : 'wall-rear';
    else if (exitAxis === 'z') surface = exitSign > 0 ? 'wall-left' : 'wall-right';
    else if (exitSign > 0) surface = 'ceiling';
    if (!surface) return null;
    const world = new THREE.Vector3(
      ray.origin.x + ray.direction.x * tFar,
      ray.origin.y + ray.direction.y * tFar,
      ray.origin.z + ray.direction.z * tFar
    );
    const anchor = buildSpaceAnchor({ surface, point: worldVectorToInches(world), truck: pack.truck });
    return anchor ? { kind: 'space', anchor, world, distance: tFar } : null;
  }

  /** The ground plane anywhere, including outside the truck (staging area, yard). Never the sky. */
  function pickGround(ray) {
    if (ray.direction.y >= -1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (!(t > 0) || t > GROUND_MAX_DISTANCE_WORLD) return null;
    const world = new THREE.Vector3(ray.origin.x + ray.direction.x * t, 0, ray.origin.z + ray.direction.z * t);
    const anchor = buildSpaceAnchor({ surface: 'ground', point: worldVectorToInches(world) });
    return anchor ? { kind: 'space', anchor, world, distance: t } : null;
  }

  function pick(clientX, clientY) {
    const camera = SceneManager.getCamera();
    const canvas = getCanvas();
    const pack = currentPack();
    if (!camera || !canvas || !pack) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let best = null;
    const meshes = CaseScene.getRaycastMeshes().filter(mesh => mesh.parent && mesh.parent.visible !== false);
    const cargoHit = meshes.length ? raycaster.intersectObjects(meshes, false)[0] : null;
    if (cargoHit) best = describeCargoHit(cargoHit, pack);
    const floorHit = pickFloor(raycaster.ray, pack);
    if (floorHit && (!best || floorHit.distance < best.distance)) best = floorHit;
    // Cargo and floor win; then the see-through truck shell; then the ground anywhere.
    return best || pickShell(raycaster.ray, pack) || pickGround(raycaster.ray);
  }

  // ==========================================================================
  // SECTION: LIVE ENDPOINTS (follow the scene's displayed pose, never persisted)
  // ==========================================================================
  /**
   * World position of an anchor as the scene currently displays it. Cargo anchors follow the live
   * group transform (so they track drags, nudges, animation and AutoPack preview); nothing here is
   * written back. Falls back to the committed resolution when the group is unavailable.
   */
  function liveAnchorWorld(anchor, committedPoint, target) {
    if (anchor.kind === 'cargo') {
      const group = CaseScene.getObject(anchor.instanceId);
      const local = group ? cargoAnchorLocal(anchor) : null;
      if (group && local) {
        inchesToWorldVector(local, target);
        group.updateMatrixWorld(true);
        return group.localToWorld(target);
      }
    }
    return committedPoint ? inchesToWorldVector(committedPoint, target) : null;
  }

  // ==========================================================================
  // SECTION: OVERLAY (restrained SVG dimension lines, DOM labels) — never part of a canvas capture
  // ==========================================================================
  function svgEl(name, className) {
    const el = doc.createElementNS(SVG_NS, name);
    if (className) el.setAttribute('class', className);
    return el;
  }

  function ensureSvg() {
    if (svg && svg.isConnected) return svg;
    if (!els.labels || !doc) return null;
    svg = svgEl('svg', 'tp3d-measure-svg');
    svg.setAttribute('aria-hidden', 'true');
    els.labels.prepend(svg);
    return svg;
  }

  /** A dimension line: thin line, short perpendicular end ticks, grips when selected, compact label. */
  function makeSegment(kind) {
    const root = ensureSvg();
    const group = svgEl('g', `tp3d-measure-svg__segment is-${kind}`);
    const underLine = svgEl('path', 'tp3d-measure-svg__under tp3d-measure-svg__under--line');
    const underTicks = svgEl('path', 'tp3d-measure-svg__under');
    const line = svgEl('path', 'tp3d-measure-svg__line');
    const ticks = svgEl('path', 'tp3d-measure-svg__ticks');
    const grips = svgEl('path', 'tp3d-measure-svg__grips');
    group.append(underLine, underTicks, line, ticks, grips);
    group.style.display = 'none';
    root.appendChild(group);
    let label = null;
    if (kind !== 'ghost') {
      label = doc.createElement('div');
      label.className = `tp3d-measure-label${kind === 'preview' ? ' tp3d-measure-label--preview' : ''}`;
      label.hidden = true;
      els.labels.appendChild(label);
    }
    return { kind, group, underLine, underTicks, line, ticks, grips, label, selected: false, gripHover: false, d: {}, screen: null };
  }

  function disposeSegment(visual) {
    if (!visual) return;
    if (visual.group && visual.group.parentNode) visual.group.parentNode.removeChild(visual.group);
    if (visual.label && visual.label.parentNode) visual.label.parentNode.removeChild(visual.label);
  }

  /** A small "+" showing where a click would land (neutral) or where Point A sits (accent). */
  function makeMarker(kind) {
    const root = ensureSvg();
    const group = svgEl('g', `tp3d-measure-svg__marker is-${kind}`);
    const under = svgEl('path', 'tp3d-measure-svg__under');
    const mark = svgEl('path', 'tp3d-measure-svg__mark');
    group.append(under, mark);
    group.style.display = 'none';
    root.appendChild(group);
    return { group, under, mark, key: '' };
  }

  function setMarker(marker, point) {
    if (!point) {
      if (marker.group.style.display !== 'none') marker.group.style.display = 'none';
      return;
    }
    const arm = MARKER_ARM_PX;
    const x = point.x.toFixed(1);
    const y = point.y.toFixed(1);
    const key = `${x},${y}`;
    marker.group.style.display = '';
    if (marker.key === key) return;
    marker.key = key;
    const d = `M${(point.x - arm).toFixed(1)} ${y}L${(point.x + arm).toFixed(1)} ${y}M${x} ${(point.y - arm).toFixed(1)}L${x} ${(point.y + arm).toFixed(1)}`;
    marker.under.setAttribute('d', d);
    marker.mark.setAttribute('d', d);
  }

  function disposeMarker(marker) {
    if (marker && marker.group.parentNode) marker.group.parentNode.removeChild(marker.group);
  }

  function setPath(visual, name, d) {
    if (visual.d[name] === d) return;
    visual.d[name] = d;
    visual[name].setAttribute('d', d);
  }

  /**
   * Project a world segment to screen pixels. A segment with one end behind a perspective camera is
   * clipped at the near plane so it never flips; fully-behind segments return null.
   */
  function projectSegment(a, b, camera, width, height) {
    viewA.copy(a).applyMatrix4(camera.matrixWorldInverse);
    viewB.copy(b).applyMatrix4(camera.matrixWorldInverse);
    const perspective = camera.isPerspectiveCamera;
    const limit = perspective ? -(camera.near + 0.001) : Infinity;
    const aIn = !perspective || viewA.z <= limit;
    const bIn = !perspective || viewB.z <= limit;
    if (!aIn && !bIn) return null;
    if (!aIn || !bIn) {
      // Move the end that is behind the camera onto the near plane along the segment.
      const behind = aIn ? viewB : viewA;
      const front = aIn ? viewA : viewB;
      const t = (limit - front.z) / (behind.z - front.z);
      behind.set(front.x + (behind.x - front.x) * t, front.y + (behind.y - front.y) * t, limit);
    }
    const toPx = view => {
      view.applyMatrix4(camera.projectionMatrix);
      return { x: (view.x * 0.5 + 0.5) * width, y: (-view.y * 0.5 + 0.5) * height };
    };
    return { p1: toPx(viewA), p2: toPx(viewB), aVisible: aIn, bVisible: bIn };
  }

  function projectPoint(point, camera, width, height) {
    const projected = projectSegment(point, point, camera, width, height);
    return projected && projected.aVisible ? projected.p1 : null;
  }

  const fixed = value => value.toFixed(1);

  /** Segment plus perpendicular end ticks (and longer grips) in screen pixels. */
  function buildPaths(projected) {
    const { p1, p2, aVisible, bVisible } = projected;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const nx = length > 0.01 ? -dy / length : 0;
    const ny = length > 0.01 ? dx / length : 1;
    const tick = (point, half) => `M${fixed(point.x - nx * half)} ${fixed(point.y - ny * half)}L${fixed(point.x + nx * half)} ${fixed(point.y + ny * half)}`;
    return {
      line: `M${fixed(p1.x)} ${fixed(p1.y)}L${fixed(p2.x)} ${fixed(p2.y)}`,
      ticks: `${aVisible ? tick(p1, TICK_HALF_PX) : ''}${bVisible ? tick(p2, TICK_HALF_PX) : ''}`,
      grips: `${aVisible ? tick(p1, GRIP_HALF_PX) : ''}${bVisible ? tick(p2, GRIP_HALF_PX) : ''}`,
    };
  }

  function placeLabel(visual, text, projected, width, height, selected) {
    const label = visual.label;
    if (!label) return null;
    const minX = Math.min(projected.p1.x, projected.p2.x);
    const maxX = Math.max(projected.p1.x, projected.p2.x);
    const minY = Math.min(projected.p1.y, projected.p2.y);
    const maxY = Math.max(projected.p1.y, projected.p2.y);
    if (maxX < 0 || minX > width || maxY < 0 || minY > height) {
      label.hidden = true;
      return null;
    }
    label.hidden = false;
    if (label.textContent !== text) label.textContent = text;
    label.classList.toggle('is-selected', Boolean(selected));
    const x = Math.min(width - LABEL_MARGIN_PX, Math.max(LABEL_MARGIN_PX, (projected.p1.x + projected.p2.x) / 2));
    const y = Math.min(height - LABEL_MARGIN_PX, Math.max(LABEL_MARGIN_PX, (projected.p1.y + projected.p2.y) / 2));
    const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    if (label.style.transform !== transform) label.style.transform = transform;
    // Estimated box for hit-testing (no layout reads in the frame loop).
    return { x, y, w: Math.round(text.length * 6.4 + 14), h: 18 };
  }

  function hideSegment(visual) {
    if (visual.group.style.display !== 'none') visual.group.style.display = 'none';
    if (visual.label) visual.label.hidden = true;
    visual.screen = null;
  }

  function drawSegment(visual, a, b, text, camera, width, height, { selected = false, grips = false } = {}) {
    const projected = projectSegment(a, b, camera, width, height);
    if (!projected) {
      hideSegment(visual);
      return;
    }
    visual.group.style.display = '';
    const paths = buildPaths(projected);
    setPath(visual, 'underLine', paths.line);
    setPath(visual, 'line', paths.line);
    setPath(visual, 'underTicks', paths.ticks);
    setPath(visual, 'ticks', paths.ticks);
    setPath(visual, 'grips', grips ? paths.grips : '');
    if (visual.selected !== selected) {
      visual.selected = selected;
      visual.group.classList.toggle('is-selected', selected);
      // Paint the selected measurement above the others.
      if (selected && visual.group.parentNode) visual.group.parentNode.appendChild(visual.group);
    }
    const gripHover = grips && Boolean(hoverGrip || drag);
    if (visual.gripHover !== gripHover) {
      visual.gripHover = gripHover;
      visual.group.classList.toggle('is-grip-hover', gripHover);
    }
    const labelBox = placeLabel(visual, text, projected, width, height, selected);
    visual.screen = { p1: projected.p1, p2: projected.p2, aVisible: projected.aVisible, bVisible: projected.bVisible, labelBox };
  }

  /** The scene label is one compact distance; a user-given name is added only while it is selected. */
  function labelText(record, distanceInches, selected = false) {
    const value = formatMeasurementLength(distanceInches, lengthUnit);
    return selected && record && record.label ? `${record.label} · ${value}` : value;
  }

  function updateOverlay() {
    const camera = SceneManager.getCamera();
    if (!camera || !active || !ensureSvg()) return;
    const rect = els.labels.getBoundingClientRect();
    overlayOrigin.left = rect.left;
    overlayOrigin.top = rect.top;
    const width = rect.width > 0 ? rect.width : 1;
    const height = rect.height > 0 ? rect.height : 1;

    // Saved measurements: only Valid ones are drawn. Needs Review and Unresolved never get geometry.
    const live = new Set();
    const readOnly = Boolean(blockedReason());
    let ghostDrawn = false;
    results.forEach((result, index) => {
      const record = records[index];
      if (!record || record.type !== MEASUREMENT_TYPE_POINT_TO_POINT || result.status !== MEASUREMENT_STATUS.VALID) return;
      live.add(record.id);
      let visual = visuals.get(record.id);
      if (!visual) {
        visual = makeSegment('saved');
        visuals.set(record.id, visual);
      }
      const a = liveAnchorWorld(record.start, result.start, scratchA);
      const b = liveAnchorWorld(record.end, result.end, scratchB);
      if (!a || !b) {
        hideSegment(visual);
        return;
      }
      const dragging = drag && drag.id === record.id;
      if (dragging) {
        // Subtle ghost of where the endpoint was, then the live preview with the new distance.
        const ghostA = liveAnchorWorld(record.start, result.start, scratchC);
        const ghostB = liveAnchorWorld(record.end, result.end, scratchD);
        if (ghostA && ghostB) {
          if (!ghostVisual) ghostVisual = makeSegment('ghost');
          drawSegment(ghostVisual, ghostA, ghostB, '', camera, width, height);
          ghostDrawn = true;
        }
        if (drag.candidate) (drag.which === 'start' ? a : b).copy(drag.candidate.world);
      }
      const inches = measureBetween(worldVectorToInches(a), worldVectorToInches(b)).distance;
      const selected = record.id === selectedId || dragging;
      drawSegment(visual, a, b, labelText(record, inches, selected), camera, width, height, { selected, grips: selected && !readOnly });
    });
    visuals.forEach((visual, id) => {
      if (live.has(id)) return;
      disposeSegment(visual);
      visuals.delete(id);
    });
    if (ghostVisual && !ghostDrawn) {
      disposeSegment(ghostVisual);
      ghostVisual = null;
    }

    // Live preview from Point A to the point under the pointer.
    const pendingWorld = pending
      ? (liveAnchorWorld(pending.anchor, null, scratchA) || scratchA.copy(pending.world))
      : null;
    if (pendingWorld) {
      if (!previewVisual) previewVisual = makeSegment('preview');
      if (hover && hover.world) {
        const target = scratchB.copy(hover.world);
        const inches = measureBetween(worldVectorToInches(pendingWorld), worldVectorToInches(target)).distance;
        drawSegment(previewVisual, pendingWorld, target, formatMeasurementLength(inches, lengthUnit), camera, width, height);
        if (pendingMarker) setMarker(pendingMarker, null);
      } else {
        // Only Point A so far: a single accent marker, no line or label.
        hideSegment(previewVisual);
        if (!pendingMarker) pendingMarker = makeMarker('pending');
        setMarker(pendingMarker, projectPoint(pendingWorld, camera, width, height));
      }
    } else {
      if (previewVisual) {
        disposeSegment(previewVisual);
        previewVisual = null;
      }
      if (pendingMarker) setMarker(pendingMarker, null);
    }

    // Where a click would land: a small neutral "+", only on something measurable.
    const showHover = hover && hover.world && !drag && !hoverGrip && !hoverMeasurementId && !readOnly;
    if (showHover) {
      if (!hoverMarker) hoverMarker = makeMarker('hover');
      setMarker(hoverMarker, projectPoint(hover.world, camera, width, height));
    } else if (hoverMarker) {
      setMarker(hoverMarker, null);
    }
  }

  function disposeAllVisuals() {
    visuals.forEach(disposeSegment);
    visuals.clear();
    if (previewVisual) disposeSegment(previewVisual);
    if (ghostVisual) disposeSegment(ghostVisual);
    previewVisual = null;
    ghostVisual = null;
    disposeMarker(hoverMarker);
    disposeMarker(pendingMarker);
    hoverMarker = null;
    pendingMarker = null;
  }

  // ==========================================================================
  // SECTION: SCREEN-SPACE HIT TESTING (grips, lines, labels of the drawn overlay)
  // ==========================================================================
  const toLayerPoint = client => ({ x: client.x - overlayOrigin.left, y: client.y - overlayOrigin.top });

  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /** Which endpoint grip of the selected measurement is under the pointer, or null. */
  function gripAt(client) {
    if (!selectedId || drag || blockedReason()) return null;
    const visual = visuals.get(selectedId);
    const screen = visual && visual.screen;
    if (!screen) return null;
    const p = toLayerPoint(client);
    const da = screen.aVisible ? Math.hypot(p.x - screen.p1.x, p.y - screen.p1.y) : Infinity;
    const db = screen.bVisible ? Math.hypot(p.x - screen.p2.x, p.y - screen.p2.y) : Infinity;
    if (Math.min(da, db) > GRIP_HIT_RADIUS_PX) return null;
    return da <= db ? 'start' : 'end';
  }

  /** The drawn measurement (line body or label) under the pointer, or null. Endpoint zones never select. */
  function measurementAt(client) {
    const p = toLayerPoint(client);
    let bestId = null;
    let bestDistance = LINE_HIT_PX;
    visuals.forEach((visual, id) => {
      const screen = visual.screen;
      if (!screen) return;
      let distance = distanceToSegment(p, screen.p1, screen.p2);
      const nearEnd = Math.min(Math.hypot(p.x - screen.p1.x, p.y - screen.p1.y), Math.hypot(p.x - screen.p2.x, p.y - screen.p2.y)) < ENDPOINT_CLICK_ZONE_PX;
      if (nearEnd) distance = Infinity;
      const box = screen.labelBox;
      if (box && Math.abs(p.x - box.x) <= box.w / 2 && Math.abs(p.y - box.y) <= box.h / 2) distance = 0;
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    });
    return bestId;
  }

  // ==========================================================================
  // SECTION: FRAME LOOP (runs only while Measurement Mode is active)
  // ==========================================================================
  function updateCursor() {
    const canvas = getCanvas();
    if (!canvas) return;
    let cursor = 'default';
    if (active) {
      if (drag) cursor = 'grabbing';
      else if (hoverGrip) cursor = 'grab';
      else if (hoverMeasurementId) cursor = 'pointer';
      else if (hover) cursor = 'crosshair';
    }
    if (cursor === lastCursor) return;
    lastCursor = cursor;
    canvas.style.cursor = cursor;
  }

  /**
   * React to a change in what (if anything) makes measurements read-only. A genuinely blocking
   * operation cancels an unfinished Point A or endpoint drag; a passive capture never does.
   */
  function syncBlocked() {
    const reason = blockedReason();
    if (reason === lastBlockedReason) return reason;
    lastBlockedReason = reason;
    if (reason) {
      if (drag) cancelDrag(blockedMessage(reason));
      if (pending) cancelPending(blockedMessage(reason));
    }
    renderPanel();
    return reason;
  }

  function frame(now) {
    if (!active) return;
    const reason = syncBlocked();
    if (drag) {
      if (drag.dirty && lastClient) {
        drag.dirty = false;
        drag.candidate = reason ? null : pick(lastClient.x, lastClient.y);
      }
    } else if (hoverDirty && lastClient && now - lastHoverPickAt >= HOVER_PICK_INTERVAL_MS) {
      hoverDirty = false;
      lastHoverPickAt = now;
      hoverGrip = gripAt(lastClient);
      hoverMeasurementId = hoverGrip || pending ? null : measurementAt(lastClient);
      hover = reason || hoverGrip || hoverMeasurementId ? null : pick(lastClient.x, lastClient.y);
    }
    updateOverlay();
    updateCursor();
  }

  function loop(now) {
    rafId = null;
    if (!active) return;
    frame(now);
    rafId = window.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId === null) rafId = window.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ==========================================================================
  // SECTION: MODE + PENDING POINT
  // ==========================================================================
  function cancelPending(message = '') {
    const had = Boolean(pending);
    pending = null;
    hoverDirty = true;
    if (had && message) setStatus(message);
    else if (had) renderPanel();
  }

  function enter() {
    if (active || !inEditor() || !currentPack() || !SceneManager.getScene() || !getCanvas()) return false;
    active = true;
    pending = null;
    drag = null;
    selectedId = null;
    hover = null;
    hoverGrip = null;
    hoverMeasurementId = null;
    press = null;
    // A mouse click on the ruler leaves it unmarked; activating it from the keyboard leaves it focus-visible.
    const entryFocus = doc ? doc.activeElement : null;
    keyboardModality = Boolean(entryFocus && typeof entryFocus.matches === 'function' && entryFocus.matches(':focus-visible'));
    lastBlockedReason = blockedReason();
    CaseScene.setHover(null);
    if (els.button) els.button.setAttribute('aria-pressed', 'true');
    ensureSvg();
    if (doc) {
      doc.addEventListener('keydown', onKeyDownCapture, true);
      doc.addEventListener('pointerdown', onPointerDownCapture, true);
    }
    sync();
    if (els.panel) els.panel.hidden = false;
    renderPanel();
    // Keep a dragged panel inside the viewport when the viewport itself resizes (window, side panels).
    const host = panelHost();
    if (host && typeof ResizeObserver === 'function') {
      panelObserver = new ResizeObserver(() => applyPanelPosition());
      panelObserver.observe(host);
    }
    updateCursor();
    startLoop();
    const unreadable = records.filter(record => record.type === MEASUREMENT_TYPE_UNREADABLE).length;
    if (unreadable) {
      UIComponents.showToast(
        `${unreadable === 1 ? 'A saved measurement' : `${unreadable} saved measurements`} couldn't be read. The original data is kept.`,
        'warning', { title: 'Measurements' }
      );
    }
    return true;
  }

  function exit() {
    const wasActive = active;
    endDrag();
    active = false;
    pending = null;
    selectedId = null;
    hover = null;
    hoverGrip = null;
    hoverMeasurementId = null;
    press = null;
    renamingId = null;
    stopLoop();
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    statusMessage = '';
    if (doc) {
      doc.removeEventListener('keydown', onKeyDownCapture, true);
      doc.removeEventListener('pointerdown', onPointerDownCapture, true);
    }
    if (els.button) els.button.setAttribute('aria-pressed', 'false');
    if (els.panel) els.panel.hidden = true;
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    rows.forEach(row => row.el.remove());
    rows.clear();
    disposeAllVisuals();
    if (wasActive) updateCursor();
    return wasActive;
  }

  function toggle() {
    if (active) {
      exit();
      return false;
    }
    return enter();
  }

  // ==========================================================================
  // SECTION: POINTER OWNERSHIP (called by the Editor's pointer handlers while active)
  // ==========================================================================
  function onPointerDown(ev) {
    if (!active || ev.button !== 0) return;
    press = { x: ev.clientX, y: ev.clientY };
    lastClient = { x: ev.clientX, y: ev.clientY };
  }

  function onPointerMove(ev) {
    if (!active) return;
    lastClient = { x: ev.clientX, y: ev.clientY };
    hoverDirty = true;
  }

  function onPointerCancel() {
    press = null;
  }

  function onPointerUp(ev) {
    if (!active || !press) return;
    const moved = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
    press = null;
    if (ev.button !== 0 || moved > CLICK_DRAG_THRESHOLD_PX) return; // an orbit/pan drag, not a click
    handleClick(ev.clientX, ev.clientY);
  }

  /** Double-click must neither place a zero-length measurement nor focus the camera on cargo. */
  function onDoubleClick(ev) {
    if (!active) return false;
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    return true;
  }

  /** A click on a drawn measurement selects it; anywhere else places a point. */
  function handleClick(clientX, clientY) {
    if (!pending) {
      const id = measurementAt({ x: clientX, y: clientY });
      if (id) {
        selectMeasurement(id);
        return;
      }
    }
    placePoint(clientX, clientY);
  }

  function placePoint(clientX, clientY) {
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    if (!pack) return;
    if (!pending && PackLibrary.getMeasurements(pack).length >= MAX_MEASUREMENTS_PER_PACK) {
      notice(`Limit of ${MAX_MEASUREMENTS_PER_PACK} measurements reached. Delete one to add another.`, 'warning');
      return;
    }
    const picked = pick(clientX, clientY);
    hover = picked;
    if (!picked) {
      notice('Nothing to measure there. Click cargo, the truck or the ground.');
      return;
    }
    if (!pending) {
      pending = { anchor: picked.anchor, world: picked.world.clone() };
      selectedId = null;
      setStatus('', { sticky: true });
      return;
    }
    const start = liveAnchorWorld(pending.anchor, null, scratchA) || scratchA.copy(pending.world);
    const segment = measureBetween(worldVectorToInches(start), worldVectorToInches(picked.world));
    if (segment.distance < MIN_SEGMENT_INCHES) {
      setStatus('Pick a different second point.');
      return;
    }
    const outcome = PackLibrary.addMeasurement(pack.id, { start: pending.anchor, end: picked.anchor });
    // The measurement is finished either way: release the gesture and be ready for the next Point A.
    pending = null;
    press = null;
    hover = null;
    hoverDirty = true;
    if (!outcome.ok) {
      UIComponents.showToast(outcome.reason === 'limit'
        ? `Measurement limit reached (${MAX_MEASUREMENTS_PER_PACK}).`
        : 'Could not save this measurement.', 'error', { title: 'Measurements' });
      renderPanel();
      return;
    }
    selectedId = outcome.measurement.id;
    setStatus('Measurement saved.');
  }

  // ==========================================================================
  // SECTION: SELECTION + ENDPOINT REPOSITIONING
  // ==========================================================================
  function selectMeasurement(id) {
    selectedId = id && records.some(record => record.id === id) ? id : null;
    hoverGrip = null;
    renderPanel();
  }

  /** Claim a press on the selected measurement's grip before OrbitControls or the Editor sees it. */
  function onPointerDownCapture(ev) {
    if (active) keyboardModality = false;
    if (!active || ev.button !== 0 || drag || pending) return;
    const canvas = getCanvas();
    if (!canvas || ev.target !== canvas) return;
    const which = gripAt({ x: ev.clientX, y: ev.clientY });
    if (!which) return;
    ev.stopPropagation();
    ev.preventDefault();
    beginDrag(which, ev);
  }

  function beginDrag(which, ev) {
    const record = records.find(item => item.id === selectedId);
    if (!record) return;
    drag = { id: record.id, which, pointerId: ev.pointerId, candidate: null, dirty: false, startX: ev.clientX, startY: ev.clientY };
    lastClient = { x: ev.clientX, y: ev.clientY };
    press = null;
    const canvas = getCanvas();
    try {
      if (canvas && typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(ev.pointerId);
    } catch (_) {
      // Capture is a convenience; the window listeners below still end the drag.
    }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragCancel);
    updateCursor();
    // Grabbing a grip replaces any stale "saved/updated" message with the drag guidance.
    setStatus('', { sticky: true });
  }

  function onDragMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    lastClient = { x: ev.clientX, y: ev.clientY };
    drag.dirty = true;
  }

  function onDragUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const finished = drag;
    lastClient = { x: ev.clientX, y: ev.clientY };
    const travelled = Math.hypot(ev.clientX - finished.startX, ev.clientY - finished.startY);
    endDrag();
    hoverDirty = true;
    // A press on a grip that never moved is an ordinary click: it places a point, so a new
    // measurement can begin at the corner of the selected one.
    if (travelled <= CLICK_DRAG_THRESHOLD_PX) {
      placePoint(ev.clientX, ev.clientY);
      return;
    }
    // The release position decides: resolve it freshly instead of trusting the last frame's pick.
    commitMove(finished, blockedReason() ? null : pick(ev.clientX, ev.clientY));
  }

  function onDragCancel(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    cancelDrag('Move cancelled.');
  }

  /** Stop the gesture and release pointer ownership. Writes nothing. */
  function endDrag() {
    if (!drag) return;
    const canvas = getCanvas();
    try {
      if (canvas && typeof canvas.releasePointerCapture === 'function' && canvas.hasPointerCapture(drag.pointerId)) {
        canvas.releasePointerCapture(drag.pointerId);
      }
    } catch (_) {
      // Already released.
    }
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragCancel);
    drag = null;
    updateCursor();
  }

  /** Abandon the drag; the endpoint is simply never changed, so there is nothing to restore. */
  function cancelDrag(message = '') {
    if (!drag) return;
    endDrag();
    hoverDirty = true;
    if (message) setStatus(message);
    else renderPanel();
  }

  /** Persist a finished drag as one measurement-only edit, or leave the measurement untouched. */
  function commitMove(finished, picked) {
    const pack = currentPack();
    const index = records.findIndex(item => item.id === finished.id);
    const record = records[index];
    const result = results[index];
    if (!pack || !record || !result || result.status !== MEASUREMENT_STATUS.VALID) {
      setStatus('The measurement changed, so the move was cancelled.');
      return;
    }
    const reason = blockedReason();
    if (reason) {
      notice(blockedMessage(reason));
      return;
    }
    if (!picked) {
      notice('Nothing to measure there. The point was left where it was.');
      return;
    }
    const moving = finished.which === 'start' ? result.start : result.end;
    const fixedEnd = finished.which === 'start' ? result.end : result.start;
    const target = worldVectorToInches(picked.world);
    if (measureBetween(moving, target).distance < MIN_MOVE_INCHES) return; // released where it started
    if (measureBetween(fixedEnd, target).distance < MIN_SEGMENT_INCHES) {
      setStatus('Pick a different point.');
      return;
    }
    const outcome = PackLibrary.moveMeasurementEndpoint(pack.id, record.id, finished.which, picked.anchor);
    if (!outcome.ok) {
      UIComponents.showToast('Could not move this point.', 'error', { title: 'Measurements' });
      return;
    }
    setStatus('Measurement updated.');
  }

  // ==========================================================================
  // SECTION: KEYBOARD OWNERSHIP (capture phase, only while active)
  // ==========================================================================
  function isTypingTarget(target) {
    if (!target || !target.matches) return false;
    if (target.isContentEditable) return true;
    return target.matches('input, textarea, select');
  }

  /**
   * One Escape leaves the mode. An unfinished Point A or endpoint drag is dropped first (nothing is
   * written) by the regular exit routine; saved measurements stay. The event is consumed so cargo
   * deselection, the mobile drawers and the other Escape handlers never see it. Focus is never sent
   * to the ruler: if it sat in the panel that is about to hide, or on the ruler itself, it returns to
   * the 3D viewport so cargo shortcuts keep working. The viewport shows its focus ring only when the
   * keyboard was the input in use; after mouse use the Escape press itself must not paint a frame
   * around the whole 3D view (the browser would, because the last event was a key press).
   */
  function exitFromEscape(ev) {
    const focused = doc ? doc.activeElement : null;
    const needsFocus = !focused || focused === doc.body || focused === els.button ||
      Boolean(els.panel && els.panel.contains(focused));
    ev.preventDefault();
    ev.stopPropagation();
    exit();
    const viewport = els.viewport;
    if (needsFocus && viewport && typeof viewport.focus === 'function') {
      if (!keyboardModality && viewport.classList) {
        // The viewport's own pointer-focus marker (see #viewport:focus-visible in main.css), dropped on blur.
        viewport.classList.add('tp3d-pointer-focus');
        viewport.addEventListener('focusout', () => viewport.classList.remove('tp3d-pointer-focus'), { once: true });
      }
      viewport.focus({ preventScroll: true });
    }
  }

  function onKeyDownCapture(ev) {
    if (!active) return;
    if (ev.key !== 'Escape' && !['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) keyboardModality = true;
    if (ev.defaultPrevented) return;
    if (UIComponents.modalOwnership && UIComponents.modalOwnership.blocksKeyboardEvent(ev)) return;
    if (!inEditor() || isTypingTarget(ev.target)) return;
    const key = String(ev.key || '').toLowerCase();
    if (key === 'escape') {
      // A popover that owns Escape (the load-status popover) closes first; the next Escape exits.
      if (typeof els.escapeOwnedElsewhere === 'function' && els.escapeOwnedElsewhere()) return;
      exitFromEscape(ev);
      return;
    }
    // Undo / Redo mid-gesture cancels only that gesture; cargo history is untouched.
    if (key === 'z' && (ev.metaKey || ev.ctrlKey) && !ev.altKey && (drag || pending)) {
      if (drag) {
        cancelDrag('Move cancelled.');
      } else {
        cancelPending('Measurement cancelled.');
      }
      ev.preventDefault();
    }
  }

  // ==========================================================================
  // SECTION: PANEL POSITION (drag by the header grip, like the AutoPack Results panel)
  // ==========================================================================
  /** Keep the whole panel inside its host, whatever its current (expanded or collapsed) size. */
  function clampPanelPosition(position) {
    const host = panelHost();
    const panel = els.panel;
    if (!host || !panel || !position) return null;
    // left/top are measured inside the host's border, so size against its inner (client) box.
    const maxX = Math.max(PANEL_MARGIN_PX, host.clientWidth - panel.offsetWidth - PANEL_MARGIN_PX);
    const maxY = Math.max(PANEL_MARGIN_PX, host.clientHeight - panel.offsetHeight - PANEL_MARGIN_PX);
    return {
      x: Math.min(Math.max(Number(position.x) || 0, PANEL_MARGIN_PX), maxX),
      y: Math.min(Math.max(Number(position.y) || 0, PANEL_MARGIN_PX), maxY),
    };
  }

  /**
   * Place the panel at the dragged position (clamped to what fits right now) or at its default
   * spot. The preferred position is kept as dragged, so a panel pushed in by a small window or by
   * expanding returns toward it when there is room again.
   */
  function applyPanelPosition() {
    const panel = els.panel;
    if (!panel || panel.hidden) return;
    if (!panelPosition) {
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
      if (ev.button !== 0 || !els.panel) return;
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

  // ==========================================================================
  // SECTION: PANEL (compact, collapsible list; updated in place so a click is never lost)
  // ==========================================================================
  function ensurePanel() {
    if (panelParts && panelParts.root === els.panel && els.panel.contains(panelParts.head)) return panelParts;
    if (!els.panel || !doc) return null;
    const head = doc.createElement('div');
    head.className = 'tp3d-measure-panel__head';
    // 2x3 dot-grid grip, identical in look to the AutoPack Results grip. Decorative: the header drags.
    const grip = doc.createElement('span');
    grip.className = 'tp3d-measure-panel__grip';
    grip.setAttribute('aria-hidden', 'true');
    for (let dot = 0; dot < 6; dot += 1) {
      const dotEl = doc.createElement('span');
      dotEl.className = 'tp3d-measure-panel__grip-dot';
      grip.appendChild(dotEl);
    }
    const toggleButton = doc.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'tp3d-measure-panel__toggle';
    toggleButton.setAttribute('aria-controls', 'editor-measure-panel-body');
    const title = doc.createElement('span');
    title.className = 'tp3d-measure-panel__title';
    title.textContent = 'Measurements';
    const count = doc.createElement('span');
    count.className = 'tp3d-measure-panel__count';
    // Far right like the AutoPack Results header: chevron up collapses, chevron down restores.
    const chevron = doc.createElement('i');
    chevron.className = 'fa-solid fa-chevron-up tp3d-measure-panel__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggleButton.append(title, count, chevron);
    toggleButton.addEventListener('click', () => {
      // A drag that began on the title must not also collapse or expand the panel.
      if (suppressToggleClick) return;
      panelCollapsed = !panelCollapsed;
      renderPanel();
    });
    head.append(grip, toggleButton);
    attachPanelDrag(head);

    const body = doc.createElement('div');
    body.className = 'tp3d-measure-panel__body';
    body.id = 'editor-measure-panel-body';
    const hint = doc.createElement('div');
    hint.className = 'tp3d-measure-panel__hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    const warning = doc.createElement('div');
    warning.className = 'tp3d-measure-panel__notice';
    warning.hidden = true;
    warning.textContent = "Some saved measurements couldn't be read. The original data is kept until you delete it.";
    const list = doc.createElement('ul');
    list.className = 'tp3d-measure-panel__list';
    body.append(hint, warning, list);

    els.panel.replaceChildren(head, body);
    rows.clear();
    panelParts = { root: els.panel, head, toggle: toggleButton, chevron, count, body, hint, warning, list };
    return panelParts;
  }

  function iconButton(className, iconClass) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `tp3d-measure-row__btn ${className}`;
    const icon = doc.createElement('i');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    return button;
  }

  function startRename(id) {
    const reason = blockedReason();
    if (reason) {
      setStatus(blockedMessage(reason));
      return;
    }
    renamingId = id;
    renderPanel();
    const row = rows.get(id);
    if (row && row.input) {
      row.input.focus();
      row.input.select();
    }
  }

  function finishRename(id, value, commit) {
    if (renamingId !== id) return;
    renamingId = null;
    const pack = currentPack();
    if (commit && pack && !blockedReason()) PackLibrary.renameMeasurement(pack.id, id, value);
    renderPanel();
  }

  /**
   * A single click deletes: no confirm step. The row is removed in place. Focus only moves on when
   * the delete came from the keyboard, so a mouse click never leaves a focus ring behind.
   */
  function removeMeasurement(id, viaKeyboard = false) {
    const reason = blockedReason();
    if (reason) {
      setStatus(blockedMessage(reason));
      return;
    }
    const pack = currentPack();
    if (!pack) return;
    const index = records.findIndex(record => record.id === id);
    if (selectedId === id) selectedId = null;
    if (renamingId === id) renamingId = null;
    if (drag && drag.id === id) cancelDrag();
    const outcome = PackLibrary.deleteMeasurement(pack.id, id);
    if (!outcome.ok) {
      renderPanel();
      return;
    }
    setStatus('Measurement deleted.');
    if (!viaKeyboard) return;
    // Keep keyboard focus in the panel: the next row, else the previous, else the header.
    const next = records[Math.min(index, records.length - 1)];
    const row = next ? rows.get(next.id) : null;
    const target = row && !row.select.disabled ? row.select : (panelParts && panelParts.toggle);
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  function createRow() {
    const el = doc.createElement('li');
    el.className = 'tp3d-measure-row';
    const select = doc.createElement('button');
    select.type = 'button';
    select.className = 'tp3d-measure-row__select';
    const name = doc.createElement('span');
    name.className = 'tp3d-measure-row__name';
    const value = doc.createElement('span');
    value.className = 'tp3d-measure-row__value';
    select.append(name, value);
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'tp3d-measure-row__input';
    input.maxLength = 60;
    input.hidden = true;
    const rename = iconButton('tp3d-measure-row__rename', 'fa-solid fa-pen');
    const remove = iconButton('tp3d-measure-row__delete', 'fa-solid fa-trash-can');
    const issue = doc.createElement('div');
    issue.className = 'tp3d-measure-row__issue';
    issue.hidden = true;
    el.append(select, input, rename, remove, issue);
    const row = { el, select, name, value, input, rename, remove, issue, id: null, renaming: false };
    select.addEventListener('click', () => selectMeasurement(selectedId === row.id ? null : row.id));
    rename.addEventListener('click', () => startRename(row.id));
    // A click event with detail 0 is a keyboard activation (Enter / Space).
    remove.addEventListener('click', ev => removeMeasurement(row.id, ev.detail === 0));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finishRename(row.id, input.value, true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finishRename(row.id, input.value, false);
      }
    });
    input.addEventListener('blur', () => finishRename(row.id, input.value, true));
    return row;
  }

  function updateRow(row, record, result, index, blocked) {
    row.id = record.id;
    row.el.dataset.measurementId = record.id;
    const unreadable = record.type === MEASUREMENT_TYPE_UNREADABLE;
    const title = unreadable ? 'Unreadable measurement' : (record.label || defaultMeasurementName(index));
    if (row.name.textContent !== title) row.name.textContent = title;
    const valid = Boolean(result && result.status === MEASUREMENT_STATUS.VALID);
    const status = result ? result.status : MEASUREMENT_STATUS.UNRESOLVED;
    const valueText = valid ? formatMeasurementLength(result.distance, lengthUnit) : measurementStatusLabel(status);
    if (row.value.textContent !== valueText) row.value.textContent = valueText;
    row.value.classList.toggle('is-needs-review', !valid && status === MEASUREMENT_STATUS.NEEDS_REVIEW);
    row.value.classList.toggle('is-unresolved', !valid && status !== MEASUREMENT_STATUS.NEEDS_REVIEW);

    const selected = record.id === selectedId;
    row.el.classList.toggle('is-selected', selected);
    row.select.disabled = unreadable;
    row.select.setAttribute('aria-pressed', selected ? 'true' : 'false');
    row.select.setAttribute('aria-label', unreadable ? title : `${title}, ${valueText}${selected ? ', selected' : ''}`);
    row.select.title = unreadable ? '' : 'Select to show its endpoints, then drag an endpoint to move it';

    const renaming = renamingId === record.id && !unreadable;
    row.select.hidden = renaming;
    row.input.hidden = !renaming;
    if (renaming && !row.renaming) {
      row.input.value = record.label || '';
      row.input.placeholder = defaultMeasurementName(index);
      row.input.setAttribute('aria-label', 'Measurement name');
    }
    row.renaming = renaming;

    row.rename.hidden = unreadable;
    row.rename.disabled = blocked;
    row.rename.setAttribute('aria-label', `Rename ${title}`);
    row.rename.title = 'Rename';
    row.remove.disabled = blocked;
    row.remove.setAttribute('aria-label', `Delete ${title}`);
    row.remove.title = 'Delete';

    const issueText = valid ? '' : describeMeasurementReason(result ? result.reason : 'unreadable');
    if (row.issue.textContent !== issueText) row.issue.textContent = issueText;
    row.issue.hidden = !issueText;
  }

  /** Context-sensitive guidance: empty unless something is relevant right now. */
  function guidanceText(blockedNow) {
    if (blockedNow) return blockedMessage(blockedNow);
    if (statusMessage) return statusMessage;
    if (drag) return 'Drag to a new position. Esc cancels.';
    if (pending) return 'Click the second point. Esc cancels.';
    if (records.length >= MAX_MEASUREMENTS_PER_PACK) return `Limit of ${MAX_MEASUREMENTS_PER_PACK} measurements reached. Delete one to add another.`;
    if (!records.length) return 'Click two points to measure a distance.';
    return '';
  }

  function renderPanel() {
    if (!active || !doc) return;
    const parts = ensurePanel();
    if (!parts) return;
    const blockedNow = blockedReason();

    const countText = String(records.length);
    if (parts.count.textContent !== countText) parts.count.textContent = countText;
    parts.toggle.setAttribute('aria-expanded', panelCollapsed ? 'false' : 'true');
    const chevronClass = `fa-solid fa-chevron-${panelCollapsed ? 'down' : 'up'} tp3d-measure-panel__chevron`;
    if (parts.chevron.className !== chevronClass) parts.chevron.className = chevronClass;
    parts.root.classList.toggle('is-collapsed', panelCollapsed);
    parts.body.hidden = panelCollapsed;
    const hintText = guidanceText(blockedNow);
    if (parts.hint.textContent !== hintText) parts.hint.textContent = hintText;
    parts.warning.hidden = !records.some(record => record.type === MEASUREMENT_TYPE_UNREADABLE);

    const seen = new Set();
    records.forEach((record, index) => {
      let row = rows.get(record.id);
      if (!row) {
        row = createRow();
        rows.set(record.id, row);
      }
      updateRow(row, record, results[index], index, Boolean(blockedNow));
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

  // ==========================================================================
  // SECTION: SYNC + LIFECYCLE
  // ==========================================================================
  /** Re-derive validity from committed data. Cheap; called on render and on measurement writes. */
  function sync() {
    const pack = currentPack();
    lengthUnit = (PreferencesManager.get().units || {}).length || 'in';
    if (!pack || !inEditor()) {
      records = [];
      results = [];
      if (active) exit();
      return;
    }
    records = PackLibrary.getMeasurements(pack);
    results = PackLibrary.resolveMeasurements(pack);
    if (selectedId && !records.some(record => record.id === selectedId)) selectedId = null;
    if (renamingId && !records.some(record => record.id === renamingId)) renamingId = null;
    if (pending && !pendingStillValid(pack)) {
      cancelPending('The cargo for Point A changed, so the measurement was cancelled.');
    }
    if (drag) {
      const index = records.findIndex(record => record.id === drag.id);
      if (index === -1 || !results[index] || results[index].status !== MEASUREMENT_STATUS.VALID) {
        cancelDrag('The measurement changed, so the move was cancelled.');
      }
    }
    if (active) renderPanel();
  }

  function pendingStillValid(pack) {
    const anchor = pending.anchor;
    const instance = anchor.kind === 'cargo'
      ? (pack.cases || []).find(inst => inst && inst.id === anchor.instanceId)
      : null;
    return resolveAnchor(anchor, {
      instance,
      caseData: instance ? CaseLibrary.getById(instance.caseId) : null,
      floors: PackLibrary.getMeasurementFloors(pack),
      truck: pack.truck,
    }).status === MEASUREMENT_STATUS.VALID;
  }

  /** Show or hide the ruler per Settings. Hiding it while active exits the mode and cancels any gesture. */
  function syncVisibility() {
    const show = PreferencesManager.get().showMeasurementTool !== false;
    if (!show && active) exit();
    if (els.button) els.button.hidden = !show;
    return show;
  }

  function bind(elements) {
    els = { ...els, ...elements };
    if (bound) return;
    bound = true;
    StateStore.subscribe(changes => {
      if (!active) return;
      if (changes._replace || !inEditor() || Object.prototype.hasOwnProperty.call(changes, 'currentPackId')) {
        exit();
        return;
      }
      if (changes._undo || changes._redo) {
        if (drag) cancelDrag('Undo or redo cancelled the move.');
        cancelPending('Undo or redo cancelled the unfinished measurement.');
      }
    });
    if (OperationLifecycle && typeof OperationLifecycle.subscribe === 'function') {
      OperationLifecycle.subscribe(() => {
        if (active) syncBlocked();
      });
    }
  }

  function destroy() {
    exit();
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
    svg = null;
  }

  return {
    bind,
    sync,
    syncVisibility,
    toggle,
    exit,
    destroy,
    isActive: () => active,
    hasPending: () => Boolean(pending),
    onPointerDown,
    onPointerMove,
    onPointerCancel,
    onPointerUp,
    onDoubleClick,
  };
}
