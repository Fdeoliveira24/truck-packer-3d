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
 * @module editor/surface-picker
 */

import {
  buildCargoAnchor,
  buildFloorAnchor,
  buildSpaceAnchor,
  cargoAnchorLocal,
  instanceIdentityKey,
  resolveCargoPose,
} from '../core/measurements.js';

const GROUND_MAX_DISTANCE_WORLD = 800;
const INCH_TO_WORLD_FALLBACK = 0.05;
const AXIS_NAMES = ['x', 'y', 'z'];
// A ray hit within this distance of a shell face's edge still counts as on it (half the anchor tolerance,
// so the point built from it always validates).
const SHELL_FACE_SLACK_INCHES = 0.005;

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
    return { kind: anchor.kind, anchor, world: hit.point.clone(), distance: hit.distance, fromCargo: true };
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
