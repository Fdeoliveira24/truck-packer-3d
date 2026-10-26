/**
 * @file surface-picker.js
 * @description The one surface picker shared by the Editor's scene tools (Measurement Tool, Annotations).
 *   Turns a screen point into a supported anchor on anything visible: any cargo surface (any shape,
 *   stored as a cargo-local point + instance ID + geometry signature), the truck floor, Wheel Well tops
 *   and over-cab deck, the truck walls, ceiling and end planes (the exposed outer faces of the shell
 *   volumes the Editor draws), and the ground anywhere. The anchor model, truck geometry and surface
 *   validation live in core/measurements.js and PackLibrary; this module is only the ray glue.
 *
 *   It also carries the committed-versus-displayed rules both tools rely on: cargo anchors are only
 *   ever picked from, and resolved against, COMMITTED poses (a pick that lands on cargo is refused
 *   while the Editor holds a scene-only pose, and cargo whose instance ID another item shares is
 *   refused), while `liveAnchorWorld` follows the pose the scene currently displays so overlays never
 *   float away from cargo that is being dragged, nudged or animated. Nothing here writes anything.
 *
 *   Freehand strokes add two things on top of the same ray glue: `pickDraw` (the pick plus the physical face a
 *   cargo hit landed on, read from the hit triangle's own normal, and a refusal for everything a stroke cannot
 *   sit on) and `sampleDrawSurface` (where the pointer's ray meets the ONE plane a stroke began on, whether that
 *   plane is still what the pointer sees there, and whether the point is still on a patch the stroke may use).
 * @module editor/surface-picker
 */

import {
  buildCargoAnchor,
  buildFloorAnchor,
  buildSpaceAnchor,
  cargoAnchorLocal,
  cargoFaceFrame,
  cargoFacePatch,
  drawAnchorUV,
  drawFrameKey,
  drawLift,
  drawSurfacePatches,
  instanceIdentityKey,
  isCargoFaceSupported,
  patchContains,
  resolveCargoPose,
} from '../core/measurements.js';

const GROUND_MAX_DISTANCE_WORLD = 800;
const INCH_TO_WORLD_FALLBACK = 0.05;
const AXIS_NAMES = ['x', 'y', 'z'];
// A ray hit within this distance of a shell face's edge still counts as on it (half the anchor tolerance,
// so the point built from it always validates).
const SHELL_FACE_SLACK_INCHES = 0.005;
// A triangle's normal must point along one axis this closely for its hit to name a face. Box faces and cylinder
// caps are exactly axis-aligned; a cylinder's side facets and any tilted surface are not, so they name no face.
const FACE_NORMAL_MIN_ALIGNMENT = 0.999;
// Two floor elevations this close are the same floor (the shared floor tolerance of the anchor model).
const SAME_FLOOR_INCHES = 0.01;

/**
 * @param {{
 *   SceneManager: any, CaseScene: any, CaseLibrary: any, PackLibrary: any,
 *   getPack: () => any,
 *   hasProvisionalPose?: () => boolean,
 * }} deps `getPack` returns the Load Plan being edited; `hasProvisionalPose` reports a live drag, gizmo
 *   stroke or held case (meshes displayed away from the pose the Load Plan stores).
 */
export function createSurfacePicker({ SceneManager, CaseScene, CaseLibrary, PackLibrary, getPack, hasProvisionalPose = () => false }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const sampleOrigin = new THREE.Vector3();
  const sampleDirection = new THREE.Vector3();
  const sampleHit = new THREE.Vector3();
  const inverseMatrix = new THREE.Matrix4();
  // identity key -> the instance's own ID, for each unambiguous cargo item, per cargo list (cached by identity).
  const sceneIdCache = new WeakMap();

  const toWorldScale = () => (typeof SceneManager.toWorld === 'function' ? SceneManager.toWorld(1) : INCH_TO_WORLD_FALLBACK);
  const getCanvas = () => {
    const renderer = SceneManager.getRenderer && SceneManager.getRenderer();
    return renderer ? renderer.domElement : null;
  };

  function inchesToWorldVector(point, target) {
    const scale = toWorldScale();
    return target.set(point.x * scale, point.y * scale, point.z * scale);
  }

  function worldVectorToInches(vector) {
    const scale = toWorldScale();
    return { x: vector.x / scale, y: vector.y / scale, z: vector.z / scale };
  }

  /**
   * The one cargo instance an ID names in the Load Plan. When more than one carries it (damaged data is
   * kept, never repaired) it is `ambiguous` and no instance is returned: an anchor is never attached to
   * an arbitrary one of them.
   */
  function lookupInstance(pack, instanceId) {
    const key = instanceIdentityKey(instanceId);
    const matches = key === null ? [] : (pack.cases || []).filter(inst => inst && instanceIdentityKey(inst.id) === key);
    return { instance: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  }

  /**
   * Fingerprint of the COMMITTED pose of the cargo an anchor refers to, as the pure resolver reads it.
   * A gesture records it when it starts and is dropped if it changes. Null for anchors that are not on cargo.
   */
  function cargoPoseKey(pack, anchor) {
    if (!pack || !anchor || anchor.kind !== 'cargo') return null;
    const { instance, ambiguous } = lookupInstance(pack, anchor.instanceId);
    if (ambiguous) return 'ambiguous';
    if (!instance) return 'missing';
    const pose = resolveCargoPose(instance, CaseLibrary.getById(instance.caseId));
    if (!pose) return 'invalid';
    return [pose.center.x, pose.center.y, pose.center.z, pose.rotation.x, pose.rotation.y, pose.rotation.z]
      .map(value => value.toFixed(6)).join(',');
  }

  function sceneIdsFor(pack) {
    const list = pack && pack.cases;
    if (!Array.isArray(list)) return new Map();
    let ids = sceneIdCache.get(list);
    if (!ids) {
      ids = new Map();
      list.forEach(inst => {
        const key = inst ? instanceIdentityKey(inst.id) : null;
        if (key !== null) ids.set(key, ids.has(key) ? null : inst.id);
      });
      sceneIdCache.set(list, ids);
    }
    return ids;
  }

  // ==========================================================================
  // SECTION: PICKING (anything visible: cargo, truck floor, truck shell, ground)
  // ==========================================================================
  function describeCargoHit(hit, pack) {
    const instanceId = hit.object && hit.object.userData ? hit.object.userData.instanceId : null;
    const { instance, ambiguous } = lookupInstance(pack, instanceId);
    // Visible cargo that cannot be told apart from another item: refuse it (see pick) instead of guessing.
    if (ambiguous) return { ambiguous: true, fromCargo: true, distance: hit.distance };
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
    const face = anchor.kind === 'cargo' ? cargoFaceFromHit(hit, /** @type {any} */ (anchor).signature) : null;
    return { kind: anchor.kind, anchor, world: hit.point.clone(), distance: hit.distance, fromCargo: true, ...(face ? { face } : {}) };
  }

  /**
   * The physical cargo face a ray hit landed on, read from the hit triangle's own normal in the cargo's frame
   * (never inferred from where the anchor sits, which is ambiguous at an edge). Null when the normal is not
   * along one axis (a cylinder's curved side, a tilted surface) or the face is not one a stroke may use
   * (every cylinder or drum face but the two flat end caps).
   */
  function cargoFaceFromHit(hit, signature) {
    const normal = hit.face && hit.face.normal;
    if (!normal) return null;
    let axis = 'x';
    if (Math.abs(normal.y) > Math.abs(normal[axis])) axis = 'y';
    if (Math.abs(normal.z) > Math.abs(normal[axis])) axis = 'z';
    const value = normal[axis];
    if (!Number.isFinite(value) || Math.abs(value) < FACE_NORMAL_MIN_ALIGNMENT) return null;
    const face = `${value > 0 ? '+' : '-'}${axis}`;
    return isCargoFaceSupported(face, signature) ? face : null;
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
   * Truck walls, ceiling and end planes that physically exist (PackLibrary.getMeasurementShellFaces). The
   * shell is see-through, so the surface the user sees "behind" is the far side: of all the faces the ray
   * leaves the truck through, the farthest one. A ray that crosses a region with no face (the Front
   * Overhang cab void) finds none there and falls through to the floor or the ground.
   */
  function pickShell(ray, pack) {
    const faces = PackLibrary.getMeasurementShellFaces(pack);
    if (!faces.length) return null;
    const scale = toWorldScale();
    const slack = SHELL_FACE_SLACK_INCHES * scale;
    let best = null;
    faces.forEach(face => {
      const axis = AXIS_NAMES[face.axis];
      const direction = ray.direction[axis];
      // Only faces the ray leaves through: a near wall is seen through, never picked.
      if (direction * face.outward < 1e-9) return;
      const t = (face.min[face.axis] * scale - ray.origin[axis]) / direction;
      if (!(t > 0) || (best && best.t >= t)) return;
      const hit = [ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t, ray.origin.z + ray.direction.z * t];
      if (!hit.every((value, i) => value >= face.min[i] * scale - slack && value <= face.max[i] * scale + slack)) return;
      best = { face, t, hit };
    });
    if (!best) return null;
    const world = new THREE.Vector3(best.hit[0], best.hit[1], best.hit[2]);
    // The anchor remembers the truck AND its effective usable zones, so a configuration change within one
    // shape mode (Front Overhang length, Wheel Well size) is recognised later.
    const anchor = buildSpaceAnchor({ surface: best.face.surface, point: worldVectorToInches(world), truck: pack.truck, zones: PackLibrary.getMeasurementZones(pack) });
    return anchor ? { kind: 'space', anchor, world, distance: best.t } : null;
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

  /**
   * The surface under a screen point, or null. `outcome.blocked` is set to 'provisional' when the nearest
   * surface is cargo while the Editor holds a scene-only pose, and to 'ambiguous' when it is cargo whose
   * ID another item shares: nothing is picked, and nothing behind that cargo is substituted for it.
   */
  function pick(clientX, clientY, outcome = null) {
    const camera = SceneManager.getCamera();
    const canvas = getCanvas();
    const pack = getPack();
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
    if (best && best.fromCargo && hasProvisionalPose()) {
      if (outcome) outcome.blocked = 'provisional';
      return null;
    }
    if (best && best.ambiguous) {
      if (outcome) outcome.blocked = 'ambiguous';
      return null;
    }
    // Cargo and floor win; then the see-through truck shell; then the ground anywhere.
    return best || pickShell(raycaster.ray, pack) || pickGround(raycaster.ray);
  }

  // ==========================================================================
  // SECTION: FREEHAND SURFACES (where a stroke began, and every later sample on that one plane)
  // ==========================================================================
  /**
   * The pick under a screen point, if a stroke can start there: any cargo face the hit names (a box face or a
   * cylinder end cap), a floor, a truck wall or the ceiling, or the ground. `outcome.blocked` is the pick's own
   * ('provisional', 'ambiguous') or 'unsupported' for a surface a stroke can never sit on (a cylinder's
   * curved side, open space).
   */
  function pickDraw(clientX, clientY, outcome = null) {
    const picked = pick(clientX, clientY, outcome);
    if (!picked) return null;
    const unsupported = picked.kind === 'cargo' ? !picked.face : picked.kind === 'space' && picked.anchor.surface === 'free';
    if (unsupported) {
      if (outcome) outcome.blocked = 'unsupported';
      return null;
    }
    return picked;
  }

  /**
   * The surface a stroke is drawn on, from the pick that starts it: its frame, the plane every vertex lies in,
   * and the convex patches that hold the first vertex. A cargo face has the one patch it was picked on; a floor,
   * wall, ceiling or the ground has every patch the CURRENT layout offers that shares the anchor's plane
   * (Gate A's `drawSurfacePatches`), and the stroke keeps only those that also hold each later vertex, so it can
   * never be carried onto a second zone or wall piece. Null when the pick cannot carry a stroke.
   */
  function beginDrawSurface(picked, pack) {
    if (!picked || !picked.anchor || !pack) return null;
    const { anchor } = picked;
    const face = anchor.kind === 'cargo' ? picked.face : undefined;
    const key = drawFrameKey(anchor, face);
    const frame = key ? cargoFaceFrame(key) : null;
    const first = drawAnchorUV(anchor, face);
    if (!frame || !first) return null;
    const point = anchor.kind === 'cargo' ? anchor.local : anchor.position;
    const patches = anchor.kind === 'cargo'
      ? [cargoFacePatch(face, anchor.signature)]
      : drawSurfacePatches(anchor, {
        floors: PackLibrary.getMeasurementFloors(pack), truck: pack.truck, zones: PackLibrary.getMeasurementZones(pack),
      });
    const holding = patches.filter(patch => patch && patchContains(patch, first.u, first.v));
    if (!holding.length || !point || !Number.isFinite(point[frame.normal])) return null;
    return {
      anchor, face, frame, first, patches: holding,
      plane: point[frame.normal], // inches, along the surface normal, in the anchor's frame (cargo-local or world)
      identity: anchor.kind === 'cargo' ? instanceIdentityKey(anchor.instanceId) : null,
    };
  }

  /** The world position of a surface-local (u, v) on a stroke's surface, as the scene displays it now (cargo follows its group). */
  function drawSurfaceWorld(surface, u, v, target) {
    const lifted = drawLift(surface.anchor, surface.face, u, v);
    if (!lifted) return null;
    inchesToWorldVector(lifted, target);
    if (surface.anchor.kind !== 'cargo') return target;
    const group = cargoGroupFor(surface.anchor);
    if (!group) return null;
    group.updateMatrixWorld(true);
    return group.localToWorld(target);
  }

  /** Whether the surface at this screen point is the surface a stroke is on: the same cargo face, floor, wall or ground. */
  function seesSurface(surface, seen) {
    if (!seen) return false;
    const { anchor } = surface;
    if (anchor.kind === 'cargo') {
      return seen.kind === 'cargo' && seen.face === surface.face && instanceIdentityKey(seen.anchor.instanceId) === surface.identity;
    }
    if (anchor.kind === 'floor') {
      return seen.kind === 'floor' && seen.anchor.surface === anchor.surface &&
        Math.abs(seen.anchor.position.y - anchor.position.y) <= SAME_FLOOR_INCHES;
    }
    return seen.kind === 'space' && seen.anchor.surface === anchor.surface;
  }

  /**
   * Where the pointer's ray meets a stroke's own plane, as surface-local inches (the plane only: no patch, no
   * visibility rule). `bounded` additionally requires the pointer to be over the canvas. `status`: 'ok' (u, v),
   * 'view' (outside the canvas when bounded, or the ray does not reach the plane in front of the camera),
   * 'blocked' (the cargo the plane belongs to is not in the scene), 'provisional' (the Editor holds a scene-only pose).
   * @returns {{ status: string, u?: number, v?: number }}
   */
  function planeSample(surface, clientX, clientY, bounded) {
    const camera = SceneManager.getCamera();
    const canvas = getCanvas();
    const pack = getPack();
    if (!camera || !canvas || !pack || !surface) return { status: 'view' };
    if (hasProvisionalPose()) return { status: 'provisional' };
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { status: 'view' };
    if (bounded && (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)) return { status: 'view' };
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const { frame, anchor } = surface;
    const scale = toWorldScale();
    const group = anchor.kind === 'cargo' ? cargoGroupFor(anchor) : null;
    if (anchor.kind === 'cargo' && !group) return { status: 'blocked' };
    sampleOrigin.copy(raycaster.ray.origin);
    sampleDirection.copy(raycaster.ray.direction);
    if (group) {
      group.updateMatrixWorld(true);
      inverseMatrix.copy(group.matrixWorld).invert();
      sampleOrigin.applyMatrix4(inverseMatrix);
      sampleDirection.transformDirection(inverseMatrix);
    }
    const along = sampleDirection[frame.normal];
    if (Math.abs(along) < 1e-9) return { status: 'view' };
    const t = (surface.plane * scale - sampleOrigin[frame.normal]) / along;
    if (!(t > 0) || !Number.isFinite(t)) return { status: 'view' };
    sampleHit.copy(sampleDirection).multiplyScalar(t).add(sampleOrigin);
    const u = sampleHit[frame.u] / scale;
    const v = sampleHit[frame.v] / scale;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return { status: 'view' };
    return { status: 'ok', u, v };
  }

  /**
   * Where the pointer's ray meets a stroke's own plane, and whether the stroke may continue there. `candidates`
   * are the patches still holding every vertex so far. `status`:
   *  - 'ok': on the plane, on a patch that holds it, and that plane is what the pointer sees (u, v, world);
   *  - 'edge': on the plane but off every candidate patch (the stroke left its face or zone; u, v given);
   *  - 'blocked': inside a patch, but something else is in front of it or is what is shown there;
   *  - 'view': outside the canvas, or the ray does not reach the plane in front of the camera;
   *  - 'provisional': the Editor now holds a scene-only pose (the caller cancels the stroke).
   * @returns {{ status: string, u?: number, v?: number, world?: any }}
   */
  function sampleDrawSurface(surface, candidates, clientX, clientY) {
    const onPlane = planeSample(surface, clientX, clientY, true);
    if (onPlane.status !== 'ok') return { status: onPlane.status };
    const { u, v } = /** @type {{ u: number, v: number }} */ (onPlane);
    if (!candidates.some(patch => patchContains(patch, u, v))) return { status: 'edge', u, v };
    // The same nearest-surface rule that placed the stroke's first vertex: if anything else is what the pointer
    // sees here (cargo in front, another surface), the stroke stops instead of drawing through it.
    const outcome = {};
    const seen = pick(clientX, clientY, outcome);
    if (outcome.blocked === 'provisional') return { status: 'provisional' };
    if (!seesSurface(surface, seen)) return { status: 'blocked', u, v };
    const world = new THREE.Vector3();
    if (!drawSurfaceWorld(surface, u, v, world)) return { status: 'blocked', u, v };
    return { status: 'ok', u, v, world };
  }

  /**
   * Where the pointer's ray meets a stroke's plane, wherever on that plane: the position a whole-stroke move is
   * measured from. Unlike sampleDrawSurface it neither requires a patch nor that the surface is what the pointer
   * sees, so a drag can run past the edge of its surface (the caller then judges the move invalid).
   * @returns {{ status: string, u?: number, v?: number }}
   */
  function sampleDrawPlane(surface, clientX, clientY) {
    return planeSample(surface, clientX, clientY, false);
  }

  // ==========================================================================
  // SECTION: LIVE ANCHORS (follow the scene's displayed pose, never persisted)
  // ==========================================================================
  /**
   * The scene object of the cargo an anchor names, or null. The scene keys cargo by the instance's own
   * ID; an anchor may carry the same identity in another spelling (a trimmed-equal ID), and an ID shared
   * by several instances maps to none.
   */
  function cargoGroupFor(anchor) {
    if (!anchor || anchor.kind !== 'cargo') return null;
    return CaseScene.getObject(anchor.instanceId) ||
      CaseScene.getObject(sceneIdsFor(getPack()).get(instanceIdentityKey(anchor.instanceId))) || null;
  }

  /**
   * World position of an anchor as the scene currently displays it. Cargo anchors follow the live
   * group transform (so they track drags, nudges, animation and AutoPack preview); nothing here is
   * written back. Falls back to the committed resolution when the group is unavailable.
   */
  function liveAnchorWorld(anchor, committedPoint, target) {
    if (anchor.kind === 'cargo') {
      const group = cargoGroupFor(anchor);
      const local = group ? cargoAnchorLocal(anchor) : null;
      if (group && local) {
        inchesToWorldVector(local, target);
        group.updateMatrixWorld(true);
        return group.localToWorld(target);
      }
    }
    return committedPoint ? inchesToWorldVector(committedPoint, target) : null;
  }

  return {
    pick,
    pickDraw,
    beginDrawSurface,
    sampleDrawSurface,
    sampleDrawPlane,
    drawSurfaceWorld,
    liveAnchorWorld,
    cargoGroupFor,
    lookupInstance,
    cargoPoseKey,
    toWorldScale,
    getCanvas,
    inchesToWorldVector,
    worldVectorToInches,
    hasProvisionalPose: () => Boolean(hasProvisionalPose()),
  };
}
