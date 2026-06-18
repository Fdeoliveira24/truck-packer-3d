import { canonicalOrientationLock } from '../core/orientation.js';

const MIN_STACK_SUPPORT_RATIO = 0.5;

function getXzOverlapArea(aMinX, aMaxX, aMinZ, aMaxZ, bMinX, bMaxX, bMinZ, bMaxZ) {
  const overlapL = Math.max(0, Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX));
  const overlapW = Math.max(0, Math.min(aMaxZ, bMaxZ) - Math.max(aMinZ, bMinZ));
  return overlapL * overlapW;
}

function buildLockedOrientation(dims, inst, orientationTools) {
  if (!inst || inst.orientationLocked !== true) return null;
  const sourceRotation =
    inst.lockedRotation ||
    (inst.transform && inst.transform.rotation) ||
    null;
  if (!sourceRotation) return null;
  const lockedRotation = orientationTools.normalizeRightAngleRotation(sourceRotation);
  const orientedDims = orientationTools.getOrientedDimsForRotation(dims, lockedRotation);
  if (!orientedDims.length || !orientedDims.width || !orientedDims.height) return null;
  return {
    l: orientedDims.length,
    w: orientedDims.width,
    h: orientedDims.height,
    rotX: lockedRotation.x,
    rotY: lockedRotation.y,
    rotZ: lockedRotation.z,
    locked: true,
  };
}

function buildOrientations(dims, caseData, inst, orientationTools) {
  const lockedOrientation = buildLockedOrientation(dims, inst, orientationTools);
  if (lockedOrientation) return [lockedOrientation];

  // Canonical orientation ('any' | 'upright' | 'onSide') so every accepted alias
  // produces the same candidate set as the rest of the app (single source).
  const lock = canonicalOrientationLock(caseData.orientationLock);
  const canFlip = Boolean(caseData.canFlip);
  const PI2 = Math.PI / 2;
  const seen = new Set();
  const oris = [];

  // Rotation is the single source of truth here too: derive each candidate's
  // dimensions from its right-angle rotation via the shared THREE-compatible
  // helper, instead of hardcoding a permutation that can drift on compound angles.
  function tryOri(rx, ry, rz) {
    const rotation = orientationTools.normalizeRightAngleRotation({ x: rx || 0, y: ry || 0, z: rz || 0 });
    const od = orientationTools.getOrientedDimsForRotation(dims, rotation);
    const l = od.length, w = od.width, h = od.height;
    if (!(l > 0 && w > 0 && h > 0)) return;
    const key = `${l}|${w}|${h}`;
    if (seen.has(key)) return;
    seen.add(key);
    oris.push({ l, w, h, rotX: rotation.x, rotY: rotation.y, rotZ: rotation.z });
  }

  if (lock === 'upright' || lock === 'any') {
    tryOri(0, 0, 0);
    tryOri(0, PI2, 0);
  }

  if (lock === 'onSide') {
    tryOri(0, 0, PI2);
    tryOri(PI2, 0, PI2);
  }

  // canFlip may only introduce tipped faces when the policy is 'any' — 'upright'
  // must stay upright even with canFlip:true (matches the active solver and
  // isOrientationAllowedByCasePolicy). Previously this used lock !== 'onSide',
  // which wrongly tipped upright items.
  if (canFlip && lock === 'any') {
    tryOri(0, 0, PI2);
    tryOri(PI2, 0, PI2);
    tryOri(PI2, 0, 0);
    tryOri(PI2, PI2, 0);
  }

  return oris;
}

function findRestingY(cx, cz, halfL, halfW, packed) {
  const EPS = 0.01;
  const bMinX = cx - halfL;
  const bMaxX = cx + halfL;
  const bMinZ = cz - halfW;
  const bMaxZ = cz + halfW;
  const candidateArea = Math.max(1e-9, (bMaxX - bMinX) * (bMaxZ - bMinZ));
  const supportByTop = new Map();

  for (const p of packed) {
    if (p.noStackOnTop || p.stackable === false) continue;
    if (p.maxStackCount > 0) {
      const topOfP = p.pos.y + p.dims.h / 2;
      let countOnP = 0;
      for (const q of packed) {
        if (q === p) continue;
        if (Math.abs((q.pos.y - q.dims.h / 2) - topOfP) > EPS * 10) continue;
        if (q.pos.x - q.dims.l / 2 >= p.pos.x + p.dims.l / 2 - EPS) continue;
        if (q.pos.x + q.dims.l / 2 <= p.pos.x - p.dims.l / 2 + EPS) continue;
        if (q.pos.z - q.dims.w / 2 >= p.pos.z + p.dims.w / 2 - EPS) continue;
        if (q.pos.z + q.dims.w / 2 <= p.pos.z - p.dims.w / 2 + EPS) continue;
        countOnP++;
      }
      if (countOnP >= p.maxStackCount) continue;
    }
    const pHL = p.dims.l / 2;
    const pHW = p.dims.w / 2;
    const overlapArea = getXzOverlapArea(
      bMinX,
      bMaxX,
      bMinZ,
      bMaxZ,
      p.pos.x - pHL,
      p.pos.x + pHL,
      p.pos.z - pHW,
      p.pos.z + pHW
    );
    if (overlapArea <= EPS) continue;
    const top = p.pos.y + p.dims.h / 2;
    const key = Math.round(top * 1000) / 1000;
    supportByTop.set(key, (supportByTop.get(key) || 0) + overlapArea);
  }

  const supports = Array.from(supportByTop.entries()).sort((a, b) => b[0] - a[0]);
  for (const [top, supportArea] of supports) {
    if (supportArea >= candidateArea * MIN_STACK_SUPPORT_RATIO) return top;
  }
  return 0;
}

function collides(pos, dims, packed) {
  const EPS = 0.001;
  const aMin = { x: pos.x - dims.l / 2, y: pos.y - dims.h / 2, z: pos.z - dims.w / 2 };
  const aMax = { x: pos.x + dims.l / 2, y: pos.y + dims.h / 2, z: pos.z + dims.w / 2 };
  for (const p of packed) {
    const bMin = { x: p.pos.x - p.dims.l / 2, y: p.pos.y - p.dims.h / 2, z: p.pos.z - p.dims.w / 2 };
    const bMax = { x: p.pos.x + p.dims.l / 2, y: p.pos.y + p.dims.h / 2, z: p.pos.z + p.dims.w / 2 };
    if (aMin.x < bMax.x - EPS && aMax.x > bMin.x + EPS &&
      aMin.y < bMax.y - EPS && aMax.y > bMin.y + EPS &&
      aMin.z < bMax.z - EPS && aMax.z > bMin.z + EPS) {
      return true;
    }
  }
  return false;
}

function tryPlace(cx, cz, ori, truckH, zones, packed, geometry) {
  const halfL = ori.l / 2;
  const halfW = ori.w / 2;
  const restY = findRestingY(cx, cz, halfL, halfW, packed);
  const cy = restY + ori.h / 2;

  if (cy + ori.h / 2 > truckH + 0.01) { return null; }

  const aabb = {
    min: { x: cx - halfL, y: cy - ori.h / 2, z: cz - halfW },
    max: { x: cx + halfL, y: cy + ori.h / 2, z: cz + halfW },
  };
  if (!geometry.isAabbContainedInAnyZone(aabb, zones)) { return null; }

  const dims = { l: ori.l, w: ori.w, h: ori.h };
  const pos = { x: cx, y: cy, z: cz };
  if (collides(pos, dims, packed)) { return null; }

  return { pos, dims, restY };
}

function getPlacementAabb(pos, dims) {
  return {
    min: { x: pos.x - dims.l / 2, y: pos.y - dims.h / 2, z: pos.z - dims.w / 2 },
    max: { x: pos.x + dims.l / 2, y: pos.y + dims.h / 2, z: pos.z + dims.w / 2 },
  };
}

function isXzContainedInZone(aabb, zone) {
  const EPS = 0.05;
  return aabb.min.x >= zone.min.x - EPS &&
    aabb.max.x <= zone.max.x + EPS &&
    aabb.min.z >= zone.min.z - EPS &&
    aabb.max.z <= zone.max.z + EPS;
}

function hasPlacementSupport(placement, acceptedPacked, zones) {
  const EPS = 0.05;
  const aabb = getPlacementAabb(placement.pos, placement.dims);
  const bottom = aabb.min.y;
  if (bottom <= EPS) return true;
  if ((zones || []).some(zone => Math.abs(bottom - zone.min.y) <= EPS && isXzContainedInZone(aabb, zone))) {
    return true;
  }

  const candidateArea = Math.max(1e-9, placement.dims.l * placement.dims.w);
  let supportArea = 0;
  for (const p of acceptedPacked) {
    if (p.noStackOnTop || p.stackable === false) continue;
    const top = p.pos.y + p.dims.h / 2;
    if (Math.abs(bottom - top) > EPS) continue;
    supportArea += getXzOverlapArea(
      aabb.min.x,
      aabb.max.x,
      aabb.min.z,
      aabb.max.z,
      p.pos.x - p.dims.l / 2,
      p.pos.x + p.dims.l / 2,
      p.pos.z - p.dims.w / 2,
      p.pos.z + p.dims.w / 2
    );
  }
  return supportArea >= candidateArea * MIN_STACK_SUPPORT_RATIO;
}

function validatePackedPlacements(packedList, zones, geometry) {
  const accepted = [];
  const rejected = [];
  for (const p of packedList) {
    const aabb = getPlacementAabb(p.pos, p.dims);
    if (!geometry.isAabbContainedInAnyZone(aabb, zones)) {
      rejected.push({ id: p.instanceId, reason: 'outsideUsableZone' });
      continue;
    }
    if (collides(p.pos, p.dims, accepted)) {
      rejected.push({ id: p.instanceId, reason: 'collision' });
      continue;
    }
    if (!hasPlacementSupport(p, accepted, zones)) {
      rejected.push({ id: p.instanceId, reason: 'unsupported' });
      continue;
    }
    accepted.push(p);
  }
  return { accepted, rejected };
}

export function buildLegacyAutoPackItems({
  instances = [],
  getCaseById,
  volumeInCubicInches,
  orientationTools,
}) {
  return (instances || [])
    .filter(inst => !inst.hidden)
    .map(inst => {
      const c = typeof getCaseById === 'function' ? getCaseById(inst.caseId) : null;
      if (!c) { return null; }
      const d = c.dimensions || { length: 0, width: 0, height: 0 };
      const shape = (c.shape || 'box').toLowerCase();
      let vol;
      if (shape === 'cylinder' || shape === 'drum') {
        const r = Math.min(d.width, d.height) / 2;
        vol = Math.PI * r * r * d.length;
      } else {
        vol = c.volume || volumeInCubicInches(d);
      }
      const orientations = buildOrientations(d, c, inst, orientationTools);
      return { inst, caseData: c, volume: vol, orientations };
    })
    .filter(Boolean)
    .sort((a, b) => b.volume - a.volume);
}

export async function solveLegacyAutoPack({
  packId,
  mode = 'rect',
  truck,
  zones,
  packItems,
  loadFrontFirst,
  xStep,
  zStep,
  geometry,
  diag,
  sleep,
  shouldAbort,
}) {
  const truckL = truck.length || 636;
  const truckW = truck.width || 102;
  const truckH = truck.height || 98;

  const xSet = new Set();
  for (const z of zones) {
    xSet.add(z.min.x);
    xSet.add(z.max.x);
  }
  for (let x = 0; x <= truckL; x += xStep) { xSet.add(x); }
  const xPositions = Array.from(xSet).filter(x => x >= 0 && x <= truckL);
  xPositions.sort((a, b) => loadFrontFirst ? b - a : a - b);

  const zSet = new Set();
  for (const z of zones) {
    zSet.add(z.min.z);
    zSet.add(z.max.z);
  }
  for (let z = -truckW / 2; z <= truckW / 2; z += zStep) { zSet.add(z); }
  const zPositions = Array.from(zSet).sort((a, b) => a - b);

  try {
    if (diag && typeof diag.autopackStart === 'function') {
      diag.autopackStart({
        packId,
        mode,
        loadFrontFirst,
        truck: { length: truckL, width: truckW, height: truckH },
        zones: zones && zones.length ? zones.length : 0,
        xStep,
        zStep,
        items: (packItems || []).length,
      });
    }
  } catch {
    // ignore
  }

  const remaining = [...packItems];
  let packed = [];
  const placements = new Map();
  const rotations = new Map();
  const packedXEdges = new Set();
  const maxIterations = Math.max(1, packItems.length * 2);
  const X_TIGHTNESS_WEIGHT = 0.8;
  const FLOOR_REST_EPS = 0.05;
  const placementPasses = [
    { name: 'floor', allowStacking: false },
    { name: 'stack', allowStacking: true },
  ];

  function capXAnchorsSorted(arr, maxCount) {
    if (!Array.isArray(arr) || arr.length <= maxCount) return arr;

    const headCount = Math.max(1, Math.floor(maxCount * 0.40));
    const midCount = Math.max(1, Math.floor(maxCount * 0.20));
    const tailCount = Math.max(1, maxCount - headCount - midCount);
    const head = arr.slice(0, headCount);
    const tail = arr.slice(Math.max(headCount, arr.length - tailCount));
    const midStart = Math.max(0, Math.floor((arr.length - midCount) / 2));
    const mid = arr.slice(midStart, midStart + midCount);

    const seen = new Set();
    const out = [];
    for (const v of [...head, ...mid, ...tail]) {
      const k = String(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out.sort((a, b) => loadFrontFirst ? b - a : a - b);
  }

  function capZAnchorsSorted(arr, maxCount) {
    if (!Array.isArray(arr) || arr.length <= maxCount) return arr;

    const headCount = Math.max(1, Math.floor(maxCount * 0.35));
    const midCount = Math.max(1, Math.floor(maxCount * 0.30));
    const tailCount = Math.max(1, maxCount - headCount - midCount);

    const head = arr.slice(0, headCount);
    const tail = arr.slice(Math.max(headCount, arr.length - tailCount));

    let bestIdx = 0;
    let bestAbs = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const a = Math.abs(arr[i]);
      if (a < bestAbs) {
        bestAbs = a;
        bestIdx = i;
      }
    }
    const midStart = Math.max(0, Math.min(arr.length - midCount, bestIdx - Math.floor(midCount / 2)));
    const mid = arr.slice(midStart, midStart + midCount);

    const seen = new Set();
    const out = [];
    for (const v of [...head, ...mid, ...tail]) {
      const k = String(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function computeLiveXFaces() {
    const set = new Set(xPositions);
    for (const p of packed) {
      set.add(p.pos.x - p.dims.l / 2);
      set.add(p.pos.x + p.dims.l / 2);
    }
    for (const e of packedXEdges) { set.add(e); }
    const arr = Array.from(set)
      .filter(x => x >= -0.01 && x <= truckL + 0.01)
      .sort((a, b) => loadFrontFirst ? b - a : a - b);
    return capXAnchorsSorted(arr, 240);
  }

  function computeLiveZFaces() {
    const set = new Set(zPositions);
    for (const p of packed) {
      set.add(p.pos.z - p.dims.w / 2);
      set.add(p.pos.z + p.dims.w / 2);
    }
    const arr = Array.from(set)
      .filter(z => z >= -truckW / 2 - 0.01 && z <= truckW / 2 + 0.01)
      .sort((a, b) => a - b);
    return capZAnchorsSorted(arr, 220);
  }

  let placementsSinceYield = 0;
  for (const placementPass of placementPasses) {
    if (remaining.length === 0) break;
    const passMaxIterations = placementPass.allowStacking ? maxIterations : 1;
    for (let sweep = 0; remaining.length > 0 && sweep < passMaxIterations; sweep++) {
      let placedAny = false;

      let liveX = computeLiveXFaces();
      let xi = 0;
      while (xi < liveX.length) {
        const xFace = liveX[xi];
        let liveZ = computeLiveZFaces();
        let zi = 0;
        let placedOnThisX = false;

        while (zi < liveZ.length) {
          const zFace = liveZ[zi];
          if (remaining.length === 0) break;

          const slotStats = {
            sweep,
            remaining: remaining.length,
            packed: packed.length,
            testedItems: 0,
            testedOris: 0,
            oobX: 0,
            oobZ: 0,
            triedPlace: 0,
            okPlace: 0,
            skippedStackInFloorPass: 0,
            placementPass: placementPass.name,
          };

          let chosenIndex = -1;
          let chosenOri = null;
          let chosenPos = null;
          let chosenDims = null;
          let chosenScore = -Infinity;
          let chosenRestY = null;

          for (let i = 0; i < remaining.length; i++) {
            const item = remaining[i];
            slotStats.testedItems++;
            let bestOri = null;
            let bestPos = null;
            let bestDims = null;
            let bestScore = -Infinity;
            let bestRestY = null;

            for (const ori of item.orientations) {
              slotStats.testedOris++;
              const halfL = ori.l / 2;
              const halfW = ori.w / 2;

              const cx = loadFrontFirst ? xFace - halfL : xFace + halfL;
              const cz = zFace + halfW;

              if (cx - halfL < -0.01 || cx + halfL > truckL + 0.01) {
                slotStats.oobX++;
                continue;
              }
              if (cz - halfW < -truckW / 2 - 0.01 || cz + halfW > truckW / 2 + 0.01) {
                slotStats.oobZ++;
                continue;
              }

              slotStats.triedPlace++;
              const result = tryPlace(cx, cz, ori, truckH, zones, packed, geometry);
              if (!result) continue;

              // Floor pass prevents early towers by giving all valid floor placements a chance
              // before stacked placements are considered.
              if (!placementPass.allowStacking && result.restY > FLOOR_REST_EPS) {
                slotStats.skippedStackInFloorPass++;
                continue;
              }

              slotStats.okPlace++;

              const zFill = ori.w;
              const xDist = loadFrontFirst ? (truckL - cx) : cx;
              const score =
                zFill * 3 +
                -result.restY * 5 +
                -xDist * X_TIGHTNESS_WEIGHT +
                item.volume * 0.001;

              if (score > bestScore) {
                bestScore = score;
                bestOri = ori;
                bestPos = result.pos;
                bestDims = result.dims;
                bestRestY = result.restY;
              }
            }

            if (!bestPos) continue;

            if (bestScore > chosenScore) {
              chosenScore = bestScore;
              chosenIndex = i;
              chosenOri = bestOri;
              chosenPos = bestPos;
              chosenDims = bestDims;
              chosenRestY = bestRestY;

              if (chosenDims && chosenDims.w >= truckW * 0.95) break;
            }
          }

          if (chosenIndex === -1) {
            try {
              if (diag && typeof diag.autopackSlot === 'function') {
                diag.autopackSlot({
                  placed: false,
                  xFace,
                  zFace,
                  ...slotStats,
                });
              }
            } catch {
              // ignore
            }
            zi++;
            continue;
          }

          const item = remaining[chosenIndex];
          placements.set(item.inst.id, chosenPos);
          rotations.set(item.inst.id, { x: chosenOri.rotX || 0, y: chosenOri.rotY || 0, z: chosenOri.rotZ || 0 });
          packed.push({
            instanceId: item.inst.id,
            pos: chosenPos,
            dims: chosenDims,
            noStackOnTop: item.caseData.noStackOnTop,
            stackable: item.caseData.stackable,
            maxStackCount: item.caseData.maxStackCount,
          });

          try {
            if (diag && typeof diag.autopackSlot === 'function') {
              diag.autopackSlot({
                placed: true,
                xFace,
                zFace,
                chosenScore,
                chosenRestY,
                chosen: {
                  instanceId: item.inst.id,
                  caseId: item.inst.caseId,
                  dims: chosenDims,
                  rotY: chosenOri && typeof chosenOri.rotY === 'number' ? chosenOri.rotY : null,
                  pos: chosenPos,
                },
                ...slotStats,
              });
            }
            if (diag && typeof diag.autopackPlace === 'function') {
              diag.autopackPlace({
                sweep,
                placementPass: placementPass.name,
                xFace,
                zFace,
                score: chosenScore,
                restY: chosenRestY,
                instanceId: item.inst.id,
                caseId: item.inst.caseId,
                dims: chosenDims,
                pos: chosenPos,
                rotY: chosenOri && typeof chosenOri.rotY === 'number' ? chosenOri.rotY : null,
                remainingAfter: remaining.length - 1,
                packedAfter: packed.length,
              });
            }
          } catch {
            // ignore
          }

          packedXEdges.add(chosenPos.x - chosenDims.l / 2);
          packedXEdges.add(chosenPos.x + chosenDims.l / 2);

          remaining.splice(chosenIndex, 1);
          placedAny = true;
          placedOnThisX = true;

          placementsSinceYield++;
          if (placementsSinceYield % 4 === 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(0);
            if (shouldAbort()) return { aborted: true };
          }

          liveZ = computeLiveZFaces();
          zi = 0;
        }

        if (remaining.length === 0) break;
        if (placedOnThisX) {
          liveX = computeLiveXFaces();
          xi = 0;
        } else {
          xi++;
        }
      }

      if (!placedAny) break;
    }
  }

  const finalValidation = validatePackedPlacements(packed, zones, geometry);
  packed = finalValidation.accepted;
  const rejectedPackedIds = new Set(finalValidation.rejected.map(item => item.id));
  for (const id of rejectedPackedIds) {
    placements.delete(id);
    rotations.delete(id);
  }

  const unpacked = [
    ...remaining.map(item => item.inst.id),
    ...Array.from(rejectedPackedIds),
  ];

  const orientedDimsMap = new Map();
  for (const p of packed) {
    orientedDimsMap.set(p.instanceId, {
      length: p.dims.l,
      width: p.dims.w,
      height: p.dims.h,
    });
  }

  return {
    aborted: false,
    placements,
    rotations,
    orientedDimsMap,
    unpacked,
    packed,
    finalValidation,
  };
}
