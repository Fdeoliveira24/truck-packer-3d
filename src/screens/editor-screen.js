/**
 * @file editor-screen.js
 * @description Screen factory responsible for rendering and binding UI for a specific screen.
 * @module screens/editor-screen
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

import { createCaseGeometry } from '../editor/geometry-factory.js';
import { openCaseModal as openSharedCaseModal } from '../ui/overlays/case-modal.js';
import { MIN_SUPPORT_FRACTION } from '../services/pack-library.js';
import { getCaseHandlingSummary, getInstanceHandlingSummary } from '../services/case-rule-summary.js';

// Editor screen + 3D interaction helpers (extracted from src/app.js; behavior preserved)

function caseCountText(count) {
  return `${count} case${count === 1 ? '' : 's'}`;
}

function getDeleteFinalSelection(result) {
  return result && Array.isArray(result.finalSelectionIds) ? result.finalSelectionIds : [];
}

function formatDeleteResultMessage(result, fallbackDeletedIds = []) {
  const deletedIds = result && Array.isArray(result.deletedInstanceIds)
    ? result.deletedInstanceIds
    : [];
  const fallbackCount = Array.isArray(fallbackDeletedIds) ? fallbackDeletedIds.length : 0;
  const deletedCount = deletedIds.length || fallbackCount;
  const dependentCount = result && Array.isArray(result.dependentStagedIds)
    ? result.dependentStagedIds.length
    : 0;
  const repairedCount = result && Array.isArray(result.dependentRepairedIds)
    ? result.dependentRepairedIds.length
    : 0;

  let message = `Deleted ${caseCountText(deletedCount)}.`;
  if (repairedCount) {
    message += ` ${repairedCount} nearby ${caseCountText(repairedCount)} ${repairedCount === 1 ? 'was' : 'were'} re-settled inside the truck.`;
  }
  if (dependentCount) {
    message += ` ${dependentCount} dependent ${caseCountText(dependentCount)} ${dependentCount === 1 ? 'was' : 'were'} moved to staging because their support changed.`;
  }
  return message;
}

function createManualOrientationLockPatch(PackLibrary, CaseLibrary, inst, rotation) {
  const caseData = inst ? CaseLibrary.getById(inst.caseId) : null;
  if (caseData && caseData.dimensions && typeof PackLibrary.createOrientationLockPatch === 'function') {
    return PackLibrary.createOrientationLockPatch(rotation, caseData.dimensions);
  }
  const lockedRotation = typeof PackLibrary.normalizeRightAngleRotation === 'function'
    ? PackLibrary.normalizeRightAngleRotation(rotation)
    : rotation;
  return { orientationLocked: true, lockedRotation };
}

/**
 * Pure gravity simulation: find the settled center Y for a box at the given X,Z position.
 *
 * Rules:
 * - The floor surface (Y = floorY + halfWorld.y) is always valid support. floorY is
 *   normally 0 (main cargo floor), but is raised to the front-overhang deck height
 *   when the candidate's footprint sits over the overhang (see settleY()).
 * - A supporter is accepted only if its XZ overlap covers >= minSupportFraction of the
 *   candidate's footprint. This prevents tiny-corner contact from acting as support.
 * - The highest valid resting surface wins. No upper-bound filter — the caller's
 *   collision check handles cases where the result would penetrate something above.
 *
 * Exported for unit testing. The inner settleY() calls this with live instance state.
 *
 * @param {{ x: number, y: number, z: number }} halfWorld - half-extents in world units
 * @param {number} cx - candidate center X in world units
 * @param {number} cz - candidate center Z in world units
 * @param {Array<{ min: {x,y,z}, max: {x,y,z} }>} otherAabbs - world-space AABBs of other boxes
 * @param {number} minSupportFraction - required XZ overlap fraction (pass MIN_SUPPORT_FRACTION)
 * @param {number} [floorY] - world Y of the floor surface beneath this footprint (default 0)
 * @returns {number} settled center Y in world units (always >= floorY + halfWorld.y)
 */
export function computeSettleY(halfWorld, cx, cz, otherAabbs, minSupportFraction, floorY = 0) {
  const halfX = halfWorld.x;
  const halfY = halfWorld.y;
  const halfZ = halfWorld.z;

  let bestY = floorY + halfY; // floor fallback: center Y = floor surface + half-height

  for (const otherAabb of otherAabbs || []) {
    if (!otherAabb) continue;
    const potentialY = otherAabb.max.y + halfY;
    if (potentialY <= bestY) continue; // not an improvement

    // Compute what fraction of the candidate's footprint is over this supporter's top face.
    const overlapL = Math.max(0, Math.min(cx + halfX, otherAabb.max.x) - Math.max(cx - halfX, otherAabb.min.x));
    const overlapW = Math.max(0, Math.min(cz + halfZ, otherAabb.max.z) - Math.max(cz - halfZ, otherAabb.min.z));
    const overlapArea = overlapL * overlapW;
    const footprintArea = (halfX * 2) * (halfZ * 2);
    const fraction = footprintArea > 1e-9 ? overlapArea / footprintArea : 0;

    if (fraction >= minSupportFraction) {
      bestY = potentialY;
    }
  }

  return bestY;
}

function getUnpackCategoryKey(inst, getCaseById) {
  const caseData = inst && typeof getCaseById === 'function' ? getCaseById(inst.caseId) : null;
  const key = caseData && caseData.category != null ? caseData.category : 'default';
  return String(key || 'default').trim().toLowerCase() || 'default';
}

export function sortInstancesForUnpackStaging(instances, getCaseById) {
  const categoryOrder = new Map();
  const records = (Array.isArray(instances) ? instances : []).map((inst, index) => {
    const categoryKey = getUnpackCategoryKey(inst, getCaseById);
    if (!categoryOrder.has(categoryKey)) categoryOrder.set(categoryKey, categoryOrder.size);
    return { inst, index, categoryKey };
  });

  return records
    .sort((a, b) =>
      (categoryOrder.get(a.categoryKey) - categoryOrder.get(b.categoryKey)) ||
      (a.index - b.index))
    .map(record => record.inst);
}

export function groupInstancesForUnpackStaging(instances, getCaseById) {
  const groups = [];
  const groupByKey = new Map();
  for (const inst of Array.isArray(instances) ? instances : []) {
    const categoryKey = getUnpackCategoryKey(inst, getCaseById);
    let group = groupByKey.get(categoryKey);
    if (!group) {
      group = { categoryKey, instances: [] };
      groupByKey.set(categoryKey, group);
      groups.push(group);
    }
    group.instances.push(inst);
  }
  return groups;
}

export function createCaseScene({
  SceneManager,
  CaseLibrary,
  CategoryService,
  PackLibrary,
  StateStore,
  TrailerGeometry,
  Utils,
  PreferencesManager,
}) {
  const CaseScene = (() => {
    const instances = new Map(); // instanceId -> THREE.Group
    const edgesCache = new Map(); // signature -> { geometry: THREE.EdgesGeometry, count: number }
    const textureCache = new Map(); // signature -> { textures: THREE.CanvasTexture[], count: number }
    let hoveredId = null;
    let draggedId = null;
    let selectedIds = new Set();


    function generateCaseTexture(caseData, faceIndex, w, h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const isPallet = caseData.isPallet === true;
      const catColor = CategoryService.meta(caseData.category).color;
      const baseColor = isPallet ? '#A0522D' : (catColor || caseData.color || '#8B4513');
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, w, h);

      if (isPallet) {
        // Draw wood slat pattern for pallets
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = Math.max(1, w * 0.005);
        ctx.beginPath();
        const slatSpacing = h / 6;
        for (let y = slatSpacing; y < h; y += slatSpacing) {
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = Math.max(2, w * 0.01);
      ctx.strokeRect(2, 2, w - 4, h - 4);
      if (faceIndex === 4 || faceIndex === 5) {
        const faceDims = caseData.dimensions || {};
        if ((faceDims.length || 0) < 3 || (faceDims.height || 0) < 3) {
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        }
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${Math.floor(h * 0.12)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const name = caseData.name || (isPallet ? 'Pallet' : 'Case');
        ctx.fillText(name.substring(0, 16), w / 2, h * 0.4);
        ctx.font = `${Math.floor(h * 0.08)}px Arial, sans-serif`;
        ctx.fillText(`${caseData.weight || 0} lb`, w / 2, h * 0.6);
        if (!caseData.canFlip && !isPallet) {
          ctx.font = `${Math.floor(h * 0.1)}px Arial`;
          ctx.fillText('⇧⇧', w / 2, h * 0.8);
        }
        if (isPallet && caseData.maxPalletWeight > 0) {
          ctx.font = `${Math.floor(h * 0.06)}px Arial, sans-serif`;
          ctx.fillText(`Warning limit: ${caseData.maxPalletWeight} lb`, w / 2, h * 0.8);
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function acquireTextures(signature, caseData, dims) {
      const cached = textureCache.get(signature);
      if (cached) { cached.count += 1; return cached.textures; }
      const lPx = Math.min(512, Math.max(64, dims.length * 4));
      const wPx = Math.min(512, Math.max(64, dims.width * 4));
      const hPx = Math.min(512, Math.max(64, dims.height * 4));
      const textures = [
        generateCaseTexture(caseData, 0, hPx, wPx),
        generateCaseTexture(caseData, 1, hPx, wPx),
        generateCaseTexture(caseData, 2, lPx, wPx),
        generateCaseTexture(caseData, 3, lPx, wPx),
        generateCaseTexture(caseData, 4, lPx, hPx),
        generateCaseTexture(caseData, 5, lPx, hPx),
      ];
      textureCache.set(signature, { textures, count: 1 });
      return textures;
    }

    function releaseTextures(signature) {
      const cached = textureCache.get(signature);
      if (!cached) return;
      cached.count -= 1;
      if (cached.count <= 0) {
        cached.textures.forEach(t => t.dispose());
        textureCache.delete(signature);
      }
    }

    function clear() {
      const scene = SceneManager.getScene();
      if (!scene) return;
      instances.forEach(group => disposeGroup(scene, group));
      instances.clear();
      edgesCache.forEach(entry => entry.geometry.dispose());
      edgesCache.clear();
      textureCache.forEach(entry => entry.textures.forEach(t => t.dispose()));
      textureCache.clear();
      hoveredId = null;
      draggedId = null;
      selectedIds = new Set();
    }

    function sync(pack) {
      const scene = SceneManager.getScene();
      if (!scene) return;
      if (!pack) {
        clear();
        return;
      }

      const keep = new Set();
      (pack.cases || []).forEach(inst => {
        const caseData = CaseLibrary.getById(inst.caseId);
        if (!caseData) return;
        keep.add(inst.id);

        const signature = buildSignature(inst, caseData);
        const existing = instances.get(inst.id);
        if (!existing || existing.userData.signature !== signature) {
          if (existing) disposeGroup(scene, existing);
          const group = createInstanceGroup(inst, caseData);
          instances.set(inst.id, group);
          scene.add(group);
        }

        const group = instances.get(inst.id);
        applyTransform(group, inst);
        applyHidden(group, inst.hidden);
      });

      // Remove old
      Array.from(instances.keys()).forEach(id => {
        if (keep.has(id)) return;
        disposeGroup(scene, instances.get(id));
        instances.delete(id);
      });

      applySelection(Array.from(selectedIds));
      applyHover(hoveredId);
      applyDragging(draggedId);
      if (typeof SceneManager.requestShadowRefresh === 'function') {
        SceneManager.requestShadowRefresh();
      }
    }

    function buildSignature(inst, caseData) {
      const d = caseData.dimensions || { length: 0, width: 0, height: 0 };
      const catColor = CategoryService.meta(caseData.category).color;
      const color = String(catColor || caseData.color || '#ff9f1c');
      return `${caseData.id}:${d.length}x${d.width}x${d.height}:${color}`;
    }

    function acquireEdgeGeometry(signature, boxGeometry) {
      const cached = edgesCache.get(signature);
      if (cached) {
        cached.count += 1;
        return cached.geometry;
      }
      const geometry = new THREE.EdgesGeometry(boxGeometry);
      geometry.userData.edgeCacheKey = signature;
      edgesCache.set(signature, { geometry, count: 1 });
      return geometry;
    }

    function releaseEdgeGeometry(signature) {
      const cached = edgesCache.get(signature);
      if (!cached) return;
      cached.count -= 1;
      if (cached.count <= 0) {
        cached.geometry.dispose();
        edgesCache.delete(signature);
      }
    }

    function createInstanceGroup(inst, caseData) {
      const group = new THREE.Group();
      group.userData.instanceId = inst.id;
      group.userData.caseId = inst.caseId;
      const signature = buildSignature(inst, caseData);
      group.userData.signature = signature;

      const dims = caseData.dimensions || { length: 1, width: 1, height: 1 };
      const lengthW = SceneManager.toWorld(dims.length);
      const widthW = SceneManager.toWorld(dims.width);
      const heightW = SceneManager.toWorld(dims.height);
      group.userData.halfWorld = { x: lengthW / 2, y: heightW / 2, z: widthW / 2 };
      group.userData.baseHalfWorld = { x: lengthW / 2, y: heightW / 2, z: widthW / 2 };

      const catColor = CategoryService.meta(caseData.category).color;
      const baseColor = String(catColor || caseData.color || '#ff9f1c');
      group.userData.baseColor = baseColor;

      const geo = createCaseGeometry(caseData, SceneManager.toWorld);
      const textures = acquireTextures(signature, caseData, dims);
      const materials = textures.map(tex => new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.88,
        metalness: 0.01,
        emissive: new THREE.Color(0x000000),
        envMapIntensity: 0.3,
        bumpScale: 0.02,
      }));
      const mesh = new THREE.Mesh(geo, materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.instanceId = inst.id;
      group.userData.mesh = mesh;
      group.add(mesh);

      const edges = acquireEdgeGeometry(signature, geo);
      const edgeColor = new THREE.Color(baseColor);
      edgeColor.multiplyScalar(0.55);
      const lineMat = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.85,
      });
      const lines = new THREE.LineSegments(edges, lineMat);
      lines.userData.edgeKey = signature;
      group.userData.lines = lines;
      group.userData.edgeColorOriginal = edgeColor.getHex();
      group.add(lines);

      return group;
    }

    function disposeGroup(scene, group) {
      if (!group) return;
      if (group.userData && group.userData.signature) {
        releaseEdgeGeometry(group.userData.signature);
        releaseTextures(group.userData.signature);
      }
      scene.remove(group);
      group.traverse(obj => {
        if (obj.geometry) {
          const cachedKey = obj.geometry.userData && obj.geometry.userData.edgeCacheKey;
          if (!cachedKey) obj.geometry.dispose();
        }
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => {
            if (!m) return;
            if (m.map && m.map.dispose) m.map.dispose();
            if (m.dispose) m.dispose();
          });
        }
      });
    }

    function applyTransform(group, inst) {
      if (!group || !inst || !inst.transform) return;
      const pos = inst.transform.position || { x: 0, y: 0, z: 0 };
      const rot = inst.transform.rotation || { x: 0, y: 0, z: 0 };
      const worldPos = SceneManager.vecInchesToWorld(pos);

      // Always set halfWorld from current effective dimensions so stale values
      // from a previous rotation, AutoPack run, or import cannot persist on a
      // reused THREE.Group. Uses orientedDims when present (rotated/AutoPacked),
      // otherwise resets to the base case dimensions stored at group creation.
      if (inst.orientedDims) {
        group.userData.halfWorld = {
          x: SceneManager.toWorld(inst.orientedDims.length) / 2,
          y: SceneManager.toWorld(inst.orientedDims.height) / 2,
          z: SceneManager.toWorld(inst.orientedDims.width) / 2,
        };
      } else if (group.userData.baseHalfWorld) {
        group.userData.halfWorld = { ...group.userData.baseHalfWorld };
      }

      const halfY = group.userData.halfWorld ? group.userData.halfWorld.y : 0;
      worldPos.y = Math.max(halfY || 0.01, worldPos.y);
      group.position.copy(worldPos);
      group.rotation.set(Number(rot.x) || 0, Number(rot.y) || 0, Number(rot.z) || 0);
    }

    function applyHidden(group, hidden) {
      if (!group || !group.userData.mesh) return;
      const prefs = PreferencesManager.get();
      const mesh = group.userData.mesh;
      const lines = group.userData.lines;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hiddenOpacity = Utils.clamp(Number(prefs.hiddenCaseOpacity) || 0.3, 0, 1);
      if (hidden) {
        mats.forEach(m => {
          if (!m) return;
          m.transparent = true;
          m.opacity = hiddenOpacity;
          m.depthWrite = false;
          m.needsUpdate = true;
        });
        if (lines && lines.material) {
          lines.material.transparent = true;
          lines.material.opacity = Math.max(0.25, hiddenOpacity);
        }
      } else {
        mats.forEach(m => {
          if (!m) return;
          m.transparent = false;
          m.opacity = 1;
          m.depthWrite = true;
          m.needsUpdate = true;
        });
        if (lines && lines.material) {
          lines.material.transparent = true;
          lines.material.opacity = 0.95;
        }
      }
    }

    function applySelection(ids) {
      selectedIds = new Set(ids || []);
      instances.forEach(group => {
        const mesh = group.userData.mesh;
        if (!mesh || !mesh.material) return;
        const isSelected = selectedIds.has(group.userData.instanceId);
        const accent = Utils.getCssVar('--accent-primary') || '#ff9f1c';
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
          if (m && m.emissive && typeof m.emissive.set === 'function') {
            m.emissive.set(isSelected ? accent : '#000000');
          }
        });
      });
    }

    function applyHover(instanceId) {
      hoveredId = instanceId || null;
      instances.forEach(group => {
        const mesh = group.userData.mesh;
        if (!mesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (
          group.userData.instanceId === hoveredId &&
          !selectedIds.has(hoveredId) &&
          group.userData.instanceId !== draggedId
        ) {
          mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0x333333); });
        } else if (!selectedIds.has(group.userData.instanceId) && group.userData.instanceId !== draggedId) {
          mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0x000000); });
        }
      });
    }

    function applyDragging(instanceId) {
      const prevDraggedId = draggedId;
      draggedId = instanceId || null;
      instances.forEach(group => {
        const mesh = group.userData.mesh;
        if (!mesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const gid = group.userData.instanceId;
        if (gid === draggedId) {
          mats.forEach(m => {
            if (!m) return;
            m.transparent = true;
            m.opacity = 0.72;
            m.needsUpdate = true;
            if (m.emissive && typeof m.emissive.setHex === 'function') {
              m.emissive.setHex(0x111111);
            }
          });
        } else if (gid === prevDraggedId && prevDraggedId) {
          // Reset previously dragged item
          mats.forEach(m => {
            if (!m) return;
            m.transparent = false;
            m.opacity = 1;
            m.depthWrite = true;
            m.needsUpdate = true;
          });
        }
      });
    }

    function setCollision(instanceId, isCollision) {
      const group = instances.get(instanceId);
      if (!group || !group.userData.mesh) return;
      const mesh = group.userData.mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (isCollision) {
        mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0xff0000); });
      } else if (selectedIds.has(instanceId)) {
        const accent = Utils.getCssVar('--accent-primary') || '#ff9f1c';
        mats.forEach(m => { if (m && m.emissive) m.emissive.set(accent); });
      } else {
        mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0x000000); });
      }
    }

    function setHover(instanceId) {
      applyHover(instanceId);
    }

    function setSelected(instanceIds) {
      applySelection(instanceIds);
      applyHover(hoveredId);
    }

    function setDragging(instanceId) {
      applyDragging(instanceId);
      applyHover(hoveredId);
      applySelection(Array.from(selectedIds));
    }

    function getObject(instanceId) {
      return instances.get(instanceId) || null;
    }

    function getRaycastMeshes() {
      const meshes = [];
      instances.forEach(group => {
        if (group.userData.mesh) meshes.push(group.userData.mesh);
      });
      return meshes;
    }

    function getAabbWorld(instanceId, positionOverrideWorld) {
      const group = instances.get(instanceId);
      if (!group) return null;
      const half = group.userData.halfWorld;
      if (!half) return null;
      const p = positionOverrideWorld || group.position;
      return {
        min: { x: p.x - half.x, y: p.y - half.y, z: p.z - half.z },
        max: { x: p.x + half.x, y: p.y + half.y, z: p.z + half.z },
      };
    }

    function aabbWorldToInches(aabb) {
      return {
        min: {
          x: SceneManager.toInches(aabb.min.x),
          y: SceneManager.toInches(aabb.min.y),
          z: SceneManager.toInches(aabb.min.z),
        },
        max: {
          x: SceneManager.toInches(aabb.max.x),
          y: SceneManager.toInches(aabb.max.y),
          z: SceneManager.toInches(aabb.max.z),
        },
      };
    }

    function aabbIntersects(a, b) {
      const EPS = 1e-6;
      return (
        a.min.x < b.max.x - EPS &&
        a.max.x > b.min.x + EPS &&
        a.min.y < b.max.y - EPS &&
        a.max.y > b.min.y + EPS &&
        a.min.z < b.max.z - EPS &&
        a.max.z > b.min.z + EPS
      );
    }

    function isInsideTruck(aabb) {
      const packId = StateStore.get('currentPackId');
      const pack = packId ? PackLibrary.getById(packId) : null;
      const truck = pack && pack.truck ? pack.truck : null;
      if (truck) {
        const zonesInches = TrailerGeometry.getTrailerUsableZones(truck);
        const aabbInches = aabbWorldToInches(aabb);
        return TrailerGeometry.isAabbContainedInAnyZone(aabbInches, zonesInches);
      }

      // Fallback: full rectangular bounds (should only happen before a pack is loaded)
      const bounds = SceneManager.getTruckBoundsWorld();
      if (!bounds) return false;
      return (
        aabb.min.x >= bounds.min.x &&
        aabb.max.x <= bounds.max.x &&
        aabb.min.y >= bounds.min.y &&
        aabb.max.y <= bounds.max.y &&
        aabb.min.z >= bounds.min.z &&
        aabb.max.z <= bounds.max.z
      );
    }

    function intersectsWheelWellBlockedBody(aabb) {
      const packId = StateStore.get('currentPackId');
      const pack = packId ? PackLibrary.getById(packId) : null;
      if (!pack || !pack.truck) return false;
      if (typeof PackLibrary.aabbIntersectsWheelWellBlockedBody !== 'function') return false;
      return PackLibrary.aabbIntersectsWheelWellBlockedBody(aabbWorldToInches(aabb), pack.truck);
    }

    function checkCollision(instanceId, candidateWorldPos, ignoreIds) {
      const aabb = getAabbWorld(instanceId, candidateWorldPos);
      if (!aabb) return { collides: false, insideTruck: false };
      const insideTruck = isInsideTruck(aabb);
      const blockedBody = intersectsWheelWellBlockedBody(aabb);
      if (blockedBody) return { collides: true, insideTruck, blockedBody: true };

      const ignoreSet =
        ignoreIds && typeof ignoreIds.has === 'function'
          ? ignoreIds
          : Array.isArray(ignoreIds)
            ? new Set(ignoreIds)
            : null;

      for (const [otherId] of instances.entries()) {
        if (otherId === instanceId) continue;
        if (ignoreSet && ignoreSet.has(otherId)) continue;
        const otherAabb = getAabbWorld(otherId);
        if (!otherAabb) continue;
        if (aabbIntersects(aabb, otherAabb)) return { collides: true, insideTruck };
      }
      return { collides: false, insideTruck };
    }

    /**
     * Resolve the world-Y of the raised front-overhang deck for a footprint centered at
     * (cx, cz) with the given half-extents, or null if the truck has no front-overhang
     * deck or the footprint is not entirely over it. The cab void below the deck is
     * never a valid floor, so this is the only non-zero floor offset settleY() uses.
     */
    function getFrontOverhangDeckFloorYWorld(cx, cz, halfX, halfZ) {
      const packId = StateStore.get('currentPackId');
      const pack = packId ? PackLibrary.getById(packId) : null;
      const truck = pack && pack.truck ? pack.truck : null;
      if (!truck || truck.shapeMode !== 'frontBonus') return null;
      if (!TrailerGeometry || typeof TrailerGeometry.getFrontBonusZone !== 'function') return null;

      const zoneInches = TrailerGeometry.getFrontBonusZone(truck);
      if (!zoneInches) return null;
      const zoneWorld = TrailerGeometry.zonesInchesToWorld([zoneInches])[0];
      if (!zoneWorld) return null;

      const EPS = 1e-6;
      // Only settle onto the deck when the whole footprint sits over the overhang -
      // a footprint straddling the seam, extending past the front of the deck, or
      // spilling outside the deck's width still rests on the main floor / falls
      // back to the existing floor/support logic.
      const fitsX = cx - halfX >= zoneWorld.min.x - EPS && cx + halfX <= zoneWorld.max.x + EPS;
      const fitsZ = cz - halfZ >= zoneWorld.min.z - EPS && cz + halfZ <= zoneWorld.max.z + EPS;
      if (fitsX && fitsZ) return zoneWorld.min.y;
      return null;
    }

    /** Settle a case down via gravity: find highest valid support surface at current X,Z. */
    function settleY(instanceId) {
      const group = instances.get(instanceId);
      if (!group || !group.userData.halfWorld) return null;

      const otherAabbs = [];
      for (const [otherId, otherGroup] of instances.entries()) {
        if (otherId === instanceId) continue;
        if (!otherGroup || otherGroup.visible === false) continue;
        const otherAabb = getAabbWorld(otherId);
        if (otherAabb) otherAabbs.push(otherAabb);
      }

      const halfWorld = group.userData.halfWorld;
      const deckFloorY = getFrontOverhangDeckFloorYWorld(group.position.x, group.position.z, halfWorld.x, halfWorld.z);

      return computeSettleY(
        halfWorld,
        group.position.x,
        group.position.z,
        otherAabbs,
        MIN_SUPPORT_FRACTION,
        deckFloorY !== null ? deckFloorY : 0,
      );
    }

    function getSnapWallCandidatesWorld() {
      const packId = StateStore.get('currentPackId');
      const pack = packId ? PackLibrary.getById(packId) : null;
      const truck = pack && pack.truck ? pack.truck : null;
      if (
        truck &&
        TrailerGeometry &&
        typeof TrailerGeometry.getTrailerUsableZones === 'function' &&
        typeof TrailerGeometry.zonesInchesToWorld === 'function'
      ) {
        const zonesInches = TrailerGeometry.getTrailerUsableZones(truck);
        const zonesWorld = TrailerGeometry.zonesInchesToWorld(zonesInches);
        const x = [];
        const z = [];
        zonesWorld.forEach(zone => {
          x.push(zone.min.x, zone.max.x);
          z.push(zone.min.z, zone.max.z);
        });
        if (x.length && z.length) return { x, z };
      }

      const bounds = SceneManager.getTruckBoundsWorld();
      if (!bounds) return null;
      return {
        x: [bounds.min.x, bounds.max.x],
        z: [bounds.min.z, bounds.max.z],
      };
    }

    /**
     * Snap a world position to the nearest box edge or truck wall (XZ only).
     * Returns adjusted { x, z } or null if no snap occurred.
     * @param {string} instanceId - The instance being placed
     * @param {{ x: number, y: number, z: number }} worldPos - candidate world position
     * @returns {{ x: number, z: number } | null}
     */
    function snapToNearest(instanceId, worldPos) {
      const group = instances.get(instanceId);
      if (!group || !group.userData.halfWorld) { return null; }
      const half = group.userData.halfWorld;
      const SNAP_DIST = SceneManager.toWorld(2); // 2 inches snap threshold
      let bestX = worldPos.x;
      let bestZ = worldPos.z;
      let snapXDist = SNAP_DIST;
      let snapZDist = SNAP_DIST;
      let snapped = false;

      // My edges
      const myMinX = worldPos.x - half.x;
      const myMaxX = worldPos.x + half.x;
      const myMinZ = worldPos.z - half.z;
      const myMaxZ = worldPos.z + half.z;

      // Snap to truck walls
      const wallCandidates = getSnapWallCandidatesWorld();
      if (wallCandidates) {
        wallCandidates.x.forEach(wall => {
          [
            { myEdge: myMinX, offset: half.x },
            { myEdge: myMaxX, offset: -half.x },
          ].forEach(({ myEdge, offset }) => {
            const dist = Math.abs(myEdge - wall);
            if (dist < snapXDist) {
              snapXDist = dist;
              bestX = wall + offset;
              snapped = true;
            }
          });
        });
        wallCandidates.z.forEach(wall => {
          [
            { myEdge: myMinZ, offset: half.z },
            { myEdge: myMaxZ, offset: -half.z },
          ].forEach(({ myEdge, offset }) => {
            const dist = Math.abs(myEdge - wall);
            if (dist < snapZDist) {
              snapZDist = dist;
              bestZ = wall + offset;
              snapped = true;
            }
          });
        });
      }

      // Snap to other box edges
      for (const [otherId, otherGroup] of instances.entries()) {
        if (otherId === instanceId) { continue; }
        if (!otherGroup || otherGroup.visible === false) { continue; }
        const otherAabb = getAabbWorld(otherId);
        if (!otherAabb) { continue; }

        // X-axis snap: my left→other right, my right→other left
        const dxA = Math.abs(myMinX - otherAabb.max.x);
        if (dxA < snapXDist) { snapXDist = dxA; bestX = otherAabb.max.x + half.x; snapped = true; }
        const dxB = Math.abs(myMaxX - otherAabb.min.x);
        if (dxB < snapXDist) { snapXDist = dxB; bestX = otherAabb.min.x - half.x; snapped = true; }

        // Z-axis snap: my front→other back, my back→other front
        const dzA = Math.abs(myMinZ - otherAabb.max.z);
        if (dzA < snapZDist) { snapZDist = dzA; bestZ = otherAabb.max.z + half.z; snapped = true; }
        const dzB = Math.abs(myMaxZ - otherAabb.min.z);
        if (dzB < snapZDist) { snapZDist = dzB; bestZ = otherAabb.min.z - half.z; snapped = true; }
      }

      return snapped ? { x: bestX, z: bestZ } : null;
    }

    /** Highlight instances that are out-of-gauge (outside truck bounds). */
    const oogSet = new Set();
    function applyOOGHighlights() {
      const prevOog = new Set(oogSet);
      oogSet.clear();
      for (const [id, group] of instances.entries()) {
        if (!group || !group.userData.mesh) continue;
        // Skip hidden instances
        if (group.visible === false) continue;
        const aabb = getAabbWorld(id);
        if (!aabb) continue;
        const inside = isInsideTruck(aabb);
        if (!inside) oogSet.add(id);
      }
      // Remove highlight from previously OOG instances that are now OK
      for (const id of prevOog) {
        if (!oogSet.has(id) && !selectedIds.has(id)) {
          const group = instances.get(id);
          if (!group || !group.userData.mesh) continue;
          const mesh = group.userData.mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0x000000); });
          // Restore edge line color
          const lines = group.userData.lines;
          if (lines && lines.material) {
            lines.material.color.set(group.userData.edgeColorOriginal || 0x333333);
          }
        }
      }
      // Apply red-orange tint to OOG instances
      for (const id of oogSet) {
        if (selectedIds.has(id)) continue; // selection takes priority
        const group = instances.get(id);
        if (!group || !group.userData.mesh) continue;
        const mesh = group.userData.mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => { if (m && m.emissive) m.emissive.setHex(0xcc3300); });
        // Make edge lines red
        const lines = group.userData.lines;
        if (lines && lines.material) {
          if (!group.userData.edgeColorOriginal) {
            group.userData.edgeColorOriginal = lines.material.color.getHex();
          }
          lines.material.color.setHex(0xff0000);
        }
      }
    }

    return {
      clear,
      sync,
      setHover,
      setSelected,
      setDragging,
      setCollision,
      getObject,
      getRaycastMeshes,
      getAabbWorld,
      checkCollision,
      isInsideTruck,
      applyOOGHighlights,
      settleY,
      snapToNearest,
    };
  })();

  return CaseScene;
}

export function createInteractionManager({
  SceneManager,
  CaseScene,
  StateStore,
  PackLibrary,
  CaseLibrary,
  PreferencesManager,
  UIComponents,
  OperationLifecycle = null,
}) {
  const InteractionManager = (() => {
    // True while a mutating editor operation (AutoPack / Unpack / Truck Change /
    // preview capture) owns the editor. Direct scene mutations must not run then —
    // but camera orbit/pan/zoom (OrbitControls, separate from these handlers) and
    // hover/selection stay available.
    function operationsBusy() {
      return Boolean(OperationLifecycle && OperationLifecycle.isBusy());
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragOffset = new THREE.Vector3();
    const tmpVec3 = new THREE.Vector3();

    let domEl = null;
    let hoveredId = null;
    let pressed = null;
    let draggingId = null;
    let dragStartPosWorld = null;
    let dragGroupIds = null;
    let dragGroupStartWorld = null; // Map<instanceId, THREE.Vector3>
    let lastRaycastTime = 0;
    const RAYCAST_THROTTLE = 50; // ms - throttle hover raycasts

    function initInteraction(canvasEl) {
      domEl = canvasEl;
      domEl.classList.add('tp3d-editor-no-touch-action');
      domEl.addEventListener('pointermove', onMove);
      domEl.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      domEl.addEventListener('dblclick', onDblClick);
      window.addEventListener('keydown', onKeyDown);
    }

    function rejectMoveCollision(instanceId, candidateWorld, ignoreSet) {
      const check = CaseScene.checkCollision(instanceId, candidateWorld, ignoreSet);
      CaseScene.setCollision(instanceId, check.collides);
      if (!check.collides) return false;
      UIComponents.showToast('Cannot place here: collision detected', 'error');
      return true;
    }

    function commitCasesWithManualRevalidation(packId, nextCases) {
      if (typeof PackLibrary.updateCasesWithManualRevalidation === 'function') {
        return PackLibrary.updateCasesWithManualRevalidation(packId, nextCases, CaseLibrary.getCases());
      }
      return PackLibrary.update(packId, { cases: nextCases });
    }

    function applyInstancePatches(pack, patchById) {
      return (pack.cases || []).map(inst => {
        const patch = patchById.get(inst.id);
        return patch ? { ...inst, ...patch } : inst;
      });
    }

    /**
     * Rotate selected instances by delta on given axis, then apply gravity.
     */
    function rotateSelection(axis, delta) {
      if (operationsBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Editor' });
        return;
      }
      const ids = getSelection();
      if (!ids.length) { return; }
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) { return; }
      let rotatedCount = 0;
      let blockedCount = 0;
      let policyBlockedCount = 0;
      const patchById = new Map();
      ids.forEach(id => {
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst) { return; }
        const rot = { ...(inst.transform.rotation || { x: 0, y: 0, z: 0 }) };
        rot[axis] = ((Number(rot[axis]) || 0) + delta) % (2 * Math.PI);
        const lockPatch = createManualOrientationLockPatch(PackLibrary, CaseLibrary, inst, rot);
        const lockedRotation = lockPatch.lockedRotation || rot;
        const caseData = CaseLibrary.getById(inst.caseId);
        if (!caseData || !PackLibrary.isOrientationAllowedByCasePolicy(caseData, lockedRotation)) {
          policyBlockedCount += 1;
          return;
        }
        const obj = CaseScene.getObject(id);
        if (obj) {
          const originalWorld = obj.position.clone();
          const originalRotation = obj.rotation.clone();
          const originalHalfWorld = obj.userData && obj.userData.halfWorld
            ? { ...obj.userData.halfWorld }
            : null;
          const ignoreSet = new Set([id]);
          const originalInsideTruck = CaseScene.checkCollision(id, obj.position, ignoreSet).insideTruck;
          if (lockPatch.orientedDims && obj.userData) {
            obj.userData.halfWorld = {
              x: SceneManager.toWorld(lockPatch.orientedDims.length) / 2,
              y: SceneManager.toWorld(lockPatch.orientedDims.height) / 2,
              z: SceneManager.toWorld(lockPatch.orientedDims.width) / 2,
            };
          }
          obj.rotation.set(
            Number(lockedRotation.x) || 0,
            Number(lockedRotation.y) || 0,
            Number(lockedRotation.z) || 0
          );
          const settledY = CaseScene.settleY(id);
          if (settledY !== null) {
            const halfY = obj.userData && obj.userData.halfWorld ? obj.userData.halfWorld.y : 0;
            obj.position.y = Math.max(settledY, halfY || settledY);
          }
          const check = CaseScene.checkCollision(id, obj.position, ignoreSet);
          const posInches = SceneManager.vecWorldToInches(obj.position);
          if (check.collides || (originalInsideTruck && !check.insideTruck)) {
            obj.position.copy(originalWorld);
            obj.rotation.copy(originalRotation);
            if (originalHalfWorld && obj.userData) obj.userData.halfWorld = originalHalfWorld;
            const restoredCheck = CaseScene.checkCollision(id, obj.position, ignoreSet);
            CaseScene.setCollision(id, restoredCheck.collides);
            blockedCount += 1;
            return;
          }
          CaseScene.setCollision(id, false);
          patchById.set(id, {
            ...lockPatch,
            transform: { ...inst.transform, rotation: lockedRotation, position: posInches },
            placement: check.insideTruck ? 'packed' : 'staged',
          });
          rotatedCount += 1;
          return;
        }
        patchById.set(id, {
          ...lockPatch,
          transform: { ...inst.transform, rotation: lockedRotation },
        });
        rotatedCount += 1;
      });
      if (patchById.size) {
        commitCasesWithManualRevalidation(packId, applyInstancePatches(pack, patchById));
      }
      if (rotatedCount) UIComponents.showToast(`Rotated ${rotatedCount} case(s)`, 'info');
      if (blockedCount) UIComponents.showToast('Cannot rotate here: collision or truck boundary detected', 'error');
      // The block here comes from the CASE orientation policy (upright / on-side),
      // not an exact instance lock — keep the wording accurate.
      if (policyBlockedCount) UIComponents.showToast("Cannot rotate: the case's orientation policy does not allow this rotation.", 'error');
    }

    /**
     * Nudge selected instances by delta inches on given world axis.
     */
    function nudgeSelection(axis, deltaInches) {
      if (operationsBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Editor' });
        return;
      }
      const ids = getSelection();
      if (!ids.length) { return; }
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) { return; }
      const ignoreSet = new Set(ids);
      const patchById = new Map();
      ids.forEach(id => {
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst) { return; }
        const pos = { ...(inst.transform.position || { x: 0, y: 0, z: 0 }) };
        pos[axis] = (Number(pos[axis]) || 0) + deltaInches;
        const obj = CaseScene.getObject(id);
        const originalWorld = obj ? obj.position.clone() : null;
        const candidateWorld = SceneManager.vecInchesToWorld(pos);
        if (rejectMoveCollision(id, candidateWorld, ignoreSet)) return;

        let finalPos = pos;
        if (obj) {
          obj.position.copy(candidateWorld);
          const settledY = CaseScene.settleY(id);
          if (settledY !== null) obj.position.y = settledY;
          if (rejectMoveCollision(id, obj.position, ignoreSet)) {
            if (originalWorld) obj.position.copy(originalWorld);
            return;
          }
          finalPos = SceneManager.vecWorldToInches(obj.position);
        }
        CaseScene.setCollision(id, false);
        patchById.set(id, { transform: { ...inst.transform, position: finalPos } });
      });
      if (patchById.size) {
        commitCasesWithManualRevalidation(packId, applyInstancePatches(pack, patchById));
      }
    }

    /**
     * Keyboard shortcuts for selected cases.
     * R = rotate Y 90°, T = tip X 90°, E = roll Z 90°, F = flip
     * Arrow keys = nudge X/Z, Shift+Arrow = nudge Y
     * Delete/Backspace = delete selection
     */
    function onKeyDown(ev) {
      if (!isEditorActive()) { return; }
      // Don't intercept when typing in an input
      const tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }

      const halfPI = Math.PI / 2;
      const nudge = 1; // 1 inch per press

      switch (ev.key) {
        case 'r':
        case 'R':
          rotateSelection('y', halfPI);
          ev.preventDefault();
          break;
        case 't':
        case 'T':
          rotateSelection('x', halfPI);
          ev.preventDefault();
          break;
        case 'e':
        case 'E':
          rotateSelection('z', halfPI);
          ev.preventDefault();
          break;
        case 'f':
        case 'F':
          rotateSelection('x', Math.PI);
          ev.preventDefault();
          break;
        case 'ArrowLeft':
          nudgeSelection('z', ev.shiftKey ? 0 : -nudge);
          if (ev.shiftKey) { nudgeSelection('y', nudge); }
          ev.preventDefault();
          break;
        case 'ArrowRight':
          nudgeSelection('z', ev.shiftKey ? 0 : nudge);
          if (ev.shiftKey) { nudgeSelection('y', -nudge); }
          ev.preventDefault();
          break;
        case 'ArrowUp':
          nudgeSelection('x', nudge);
          ev.preventDefault();
          break;
        case 'ArrowDown':
          nudgeSelection('x', -nudge);
          ev.preventDefault();
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelection();
          ev.preventDefault();
          break;
        default:
          break;
      }
    }

    function onMove(ev) {
      if (!isEditorActive()) return;
      updatePointer(ev);

      if (pressed && !draggingId) {
        const dx = ev.clientX - pressed.clientX;
        const dy = ev.clientY - pressed.clientY;
        if (Math.hypot(dx, dy) > 3) startDrag();
      }

      if (draggingId) {
        updateDrag(ev);
        return;
      }

      // Throttle hover raycasts to avoid performance hits
      const now = performance.now();
      if (now - lastRaycastTime < RAYCAST_THROTTLE) return;
      lastRaycastTime = now;

      const hit = raycastFirst();
      const nextHover = hit ? hit.instanceId : null;
      if (nextHover !== hoveredId) {
        hoveredId = nextHover;
        CaseScene.setHover(hoveredId);
        domEl.style.cursor = hoveredId ? 'grab' : 'default';
      }
    }

    function onDown(ev) {
      if (!isEditorActive()) return;
      if (ev.button !== 0) return;
      updatePointer(ev);
      const hit = raycastFirst();

      if (hit) {
        const instanceId = hit.instanceId;
        pressed = {
          instanceId,
          pointWorld: hit.pointWorld.clone(),
          clientX: ev.clientX,
          clientY: ev.clientY,
          shift: Boolean(ev.shiftKey),
        };
        domEl.setPointerCapture(ev.pointerId);
        domEl.style.cursor = 'grabbing';
      } else {
        pressed = {
          instanceId: null,
          clientX: ev.clientX,
          clientY: ev.clientY,
          shift: Boolean(ev.shiftKey),
        };
      }
    }

    function onUp() {
      if (!isEditorActive()) return;
      if (!pressed && !draggingId) return;

      if (draggingId) {
        finishDrag();
        return;
      }

      // Click selection
      if (!pressed.instanceId) {
        if (!pressed.shift) setSelection([]);
        pressed = null;
        return;
      }
      const current = getSelection();
      const id = pressed.instanceId;
      if (pressed.shift) {
        if (current.includes(id)) setSelection(current.filter(x => x !== id));
        else setSelection([...current, id]);
      } else {
        setSelection([id]);
      }
      pressed = null;
    }

    function onDblClick(ev) {
      if (!isEditorActive()) return;
      updatePointer(ev);
      const hit = raycastFirst();
      if (!hit) return;
      SceneManager.focusOnWorldPoint(hit.pointWorld, { duration: 700 });
    }

    function startDrag() {
      if (!pressed || !pressed.instanceId) return;
      // Do not begin moving a case while a mutating operation owns the editor. Click
      // selection (handled in onUp) still works; camera orbit is unaffected.
      if (operationsBusy()) return;
      draggingId = pressed.instanceId;
      dragStartPosWorld = CaseScene.getObject(draggingId).position.clone();

      // Ensure selected
      const current = getSelection();
      if (!current.includes(draggingId)) {
        if (pressed.shift) setSelection([...current, draggingId]);
        else setSelection([draggingId]);
      }

      const controls = SceneManager.getControls();
      if (controls) controls.enabled = false;

      // Group drag: if multiple selected, move them as a unit.
      // We record world positions at drag-start and apply the same delta to each.
      const selection = getSelection();
      dragGroupIds = selection && selection.length ? selection.slice() : [draggingId];
      dragGroupStartWorld = new Map();
      dragGroupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        if (o) dragGroupStartWorld.set(id, o.position.clone());
      });

      dragPlane.set(new THREE.Vector3(0, 1, 0), -dragStartPosWorld.y);
      dragOffset.copy(CaseScene.getObject(draggingId).position).sub(pressed.pointWorld);

      CaseScene.setDragging(draggingId);
    }

    function updateDrag(ev) {
      const camera = SceneManager.getCamera();
      if (!camera) return;
      raycaster.setFromCamera(pointer, camera);

      const obj = CaseScene.getObject(draggingId);
      if (!obj) return;

      const groupIds = Array.isArray(dragGroupIds) && dragGroupIds.length ? dragGroupIds : [draggingId];
      const ignoreSet = new Set(groupIds);
      const startMap = dragGroupStartWorld || new Map([[draggingId, dragStartPosWorld]]);

      // Alt/Option key: vertical (Y-axis) drag mode
      const altKey = ev && ev.altKey;
      if (altKey) {
        // Use a plane facing the camera for vertical movement
        const camDir = camera.getWorldDirection(new THREE.Vector3());
        const vertPlaneNormal = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
        if (vertPlaneNormal.length() < 0.01) vertPlaneNormal.set(0, 0, 1);
        const vertPlane = new THREE.Plane();
        vertPlane.setFromNormalAndCoplanarPoint(vertPlaneNormal, obj.position);
        const intersection = tmpVec3;
        const ok = raycaster.ray.intersectPlane(vertPlane, intersection);
        if (!ok) return;
        const nextY = intersection.y + dragOffset.y;

        const start = startMap.get(draggingId) || obj.position;
        const deltaY = nextY - start.y;

        let anyCollides = false;
        groupIds.forEach(id => {
          const o = CaseScene.getObject(id);
          const s = startMap.get(id);
          if (!o || !s) return;
          const half = o.userData && o.userData.halfWorld ? o.userData.halfWorld.y : 0;
          const candidate = new THREE.Vector3(s.x, Math.max(half || 0.01, s.y + deltaY), s.z);
          const check = CaseScene.checkCollision(id, candidate, ignoreSet);
          anyCollides = anyCollides || check.collides;
          CaseScene.setCollision(id, check.collides);
          o.position.copy(candidate);
        });

        if (!anyCollides) {
          groupIds.forEach(id => CaseScene.setCollision(id, false));
        }
        return;
      }

      const intersection = tmpVec3;
      const ok = raycaster.ray.intersectPlane(dragPlane, intersection);
      if (!ok) return;

      const next = intersection.clone().add(dragOffset);
      // Clamp Y to floor
      const halfYW = obj.userData && obj.userData.halfWorld ? obj.userData.halfWorld.y : 0.01;
      next.y = Math.max(halfYW, next.y);

      // Snap (X/Z) when enabled
      const prefs = PreferencesManager.get();
      if (prefs.snapping && prefs.snapping.enabled) {
        const gridIn = Math.max(0.25, Number(prefs.snapping.gridSize) || 1);
        const gridW = SceneManager.toWorld(gridIn);
        next.x = Math.round(next.x / gridW) * gridW;
        next.z = Math.round(next.z / gridW) * gridW;
      }

      const start = startMap.get(draggingId) || dragStartPosWorld;
      const deltaX = next.x - start.x;
      const deltaZ = next.z - start.z;

      let anyCollides = false;
      groupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        const s = startMap.get(id);
        if (!o || !s) return;
        const half = o.userData && o.userData.halfWorld ? o.userData.halfWorld.y : 0.01;
        const candidate = new THREE.Vector3(s.x + deltaX, Math.max(half, s.y), s.z + deltaZ);
        const check = CaseScene.checkCollision(id, candidate, ignoreSet);
        anyCollides = anyCollides || check.collides;
        CaseScene.setCollision(id, check.collides);
        o.position.copy(candidate);
      });

      if (!anyCollides) {
        groupIds.forEach(id => CaseScene.setCollision(id, false));
      }
    }

    /**
     * Tween (or snap) a drag group's objects back to their pre-drag world
     * positions, clearing collision/drag highlight state once settled.
     */
    function revertGroupToStart(groupIds, startMap) {
      const Tween = window.TWEEN || null;
      groupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        const s = startMap.get(id);
        if (!o || !s) return;
        if (Tween) {
          new Tween.Tween(o.position)
            .to({ x: s.x, y: s.y, z: s.z }, 240)
            .easing(Tween.Easing.Cubic.Out)
            .start();
        } else {
          o.position.copy(s);
        }
        CaseScene.setCollision(id, false);
      });

      if (Tween) {
        // Ensure hover/drag visuals restore once the tweens complete.
        window.setTimeout(() => {
          CaseScene.setDragging(null);
          CaseScene.setHover(hoveredId);
        }, 260);
      } else {
        CaseScene.setDragging(null);
        CaseScene.setHover(hoveredId);
      }
    }

    function finishDrag() {
      const instanceId = draggingId;
      const obj = CaseScene.getObject(instanceId);
      if (!obj) {
        resetDrag();
        return;
      }
      // Defensive: if an operation claimed the editor mid-drag, do not commit the
      // moved transform — restore the scene from committed state and drop the drag.
      if (operationsBusy()) {
        resetDrag();
        CaseScene.sync(PackLibrary.getById(StateStore.get('currentPackId')));
        return;
      }

      const groupIds = Array.isArray(dragGroupIds) && dragGroupIds.length ? dragGroupIds : [instanceId];
      const ignoreSet = new Set(groupIds);
      const startMap = dragGroupStartWorld || new Map([[instanceId, dragStartPosWorld]]);

      // Snap to nearest box edge or truck wall before final placement
      const prefs = PreferencesManager.get();
      if (prefs.snapping && prefs.snapping.enabled) {
        const snap = CaseScene.snapToNearest(instanceId, obj.position);
        if (snap) {
          const start = startMap.get(instanceId) || dragStartPosWorld;
          const deltaX = snap.x - start.x;
          const deltaZ = snap.z - start.z;
          groupIds.forEach(id => {
            const o = CaseScene.getObject(id);
            const s = startMap.get(id);
            if (!o || !s) return;
            o.position.x = s.x + deltaX;
            o.position.z = s.z + deltaZ;
          });
        }
      }

      let anyCollides = false;
      let anyInsideTruck = false;
      groupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        if (!o) return;
        const check = CaseScene.checkCollision(id, o.position, ignoreSet);
        anyCollides = anyCollides || check.collides;
        anyInsideTruck = anyInsideTruck || check.insideTruck;
        CaseScene.setCollision(id, check.collides);
      });

      if (anyCollides) {
        revertGroupToStart(groupIds, startMap);
        UIComponents.showToast('Cannot place here: collision detected', 'error');
        resetDrag();
        return;
      }

      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) {
        resetDrag();
        return;
      }

      // Gravity: settle selection bottom-up to preserve stacking.
      const sortable = groupIds
        .map(id => ({ id, obj: CaseScene.getObject(id) }))
        .filter(x => x.obj)
        .sort((a, b) => a.obj.position.y - b.obj.position.y);

      sortable.forEach(({ id, obj: o }) => {
        const settledY = CaseScene.settleY(id);
        if (settledY !== null) o.position.y = settledY;
      });

      let settledCollides = false;
      anyInsideTruck = false;
      groupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        if (!o) return;
        const check = CaseScene.checkCollision(id, o.position, ignoreSet);
        settledCollides = settledCollides || check.collides;
        anyInsideTruck = anyInsideTruck || check.insideTruck;
        CaseScene.setCollision(id, check.collides);
      });

      if (settledCollides) {
        revertGroupToStart(groupIds, startMap);
        UIComponents.showToast('Cannot place here: collision detected', 'error');
        resetDrag();
        return;
      }

      // IMPORTANT: Update the pack in one shot.
      // Calling PackLibrary.updateInstance() in a loop triggers a render/sync each time,
      // which can reset the other selected objects back to their old positions mid-drop.
      const nextPositions = new Map();
      groupIds.forEach(id => {
        const o = CaseScene.getObject(id);
        if (!o) return;
        const posInches = SceneManager.vecWorldToInches(o.position);
        const halfYWorld = o.userData && o.userData.halfWorld ? o.userData.halfWorld.y : 0;
        const halfYInches = halfYWorld > 0 ? SceneManager.toInches(halfYWorld) : 1;
        posInches.y = Math.max(halfYInches, posInches.y);
        nextPositions.set(id, posInches);
      });

      const zonesInches = PackLibrary.getTrailerUsableZones(pack.truck);
      const placementById = new Map();
      groupIds.forEach(id => {
        const pos = nextPositions.get(id);
        if (!pos) return;
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst) return;
        const c = CaseLibrary.getById(inst.caseId);
        // Never fabricate physical dimensions for an unresolved (dangling) item.
        // Without a real case definition or stored oriented dims we cannot classify
        // its placement, so leave it as-is rather than invent a 24in cube.
        const dims = inst.orientedDims || (c && c.dimensions) || null;
        if (!dims) return;
        const half = { x: dims.length / 2, y: dims.height / 2, z: dims.width / 2 };
        const aabb = {
          min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
          max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
        };
        placementById.set(id, PackLibrary.isAabbContainedInAnyZone(aabb, zonesInches) ? 'packed' : 'staged');
      });

      const nextCases = (pack.cases || []).map(inst => {
        const pos = nextPositions.get(inst.id);
        if (!pos) return inst;
        const placementValue = placementById.get(inst.id) || 'staged';
        return { ...inst, transform: { ...(inst.transform || {}), position: pos }, placement: placementValue };
      });
      commitCasesWithManualRevalidation(packId, nextCases);

      UIComponents.showToast(
        anyInsideTruck ? `Placed ${groupIds.length} case(s)` : `Placed ${groupIds.length} case(s) in staging`,
        anyInsideTruck ? 'success' : 'info'
      );
      resetDrag();
      CaseScene.applyOOGHighlights();
    }

    function resetDrag() {
      const controls = SceneManager.getControls();
      if (controls) controls.enabled = true;
      draggingId = null;
      dragStartPosWorld = null;
      dragGroupIds = null;
      dragGroupStartWorld = null;
      pressed = null;
      domEl.style.cursor = hoveredId ? 'grab' : 'default';
      CaseScene.setDragging(null);
    }

    function updatePointer(ev) {
      if (!domEl) return;
      const rect = domEl.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function raycastFirst() {
      const camera = SceneManager.getCamera();
      if (!camera) return null;
      raycaster.setFromCamera(pointer, camera);
      const meshes = CaseScene.getRaycastMeshes();
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      const hit = hits[0];
      const instanceId = hit.object && hit.object.userData ? hit.object.userData.instanceId : null;
      if (!instanceId) return null;
      return { instanceId, pointWorld: hit.point.clone() };
    }

    function isEditorActive() {
      return StateStore.get('currentScreen') === 'editor';
    }

    function getSelection() {
      return StateStore.get('selectedInstanceIds') || [];
    }

    function setSelection(nextIds) {
      StateStore.set({ selectedInstanceIds: nextIds }, { skipHistory: true });
      CaseScene.setSelected(nextIds);
    }

    function selectAllInPack() {
      const pack = PackLibrary.getById(StateStore.get('currentPackId'));
      if (!pack) return;
      setSelection((pack.cases || []).map(i => i.id));
      UIComponents.showToast(`Selected ${(pack.cases || []).length} case(s)`, 'info');
    }

    function deleteSelection() {
      if (operationsBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Editor' });
        return;
      }
      const ids = getSelection();
      if (!ids.length) return;
      const packId = StateStore.get('currentPackId');
      const result = PackLibrary.removeInstances(packId, ids);
      setSelection(getDeleteFinalSelection(result));
      if (!result) {
        UIComponents.showToast('Delete failed. Please try again.', 'error');
        return;
      }
      UIComponents.showToast(formatDeleteResultMessage(result, ids), 'info');
    }

    return { init: initInteraction, setSelection, selectAllInPack, deleteSelection, rotateSelection };
  })();

  return InteractionManager;
}

export function createEditorScreen({
  StateStore,
  PackLibrary,
  CaseLibrary,
  PreferencesManager,
  UIComponents,
  Utils,
  TrailerGeometry,
  CategoryService,
  AutoPackEngine,
  ExportService,
  SystemOverlay,
  TrailerPresets,
  AppShell,
  SceneManager,
  CaseScene,
  InteractionManager,
  TruckChangeController,
  OperationLifecycle = null,
}) {
  const EditorUI = (() => {
    const shellEl = /** @type {HTMLElement|null} */ (document.querySelector('.editor-shell'));
    const leftEl = /** @type {HTMLElement|null} */ (document.getElementById('editor-left'));
    const rightEl = /** @type {HTMLElement|null} */ (document.getElementById('editor-right'));
    const btnLeft = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-editor-left'));
    const btnRight = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-editor-right'));
    const btnLeftClose = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-left-close'));
    const btnRightClose = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-right-close'));
    const viewportEl = /** @type {HTMLElement|null} */ (document.getElementById('viewport'));
    const inspectorEl = /** @type {HTMLElement|null} */ (document.getElementById('inspector-body'));
    const caseSearchEl = /** @type {HTMLInputElement|null} */ (document.getElementById('editor-case-search'));
    const caseFilterToggleEl = /** @type {HTMLButtonElement|null} */ (document.getElementById('editor-case-filters-toggle'));
    const caseChipsEl = /** @type {HTMLElement|null} */ (document.getElementById('editor-case-chips'));
    const caseListEl = /** @type {HTMLElement|null} */ (document.getElementById('editor-case-list'));
    const btnAutopack = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-autopack'));
    const btnUnpack = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-unpack'));
    const btnShare = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-share'));
    const btnPng = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-screenshot'));
    const btnPdf = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-pdf'));
    const viewportHintBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('viewport-hint-icon'));

    // Swap a button into a visible "working" state (spinner + label) and back. The
    // idle markup is captured once so it can be restored exactly. Pairs with the
    // existing `.btn .fa-spinner` CSS.
    function setButtonWorking(btn, working, workingLabel) {
      if (!btn) return;
      if (working) {
        if (btn.dataset.idleHtml === undefined) btn.dataset.idleHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${workingLabel}`;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
      } else if (btn.dataset.idleHtml !== undefined) {
        btn.innerHTML = btn.dataset.idleHtml;
        delete btn.dataset.idleHtml;
        btn.removeAttribute('aria-busy');
      }
    }

    // Single source of truth for the action-bar button states: spinner on the active
    // operation's button, and every mutating/export control blocked while ANY editor
    // operation is in flight. Called by render() and by the operation-lifecycle
    // subscription so the working state appears the instant an operation begins.
    function refreshActionButtons() {
      const pack = PackLibrary.getById(StateStore.get('currentPackId'));
      const op = OperationLifecycle
        ? OperationLifecycle.currentOperation()
        : { kind: AutoPackEngine.running ? 'autopacking' : 'idle', busy: AutoPackEngine.running };
      const busy = Boolean(op.busy);
      setButtonWorking(btnAutopack, op.kind === 'autopacking', 'Packing…');
      setButtonWorking(btnUnpack, op.kind === 'unpacking', 'Moving to staging…');
      if (btnAutopack && op.kind !== 'autopacking') btnAutopack.disabled = !pack || busy;
      if (btnUnpack && op.kind !== 'unpacking') btnUnpack.disabled = !pack || busy || !(pack && (pack.cases || []).length);
      if (btnShare) btnShare.disabled = !pack || busy;
      if (btnPng) btnPng.disabled = !pack || busy;
      if (btnPdf) btnPdf.disabled = !pack || busy;
    }

    let initialized = false;
    const supportsWebGL = Utils.hasWebGL();
    const browserCats = new Set();
    const browserManufacturers = new Set();
    let activationRaf = null;
    const caseFiltersStorageKey = 'tp3d.editor.caseBrowser.showFilters';
    let showCaseFilters = false;
    let caseBrowserGroupBy = 'category';
    let viewportHintOpen = false;
    // Pending (uncommitted) truck geometry edited via the preset/shape dropdowns.
    // The committed truck stays pack.truck and the scene keeps rendering it until the
    // user clicks "Update truck"; this only pre-fills the inspector form. Tagged with
    // __packId so it is ignored after a pack switch.
    let pendingTruck = null;
    function getEffectiveTruck(pack) {
      return (pendingTruck && pack && pendingTruck.__packId === pack.id) ? pendingTruck : (pack ? pack.truck : null);
    }
    function setPendingTruck(pack, nextTruck) {
      pendingTruck = nextTruck ? { ...nextTruck, __packId: pack.id } : null;
    }
    function clearPendingTruck() {
      pendingTruck = null;
    }
    function hasPendingTruckChange(pack) {
      return Boolean(pendingTruck && pack && pendingTruck.__packId === pack.id) &&
        !TruckChangeController.truckGeometryEqual(pack.truck, pendingTruck);
    }

    function setViewportHintOpen(open) {
      if (!viewportHintBtn) return;
      viewportHintOpen = Boolean(open);
      viewportHintBtn.classList.toggle('is-open', viewportHintOpen);
      viewportHintBtn.setAttribute('aria-expanded', viewportHintOpen ? 'true' : 'false');
    }

    function initEditorUI() {
      if (!supportsWebGL) {
        SystemOverlay.show({
          title: 'Editor unavailable',
          message: 'This device does not support WebGL, so the 3D Editor cannot run here.',
          items: ['Try a different browser (Chrome/Safari)', 'Update iOS/Android', 'Use a desktop device'],
        });
      }

      caseSearchEl.addEventListener('input', Utils.debounce(renderCaseBrowser, 250));
      if (caseFilterToggleEl) {
        const searchWrapEl = caseSearchEl ? caseSearchEl.closest('.tp3d-editor-case-search') : null;
        if (searchWrapEl && caseChipsEl && caseChipsEl.parentElement !== searchWrapEl) {
          searchWrapEl.appendChild(caseChipsEl);
        }
        try {
          const stored = window.localStorage.getItem(caseFiltersStorageKey);
          if (stored === '0') showCaseFilters = false;
        } catch {
          // ignore
        }
        setCaseFiltersVisible(showCaseFilters, false);
        caseFilterToggleEl.addEventListener('click', () => {
          setCaseFiltersVisible(!showCaseFilters, true);
        });
        document.addEventListener('click', ev => {
          if (!showCaseFilters) return;
          if (!(ev.target instanceof Node)) return;
          if (caseFilterToggleEl.contains(ev.target)) return;
          if (caseChipsEl && caseChipsEl.contains(ev.target)) return;
          setCaseFiltersVisible(false, true);
        });
      }
      btnLeft.addEventListener('click', () => togglePanel('left'));
      btnRight.addEventListener('click', () => togglePanel('right'));
      btnLeftClose.addEventListener('click', () => setPanelVisible('left', false));
      btnRightClose.addEventListener('click', () => setPanelVisible('right', false));

      // Keep the action-bar working/spinner/disabled states in lockstep with the
      // authoritative operation lifecycle, so a working state appears the instant any
      // operation (AutoPack/Unpack/Truck Change/preview capture) begins or ends.
      if (OperationLifecycle && typeof OperationLifecycle.subscribe === 'function') {
        OperationLifecycle.subscribe(() => {
          if (StateStore.get('currentScreen') === 'editor') refreshActionButtons();
        });
      }

      btnAutopack.addEventListener('click', async () => {
        // Cross-operation guard: the engine also rejects, but this avoids even
        // queueing a run while another operation owns the editor.
        if (OperationLifecycle && OperationLifecycle.isBusy()) {
          UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'AutoPack' });
          return;
        }
        try {
          await AutoPackEngine.pack();
        } catch (err) {
          console.error('[EditorScreen] AutoPack error:', err);
          UIComponents.showToast('AutoPack failed. Please try again.', 'error');
        } finally {
          render();
        }
      });
      if (btnUnpack) {
        btnUnpack.addEventListener('click', () => {
          Promise.resolve()
            .then(() => unpackAll())
            .catch(err => {
              console.error('[EditorScreen] Unpack error:', err);
              UIComponents.showToast('Unpack failed. Please try again.', 'error', { title: 'Unpack' });
            });
        });
      }
      btnPng.addEventListener('click', () => {
        Promise.resolve()
          .then(() => ExportService.captureScreenshot())
          .catch(err => {
            console.error('[EditorScreen] Screenshot error:', err);
            UIComponents.showToast('Screenshot failed.', 'error');
          });
      });
      btnPdf.addEventListener('click', () => {
        Promise.resolve()
          .then(() => ExportService.generatePDF())
          .catch(err => {
            console.error('[EditorScreen] PDF export error:', err);
            UIComponents.showToast('PDF export failed.', 'error');
          });
      });
      if (btnShare) {
        btnShare.addEventListener('click', ev => {
          ev.stopPropagation();
          UIComponents.openDropdown(
            btnShare,
            [
              { label: 'Screenshot', icon: 'fa-solid fa-camera', onClick: () => btnPng.click() },
              { label: 'Export PDF', icon: 'fa-solid fa-file-pdf', onClick: () => btnPdf.click() },
            ],
            { width: 200, align: 'left', role: 'editor-share' }
          );
        });
      }
      if (viewportHintBtn) {
        viewportHintBtn.addEventListener('click', ev => {
          ev.stopPropagation();
          setViewportHintOpen(!viewportHintOpen);
        });
        viewportHintBtn.addEventListener('keydown', ev => {
          if (ev.key === 'Escape') {
            setViewportHintOpen(false);
            ev.stopPropagation();
            return;
          }
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setViewportHintOpen(!viewportHintOpen);
          }
        });
        document.addEventListener('click', ev => {
          if (!viewportHintOpen) return;
          if (!(ev.target instanceof Node)) return;
          if (viewportHintBtn.contains(ev.target)) return;
          setViewportHintOpen(false);
        });
      }

      const handleViewportChange = Utils.debounce(() => {
        if (StateStore.get('currentScreen') === 'editor') onActivated();
      }, 160);

      window.addEventListener('resize', handleViewportChange);
      window.addEventListener('orientationchange', handleViewportChange);
      if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', handleViewportChange);
      }
    }

    function ensureScene() {
      if (initialized || !supportsWebGL) return;
      SceneManager.init(viewportEl);
      InteractionManager.init(SceneManager.getRenderer().domElement);
      wireDropToViewport(SceneManager.getRenderer().domElement);
      initialized = true;
    }

    function render() {
      if (StateStore.get('currentScreen') !== 'editor') return;
      ensureScene();

      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);

      refreshActionButtons();

      if (!pack) {
        SceneManager.setTruck({ length: 636, width: 102, height: 98 });
        CaseScene.sync(null);
        renderCaseBrowser();
        renderInspectorNoPack();
        SceneManager.resize();
        return;
      }

      SceneManager.setTruck(pack.truck);
      CaseScene.sync(pack);
      CaseScene.setSelected(StateStore.get('selectedInstanceIds') || []);
      CaseScene.applyOOGHighlights();

      renderCaseBrowser();
      renderInspector(pack);
      SceneManager.resize();
    }

    function onActivated() {
      if (!supportsWebGL || !viewportEl) return;
      ensureScene();
      if (activationRaf) {
        window.cancelAnimationFrame(activationRaf);
        activationRaf = null;
      }
      let attempts = 0;
      const maxAttempts = 8;
      const finish = () => {
        activationRaf = null;
        if (typeof SceneManager.resize === 'function') SceneManager.resize();
      };
      const attemptResize = () => {
        attempts += 1;
        const rect = viewportEl.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        if (width > 2 && height > 2) {
          finish();
          return;
        }
        if (attempts >= maxAttempts) {
          finish();
          return;
        }
        activationRaf = window.requestAnimationFrame(attemptResize);
      };
      activationRaf = window.requestAnimationFrame(attemptResize);
    }

    function normalizeBrowserFilterKey(value) {
      return String(value || '')
        .trim()
        .toLowerCase();
    }

    function getManufacturerFilterKey(value) {
      return normalizeBrowserFilterKey(value) || '__no_manufacturer__';
    }

    function getManufacturerFilterLabel(value) {
      return String(value || '').trim() || '(No manufacturer)';
    }

    function getManufacturerFilterColor(value) {
      const key = getManufacturerFilterKey(value);
      if (key === '__no_manufacturer__') return '#9b9ba8';
      const palette = [
        '#f59e0b',
        '#3b82f6',
        '#10b981',
        '#ec4899',
        '#8b5cf6',
        '#14b8a6',
        '#f97316',
        '#6366f1',
        '#84cc16',
        '#ef4444',
      ];
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      }
      return palette[hash % palette.length];
    }

    function getManufacturerFilterOptions(cases) {
      const options = new Map();
      (Array.isArray(cases) ? cases : []).forEach(c => {
        const key = getManufacturerFilterKey(c && c.manufacturer);
        const label = getManufacturerFilterLabel(c && c.manufacturer);
        const existing = options.get(key) || { key, name: label, count: 0, color: getManufacturerFilterColor(label) };
        existing.count += 1;
        options.set(key, existing);
      });
      return Array.from(options.values()).sort((a, b) => {
        if (a.key === '__no_manufacturer__') return 1;
        if (b.key === '__no_manufacturer__') return -1;
        return a.name.localeCompare(b.name);
      });
    }

    function renderCaseBrowser() {
      const browserControlsHost = caseSearchEl ? caseSearchEl.closest('.tp3d-editor-case-search') : null;
      const staleBrowserControls = caseListEl && caseListEl.parentElement
        ? caseListEl.parentElement.querySelector('.tp3d-editor-browser-tabs')
        : null;
      if (staleBrowserControls && browserControlsHost && staleBrowserControls.parentElement !== browserControlsHost) {
        staleBrowserControls.remove();
      }
      if (browserControlsHost && !browserControlsHost.querySelector('.tp3d-editor-browser-tabs')) {
        const tabsEl = document.createElement('div');
        tabsEl.className = 'tp3d-editor-browser-tabs';
        const groupTabsEl = document.createElement('div');
        groupTabsEl.className = 'tp3d-editor-browser-group-tabs';
        const btnCat = document.createElement('button');
        btnCat.type = 'button';
        btnCat.className = 'btn btn-sm tp3d-browser-tab';
        btnCat.dataset.groupBy = 'category';
        btnCat.textContent = 'Category';
        const btnMfg = document.createElement('button');
        btnMfg.type = 'button';
        btnMfg.className = 'btn btn-sm tp3d-browser-tab';
        btnMfg.dataset.groupBy = 'manufacturer';
        btnMfg.textContent = 'Manufacturer';
        groupTabsEl.appendChild(btnCat);
        groupTabsEl.appendChild(btnMfg);
        const btnNewCase = document.createElement('button');
        btnNewCase.type = 'button';
        btnNewCase.className = 'btn btn-sm btn-primary tp3d-editor-new-case-btn';
        btnNewCase.setAttribute('data-role', 'editor-new-case');
        btnNewCase.setAttribute('aria-label', 'New case');
        btnNewCase.setAttribute('title', 'New case');
        btnNewCase.innerHTML = '<i class="fa-solid fa-plus"></i>';
        btnNewCase.addEventListener('click', ev => {
          ev.stopPropagation();
          openEditorNewCaseModal();
        });
        tabsEl.appendChild(groupTabsEl);
        tabsEl.appendChild(btnNewCase);
        const searchRow = browserControlsHost.querySelector('.tp3d-editor-case-search-row');
        if (searchRow && searchRow.nextSibling) browserControlsHost.insertBefore(tabsEl, searchRow.nextSibling);
        else browserControlsHost.appendChild(tabsEl);
        tabsEl.addEventListener('click', ev => {
          if (!(ev.target instanceof Element)) return;
          const btn = ev.target.closest('[data-group-by]');
          if (!(btn instanceof HTMLElement)) return;
          caseBrowserGroupBy = btn.dataset.groupBy;
          renderCaseBrowser();
        });
      }
      const tabBtns = document.querySelectorAll('.tp3d-browser-tab');
      tabBtns.forEach(btn => {
        if (!(btn instanceof HTMLElement)) return;
        btn.classList.toggle('btn-primary', btn.dataset.groupBy === caseBrowserGroupBy);
      });

      const allCases = CaseLibrary.getCases();
      if (CategoryService.resetToDefaultIfNoCases(allCases)) {
        browserCats.clear();
        browserManufacturers.clear();
      }
      const activeBrowserFilters = caseBrowserGroupBy === 'manufacturer' ? browserManufacturers : browserCats;
      const browserFilterOptions = caseBrowserGroupBy === 'manufacturer'
        ? getManufacturerFilterOptions(allCases)
        : CategoryService.listWithCounts(allCases);
      const validFilterKeys = new Set(browserFilterOptions.map(option => option.key));
      Array.from(activeBrowserFilters).forEach(key => {
        if (!validFilterKeys.has(key)) activeBrowserFilters.delete(key);
      });
      const allFilterCount = allCases.length;
      const q = String(caseSearchEl.value || '').trim();
      const prefs = PreferencesManager.get ? PreferencesManager.get() : { units: { length: 'in', weight: 'lb' } };
      const lengthUnit = (prefs.units && prefs.units.length) || 'in';
      const browserPack = PackLibrary.getById(StateStore.get('currentPackId'));
      const selectedInstanceIds = StateStore.get('selectedInstanceIds') || [];
      const selectedCaseIds = new Set();
      if (browserPack && selectedInstanceIds.length) {
        (browserPack.cases || []).forEach(inst => {
          if (selectedInstanceIds.includes(inst.id) && inst.caseId) selectedCaseIds.add(inst.caseId);
        });
      }
      let cases = CaseLibrary.search(q, caseBrowserGroupBy === 'category' ? Array.from(browserCats) : []);
      if (caseBrowserGroupBy === 'manufacturer' && browserManufacturers.size) {
        cases = cases.filter(c => browserManufacturers.has(getManufacturerFilterKey(c && c.manufacturer)));
      }
      cases = cases.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      caseChipsEl.innerHTML = '';
      caseChipsEl.appendChild(
        makeBrowserChip(
          `All: ${allFilterCount}`,
          'all',
          activeBrowserFilters.size === 0,
          () => {
            activeBrowserFilters.clear();
            renderCaseBrowser();
          },
          '#9b9ba8'
        )
      );
      browserFilterOptions.forEach(c => {
        const active = activeBrowserFilters.has(c.key);
        caseChipsEl.appendChild(
          makeBrowserChip(
            `${c.name}: ${c.count}`,
            c.key,
            active,
            () => {
              if (activeBrowserFilters.has(c.key)) activeBrowserFilters.delete(c.key);
              else activeBrowserFilters.add(c.key);
              renderCaseBrowser();
            },
            c.color
          )
        );
      });
      setCaseFiltersVisible(showCaseFilters, false);

      caseListEl.innerHTML = '';
      if (caseBrowserGroupBy === 'manufacturer') {
        const mfgGroups = new Map();
        cases.forEach(c => {
          const key = (c.manufacturer && c.manufacturer.trim()) || '(No manufacturer)';
          if (!mfgGroups.has(key)) mfgGroups.set(key, []);
          mfgGroups.get(key).push(c);
        });
        Array.from(mfgGroups.entries())
          .sort(([a], [b]) => (a === '(No manufacturer)' ? 1 : b === '(No manufacturer)' ? -1 : a.localeCompare(b)))
          .forEach(([groupName, groupCases]) => {
            const hdr = document.createElement('div');
            hdr.className = 'tp3d-editor-mfg-group-header';
            hdr.textContent = groupName;
            caseListEl.appendChild(hdr);
            groupCases.forEach(c => {
              caseListEl.appendChild(buildCaseBrowserCard(c, lengthUnit, prefs, selectedCaseIds.has(c.id)));
            });
          });
        return;
      }
      cases.forEach(c => {
        caseListEl.appendChild(buildCaseBrowserCard(c, lengthUnit, prefs, selectedCaseIds.has(c.id)));
      });
    }

    /**
     * Builds a single Case Browser catalog card (shared by the Category and
     * Manufacturer grouped views). Preserves drag-to-pack and Add behavior.
     */
    function buildCaseBrowserCard(c, lengthUnit, prefs, isSelected) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-padding-12', 'tp3d-editor-card-grid-gap-8', 'tp3d-editor-case-browser-card');
      card.classList.toggle('tp3d-editor-case-browser-card--selected', Boolean(isSelected));
      card.draggable = true;
      card.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('text/plain', c.id);
        ev.dataTransfer.effectAllowed = 'copy';
      });

      const header = document.createElement('div');
      header.className = 'tp3d-editor-card-header';
      const name = document.createElement('div');
      name.classList.add('tp3d-editor-fw-semibold');
      name.textContent = c.name;
      const hasDims =
        c &&
        c.dimensions &&
        Number.isFinite(c.dimensions.length) &&
        Number.isFinite(c.dimensions.width) &&
        Number.isFinite(c.dimensions.height);
      const dimsLabel = hasDims ? Utils.formatDims(c.dimensions, lengthUnit) : '—';
      const catMeta = CategoryService.meta(c.category || 'default');
      const volumeLabel = hasDims
        ? Utils.formatVolume(c.dimensions, lengthUnit)
        : '—';
      const weightNum = Number(c.weight);
      let weightLabel = '—';
      if (Number.isFinite(weightNum)) {
        const weightUnit = (prefs.units && prefs.units.weight) || 'lb';
        weightLabel = weightUnit === 'kg' ? `${(weightNum * 0.453592).toFixed(2)} kg` : `${weightNum.toFixed(2)} lb`;
      }
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary';
      addBtn.type = 'button';
      addBtn.classList.add('tp3d-editor-btn-add');
      addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
      addBtn.addEventListener('click', () => addCaseToPack(c.id));
      header.appendChild(name);
      header.appendChild(addBtn);

      const meta1 = document.createElement('div');
      meta1.className = 'tp3d-editor-card-dims tp3d-editor-case-meta-primary';
      const parts = [dimsLabel, volumeLabel, weightLabel].filter(v => v && v !== '—');
      meta1.textContent = parts.join(' · ');

      const meta2 = document.createElement('div');
      meta2.className = 'tp3d-editor-card-dims tp3d-editor-case-meta-secondary';
      const catInline = document.createElement('span');
      catInline.className = 'tp3d-editor-cat-inline';
      const catDot = document.createElement('span');
      catDot.className = 'chip-dot';
      catDot.style.background = catMeta.color;
      catInline.appendChild(catDot);
      const meta2Parts = [catMeta.name, ...getCaseHandlingSummary(c)];
      catInline.appendChild(document.createTextNode(meta2Parts.join(' · ')));
      meta2.appendChild(catInline);

      card.appendChild(header);
      card.appendChild(meta1);
      card.appendChild(meta2);
      return card;
    }

    function openEditorNewCaseModal() {
      openSharedCaseModal({
        existing: null,
        Utils,
        UIComponents,
        PreferencesManager,
        CaseLibrary,
        CategoryService,
        onSaved: () => {
          if (caseSearchEl) caseSearchEl.value = '';
          browserCats.clear();
          browserManufacturers.clear();
          caseBrowserGroupBy = 'category';
          setCaseFiltersVisible(false, false);
          renderCaseBrowser();
        },
      });
    }

    function setCaseFiltersVisible(nextVisible, persist) {
      showCaseFilters = Boolean(nextVisible);
      if (caseChipsEl) {
        caseChipsEl.hidden = !showCaseFilters;
        caseChipsEl.style.display = showCaseFilters ? '' : 'none';
      }
      if (caseFilterToggleEl) {
        caseFilterToggleEl.setAttribute('aria-pressed', showCaseFilters ? 'true' : 'false');
        caseFilterToggleEl.setAttribute('aria-expanded', showCaseFilters ? 'true' : 'false');
        caseFilterToggleEl.classList.toggle('btn-primary', showCaseFilters);
      }
      if (persist) {
        try {
          window.localStorage.setItem(caseFiltersStorageKey, showCaseFilters ? '1' : '0');
        } catch {
          // ignore
        }
      }
    }

    function makeBrowserChip(label, key, active, onClick, color) {
      const el = document.createElement('div');
      el.className = `chip ${active ? 'active' : ''}`;
      el.tabIndex = 0;
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = color || 'var(--border-strong)';
      const text = document.createElement('span');
      text.textContent = label;
      el.appendChild(dot);
      el.appendChild(text);
      el.addEventListener('click', onClick);
      el.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') onClick();
      });
      return el;
    }

    function makeMiniCategoryChip(categoryKey) {
      const meta = CategoryService.meta(categoryKey || 'default');
      const el = document.createElement('span');
      el.className = 'chip';
      el.classList.add('tp3d-editor-chip-mini');
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = meta.color;
      const text = document.createElement('span');
      text.textContent = meta.name;
      el.appendChild(dot);
      el.appendChild(text);
      return el;
    }

    // True (and toasts) when a mutating editor operation owns the editor, so direct
    // case-list mutations (add / duplicate / delete) from the panels are blocked.
    function editorMutationBlocked() {
      if (OperationLifecycle && OperationLifecycle.isBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Editor' });
        return true;
      }
      return false;
    }

    function setSelectionFromDeleteResult(result) {
      const nextIds = getDeleteFinalSelection(result);
      StateStore.set({ selectedInstanceIds: nextIds }, { skipHistory: true });
      CaseScene.setSelected(nextIds);
    }

    function deleteInstancesWithFeedback(packId, instanceIds) {
      const ids = Array.isArray(instanceIds) ? instanceIds : [];
      if (!ids.length) return null;
      const result = PackLibrary.removeInstances(packId, ids);
      setSelectionFromDeleteResult(result);
      if (!result) {
        UIComponents.showToast('Delete failed. Please try again.', 'error');
        return null;
      }
      UIComponents.showToast(formatDeleteResultMessage(result, ids), 'info');
      return result;
    }

    function addCaseToPack(caseId, positionInches) {
      if (editorMutationBlocked()) return;
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) {
        UIComponents.showToast('Create or open a pack first', 'warning');
        AppShell.navigate('packs');
        return;
      }

      const caseData = CaseLibrary.getById(caseId);
      if (!caseData) return;
      const inst = positionInches
        ? PackLibrary.addInstance(packId, caseId, positionInches)
        : PackLibrary.addInstance(packId, caseId);
      if (inst) {
        StateStore.set({ selectedInstanceIds: [inst.id] }, { skipHistory: true });
        UIComponents.showToast('Case added to pack', 'success');
      }
    }

    async function unpackAll() {
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack || !(pack.cases || []).length) {
        UIComponents.showToast('Nothing to unpack', 'info');
        return;
      }
      if (hasPendingTruckChange(pack)) {
        clearPendingTruck();
        render();
        UIComponents.showToast(
          'Pending truck changes were cleared. Click Unpack again to use the saved truck layout.',
          'info',
          { title: 'Unpack' }
        );
        return;
      }
      // Claim the single mutating-operation slot so AutoPack / Truck Change cannot
      // run concurrently with the (synchronous, O(n^2)) staging computation below.
      const opToken = OperationLifecycle ? OperationLifecycle.beginOperation('unpacking', { packId }) : null;
      if (OperationLifecycle && !opToken) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Unpack' });
        return;
      }
      try {
        // Paint a working state and yield one frame BEFORE the synchronous staging
        // pass so large packs do not look frozen.
        UIComponents.showToast('Organizing staging area…', 'info', { title: 'Unpack' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // Staleness guard: if the user switched pack/screen during that frame, or a
        // newer operation took the slot, abort before committing.
        if (StateStore.get('currentPackId') !== packId || StateStore.get('currentScreen') !== 'editor') return;
        if (OperationLifecycle && !OperationLifecycle.isCurrent(opToken)) return;
        const livePack = PackLibrary.getById(packId);
        if (!livePack) return;

        const stagedById = new Map();
        const stagingLayout = PackLibrary.getStagingLayout(livePack.truck || {});
        const categoryBandGap = stagingLayout.gap * 2;
        let categoryOriginZ = stagingLayout.originZ;
        let movedCount = 0;
        const stagingGroups = groupInstancesForUnpackStaging(
          livePack.cases || [],
          caseId => CaseLibrary.getById(caseId)
        );
        for (const group of stagingGroups) {
          const payload = [];
          for (const inst of group.instances) {
            const c = CaseLibrary.getById(inst.caseId);
            // Respect any oriented dimensions produced by AutoPack (prevents overlap when
            // cases were rotated/flipped while packed). Never fabricate dimensions for an
            // unresolved (dangling) item — leave it untouched rather than invent a cube.
            const canonical = c && typeof PackLibrary.getCanonicalInstanceEffectiveDims === 'function'
              ? PackLibrary.getCanonicalInstanceEffectiveDims(inst, c)
              : null;
            const od = inst && inst.orientedDims ? inst.orientedDims : null;
            const baseDims = canonical && canonical.ok ? canonical.dims : (od || (c && c.dimensions) || null);
            if (!baseDims) continue;
            const dims = {
              length: baseDims.length,
              width: baseDims.width,
              height: baseDims.height,
            };
            payload.push({ inst, caseData: c, dims });
          }
          payload.sort((a, b) =>
            String((a.caseData && a.caseData.name) || a.inst.caseId)
              .localeCompare(String((b.caseData && b.caseData.name) || b.inst.caseId)) ||
            (b.dims.length * b.dims.width - a.dims.length * a.dims.width) ||
            String(a.inst.id).localeCompare(String(b.inst.id))
          );
          if (!payload.length) continue;
          const cellLength = Math.max(...payload.map(item => item.dims.length)) + stagingLayout.gap;
          const cellWidth = Math.max(...payload.map(item => item.dims.width)) + stagingLayout.gap;
          const cols = Math.max(1, Math.floor((stagingLayout.truckL + stagingLayout.gap) / Math.max(1, cellLength)));
          payload.forEach((item, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const stagedPosition = {
              x: stagingLayout.originX + item.dims.length / 2 + col * cellLength,
              y: item.dims.height / 2,
              z: categoryOriginZ + item.dims.width / 2 + row * cellWidth,
            };
            movedCount += 1;
            stagedById.set(item.inst.id, {
              ...item.inst,
              orientedDims: { ...item.dims },
              transform: {
                ...item.inst.transform,
                position: stagedPosition,
              },
              placement: 'staged',
            });
          });
          const rows = Math.ceil(payload.length / cols);
          categoryOriginZ += rows * cellWidth + categoryBandGap;
        }
        const nextCases = (livePack.cases || []).map(inst => stagedById.get(inst.id) || inst);
        if (OperationLifecycle && !OperationLifecycle.isCurrent(opToken)) return;
        PackLibrary.update(packId, { cases: nextCases });
        if (typeof SceneManager.requestShadowRefresh === 'function') {
          SceneManager.requestShadowRefresh();
        }
        UIComponents.showToast(`Moved ${movedCount} case${movedCount === 1 ? '' : 's'} to staging.`, 'info', { title: 'Unpack' });
        render();
      } finally {
        if (opToken && OperationLifecycle) OperationLifecycle.finishOperation(opToken);
      }
    }

    function renderInspectorNoPack() {
      inspectorEl.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
              <div class="tp3d-editor-fw-semibold tp3d-editor-mb-6">No pack open</div>
              <div class="muted tp3d-editor-fs-sm tp3d-editor-mb-12">Open a pack from the Packs screen to use the 3D editor.</div>
            `;
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.type = 'button';
      btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Go to Packs';
      btn.addEventListener('click', () => AppShell.navigate('packs'));
      card.appendChild(btn);
      inspectorEl.appendChild(card);
    }

    function renderInspector(pack) {
      const prefs = PreferencesManager.get();
      const sel = StateStore.get('selectedInstanceIds') || [];
      inspectorEl.innerHTML = '';

      if (!sel.length) {
        renderTruckInspector(pack, prefs);
        return;
      }

      if (sel.length > 1) {
        renderMultiInspector(pack, sel);
        return;
      }

      const instanceId = sel[0];
      const inst = (pack.cases || []).find(i => i.id === instanceId);
      if (!inst) {
        StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true });
        renderTruckInspector(pack, prefs);
        return;
      }
      const c = CaseLibrary.getById(inst.caseId);
      if (!c) {
        renderUnresolvedCaseInspector(pack, inst);
        return;
      }
      renderSingleInspector(pack, inst, c, prefs);
    }

    function renderUnresolvedCaseInspector(pack, inst) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');
      const title = document.createElement('div');
      title.classList.add('tp3d-editor-title-lg-semibold');
      title.textContent = 'Unresolved case';
      const msg = document.createElement('div');
      msg.className = 'muted';
      msg.classList.add('tp3d-editor-sub-sm');
      msg.textContent = `This item references a missing case definition (${inst && inst.caseId ? inst.caseId : 'unknown'}). It is excluded from AutoPack and Stats. Re-import the source pack or delete this item.`;
      card.appendChild(title);
      card.appendChild(msg);
      // Reachable repair/remove: the user can always delete the dangling item.
      const deleteButton = makeActionButton({
        label: 'Delete item',
        iconClass: 'fa-solid fa-trash',
        danger: true,
        onClick: () => {
          if (editorMutationBlocked()) return;
          deleteInstancesWithFeedback(pack.id, [inst.id]);
        },
      });
      card.appendChild(deleteButton);
      inspectorEl.appendChild(card);
    }

    function selectAllCases(pack) {
      const count = pack && Array.isArray(pack.cases) ? pack.cases.length : 0;
      if (!count) {
        UIComponents.showToast('No cases to select', 'info');
        return;
      }
      InteractionManager.selectAllInPack();
      render();
    }

    function makeSelectAllButton(pack, selectedCount = 0) {
      const totalCount = pack && Array.isArray(pack.cases) ? pack.cases.length : 0;
      return makeActionButton({
        label: 'Select All',
        iconHtml: selectAllIconSvg(),
        disabled: !totalCount || selectedCount >= totalCount,
        onClick: () => selectAllCases(pack),
      });
    }

    function selectAllIconSvg() {
      return [
        '<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none"',
        ' xmlns="http://www.w3.org/2000/svg">',
        '<path d="M4 12.5V5.75C4 4.78 4.78 4 5.75 4h6.75" stroke="currentColor" stroke-width="2.2"',
        ' stroke-linecap="round" stroke-linejoin="round"/>',
        '<path d="M8 16.5V9.75C8 8.78 8.78 8 9.75 8h6.75" stroke="currentColor" stroke-width="2.2"',
        ' stroke-linecap="round" stroke-linejoin="round"/>',
        '<rect x="12" y="12" width="8" height="8" rx="1.8" stroke="currentColor" stroke-width="2.2"/>',
        '<path d="M14.2 16.1l1.55 1.55 3.05-3.3" stroke="currentColor" stroke-width="2.2"',
        ' stroke-linecap="round" stroke-linejoin="round"/>',
        '</svg>',
      ].join('');
    }

    function makeActionButton({ label, iconClass = '', iconHtml = '', danger = false, disabled = false, onClick }) {
      const btn = document.createElement('button');
      btn.className = danger ? 'btn btn-danger' : 'btn';
      btn.type = 'button';
      btn.innerHTML = `${iconHtml || `<i class="${iconClass}"></i>`} ${label}`;
      btn.disabled = Boolean(disabled);
      if (typeof onClick === 'function') btn.addEventListener('click', onClick);
      return btn;
    }

    function makeVisibilityButton(pack, selectedIds) {
      const ids = Array.isArray(selectedIds) ? selectedIds : [];
      const instances = ids.map(id => (pack.cases || []).find(i => i.id === id)).filter(Boolean);
      const showSelection = instances.length > 0 && instances.every(inst => inst.hidden === true);
      return makeActionButton({
        label: showSelection ? 'Show' : 'Hide',
        iconClass: showSelection ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash',
        disabled: !instances.length,
        onClick: () => {
          instances.forEach(inst => PackLibrary.updateInstance(pack.id, inst.id, { hidden: !showSelection }));
        },
      });
    }

    function duplicateSelection(pack, selectedIds) {
      if (editorMutationBlocked()) return;
      const ids = Array.isArray(selectedIds) ? selectedIds : [];
      if (!pack || !ids.length) return;
      const source = ids
        .map(id => (pack.cases || []).find(inst => inst && inst.id === id))
        .filter(Boolean);
      if (!source.length) return;
      const result = PackLibrary.duplicateInstancesSafely(pack.id, source, CaseLibrary.getCases());
      if (!result || !result.newIds.length) {
        UIComponents.showToast('No collision-free duplicate position found', 'warning');
        return;
      }
      StateStore.set({ selectedInstanceIds: result.newIds }, { skipHistory: true });
      CaseScene.setSelected(result.newIds);
      UIComponents.showToast(
        result.placement === 'staged'
          ? `Duplicated ${result.newIds.length} case(s) to staging`
          : `Duplicated ${result.newIds.length} case(s)`,
        'success'
      );
      render();
    }

    function openSetCategoryModal(pack, selectedIds) {
      const selected = Array.isArray(selectedIds) ? selectedIds : [];
      const selectedCaseIds = new Set();
      const currentKeys = new Set();
      selected.forEach(id => {
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst || !inst.caseId) return;
        selectedCaseIds.add(inst.caseId);
        const c = CaseLibrary.getById(inst.caseId);
        if (c && c.category) currentKeys.add(c.category);
      });

      const initialKey = currentKeys.size === 1 ? Array.from(currentKeys)[0] : 'default';
      const initialMeta = CategoryService.meta(initialKey);

      const content = document.createElement('div');
      content.className = 'tp3d-editor-card-grid-gap-12';

      const modalHint = document.createElement('div');
      modalHint.className = 'muted tp3d-editor-fs-sm';
      modalHint.textContent =
        'This updates the Category for the underlying Case templates used by the selection, so the whole app (chips, labels, colors, textures) stays consistent.';
      content.appendChild(modalHint);

      const row1 = document.createElement('div');
      row1.className = 'row';
      row1.style.alignItems = 'center';

      const nameLabel = document.createElement('div');
      nameLabel.className = 'muted';
      nameLabel.style.minWidth = '90px';
      nameLabel.textContent = 'Name';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = initialMeta.name || '';
      nameInput.placeholder = 'e.g. Cables';
      nameInput.style.flex = '1';
      row1.appendChild(nameLabel);
      row1.appendChild(nameInput);
      content.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'row';
      row2.style.alignItems = 'center';

      const colorLabel = document.createElement('div');
      colorLabel.className = 'muted';
      colorLabel.style.minWidth = '90px';
      colorLabel.textContent = 'Color';
      const colorWrap = document.createElement('label');
      colorWrap.classList.add('tp3d-cases-cat-swatch');
      colorWrap.style.background = initialMeta.color || '#9ca3af';
      colorWrap.setAttribute('aria-label', 'Category color');
      colorWrap.setAttribute('title', 'Category color');
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'tp3d-cases-cat-color-input';
      colorInput.value = initialMeta.color || '#9ca3af';
      colorInput.setAttribute('aria-label', 'Category color');
      colorInput.addEventListener('input', () => {
        colorWrap.style.background = colorInput.value || '#9ca3af';
      });
      colorWrap.appendChild(colorInput);
      row2.appendChild(colorLabel);
      row2.appendChild(colorWrap);
      content.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'row';
      row3.style.alignItems = 'center';

      const renameLabel = document.createElement('div');
      renameLabel.className = 'muted';
      renameLabel.style.minWidth = '90px';
      renameLabel.textContent = 'Labels';

      const renameWrap = document.createElement('label');
      renameWrap.style.display = 'inline-flex';
      renameWrap.style.alignItems = 'center';
      renameWrap.style.gap = '8px';

      const renameCheckbox = document.createElement('input');
      renameCheckbox.type = 'checkbox';
      renameCheckbox.checked = true;
      const renameText = document.createElement('span');
      renameText.textContent = 'Update box labels (case names) to match';

      renameWrap.appendChild(renameCheckbox);
      renameWrap.appendChild(renameText);
      row3.appendChild(renameLabel);
      row3.appendChild(renameWrap);
      content.appendChild(row3);

      UIComponents.showModal({
        title: `Set category for ${selected.length} selected`,
        content,
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          {
            label: 'Apply',
            variant: 'primary',
            onClick: () => {
              const name = String(nameInput.value || '').trim();
              if (!name) {
                UIComponents.showToast('Category name is required', 'warning');
                return false;
              }
              const color = String(colorInput.value || '').trim();
              const meta = CategoryService.upsert({ name, color });
              let updated = 0;
              selectedCaseIds.forEach(caseId => {
                const c = CaseLibrary.getById(caseId);
                if (!c) return;
                const next = { ...c, category: meta.key };
                if (renameCheckbox.checked) next.name = name;
                if ((c.category || 'default') === meta.key && (!renameCheckbox.checked || c.name === name)) return;
                CaseLibrary.upsert(next);
                updated += 1;
              });
              UIComponents.showToast(
                updated
                  ? `Updated category to “${meta.name}” for ${updated} case template(s)`
                  : `Category already “${meta.name}”`,
                'success'
              );
              render();
              return true;
            },
          },
        ],
      });
    }

    // Every editor truck writer delegates to the shared, single-flight
    // reconciliation controller. The current render is also the canonical
    // control restoration path for Cancel, X, overlay click, and Escape.
    function applyTruckGeometryChange(pack, nextTruck, successMsg) {
      // Single choke point for every truck-geometry commit (Update truck + the
      // config-card save buttons). Block while another operation owns the editor,
      // and hold the lifecycle slot for the duration of the preview modal so AutoPack/
      // Unpack cannot mutate the pack underneath an open Truck Change.
      if (OperationLifecycle && OperationLifecycle.isBusy()) {
        UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Truck' });
        return { status: 'busy' };
      }
      const token = OperationLifecycle ? OperationLifecycle.beginOperation('changingTruck', { packId: pack.id }) : null;
      const release = () => { if (token && OperationLifecycle) OperationLifecycle.finishOperation(token); };
      let result;
      try {
        result = TruckChangeController.request({
          pack,
          nextTruck,
          successMessage: successMsg || 'Truck updated',
          renderPreview: preview => {
            if (!preview || !preview.pack || StateStore.get('currentScreen') !== 'editor') return;
            ensureScene();
            SceneManager.setTruck(preview.pack.truck);
            CaseScene.sync(preview.pack);
            CaseScene.setSelected(StateStore.get('selectedInstanceIds') || []);
            SceneManager.resize();
          },
          onCommitted: () => { clearPendingTruck(); render(); release(); },
          restoreControls: () => { render(); release(); },
        });
      } catch (err) {
        release();
        throw err;
      }
      // If no preview modal opened (committed/unchanged/failed/invalid), the slot is
      // released now; for 'preview' it is held until the modal resolves via the
      // onCommitted / restoreControls callbacks above.
      if (!result || result.status !== 'preview') {
        if (result && result.status === 'committed') clearPendingTruck();
        release();
      }
      return result;
    }

    function renderTruckInspector(pack, prefs) {
      const lengthUnit = getLengthUnit(prefs);
      // The dropdowns/dims edit a PENDING truck; the committed truck (and the scene)
      // only change when the user clicks "Update truck". effectiveTruck pre-fills the
      // form; truckDirty drives the Update-truck active state.
      const effectiveTruck = getEffectiveTruck(pack) || pack.truck;
      const truckDirty = Boolean(pendingTruck && pendingTruck.__packId === pack.id) &&
        !TruckChangeController.truckGeometryEqual(pack.truck, effectiveTruck);
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');

      const stats = PackLibrary.computeStats(pack);
      card.appendChild(cardHeaderWithInfo('Truck', 'Display units follow Settings. Dimensions are stored internally in inches.'));

      const presetRow = document.createElement('div');
      presetRow.className = 'row';
      presetRow.classList.add('tp3d-editor-preset-row');

      const presetWrap = document.createElement('div');
      presetWrap.className = 'field';
      presetWrap.classList.add('tp3d-editor-wrap-full');

      const presetLabel = document.createElement('div');
      presetLabel.className = 'label';
      presetLabel.textContent = 'Trailer preset';

      const presetSelect = document.createElement('select');
      presetSelect.className = 'select';
      presetSelect.classList.add('tp3d-editor-select-full');

      function inferPresetIdFromTruck(truck) {
        const t = truck && typeof truck === 'object' ? truck : {};
        const tl = Number(t.length);
        const tw = Number(t.width);
        const th = Number(t.height);
        const tm = String(t.shapeMode || 'rect');
        const presets = TrailerPresets.getAll();
        for (let i = 0; i < presets.length; i++) {
          const p = presets[i];
          const pt = p && p.truck ? p.truck : null;
          if (!pt) continue;
          if (
            Number(pt.length) === tl &&
            Number(pt.width) === tw &&
            Number(pt.height) === th &&
            String(pt.shapeMode || 'rect') === tm
          ) {
            return p.id;
          }
        }
        return 'custom';
      }

      const presetOptions = TrailerPresets.getAll()
        .map(p => `<option value="${String(p.id)}">${String(p.label)}</option>`)
        .join('');
      presetSelect.innerHTML = `<option value="custom">Custom</option>${presetOptions}`;
      presetSelect.value = inferPresetIdFromTruck(effectiveTruck);

      presetSelect.addEventListener('change', () => {
        // Pending only: pre-fill the form with the preset's geometry. Nothing is
        // reconciled, previewed, or committed until the user clicks "Update truck".
        if (OperationLifecycle && OperationLifecycle.isBusy()) {
          UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Truck' });
          presetSelect.value = inferPresetIdFromTruck(effectiveTruck);
          return;
        }
        const id = String(presetSelect.value || 'custom');
        if (id === 'custom') return;
        const preset = TrailerPresets.getById(id);
        if (!preset) return;
        setPendingTruck(pack, TrailerPresets.applyToTruck(pack.truck, preset));
        render();
      });

      presetWrap.appendChild(presetLabel);
      presetWrap.appendChild(presetSelect);
      presetRow.appendChild(presetWrap);

      const shapeRow = document.createElement('div');
      shapeRow.className = 'row';
      shapeRow.classList.add('tp3d-editor-preset-row');
      const shapeWrap = document.createElement('div');
      shapeWrap.className = 'field';
      shapeWrap.classList.add('tp3d-editor-wrap-full');
      const shapeLabel = document.createElement('div');
      shapeLabel.className = 'label';
      shapeLabel.textContent = 'Trailer Shape Mode';
      const shapeSelect = document.createElement('select');
      shapeSelect.className = 'select';
      shapeSelect.classList.add('tp3d-editor-select-full');
      shapeSelect.innerHTML = `
	                <option value="rect">Standard</option>
	                <option value="wheelWells">Box + Wheel Wells</option>
	                <option value="frontBonus">Box + Front Overhang</option>
	              `;
      shapeSelect.value =
        effectiveTruck && (effectiveTruck.shapeMode === 'wheelWells' || effectiveTruck.shapeMode === 'frontBonus')
          ? effectiveTruck.shapeMode
          : 'rect';
      shapeWrap.appendChild(shapeLabel);
      shapeWrap.appendChild(shapeSelect);
      shapeRow.appendChild(shapeWrap);

      card.appendChild(presetRow);
      const dimsRow = document.createElement('div');
      dimsRow.className = 'row';
      dimsRow.classList.add('tp3d-editor-dims-row');
      const fL = smallField(`Length (${lengthUnit})`, Utils.inchesToUnit(effectiveTruck.length, lengthUnit));
      const fW = smallField(`Width (${lengthUnit})`, Utils.inchesToUnit(effectiveTruck.width, lengthUnit));
      const fH = smallField(`Height (${lengthUnit})`, Utils.inchesToUnit(effectiveTruck.height, lengthUnit));
      [fL.wrap, fW.wrap, fH.wrap].forEach(wrap => wrap.classList.add('tp3d-editor-field-wrap-full'));
      dimsRow.appendChild(fL.wrap);
      dimsRow.appendChild(fW.wrap);
      dimsRow.appendChild(fH.wrap);

      const btnSave = document.createElement('button');
      btnSave.className = 'btn btn-primary';
      btnSave.type = 'button';
      btnSave.innerHTML = truckDirty
        ? '<i class="fa-solid fa-floppy-disk"></i> Update truck •'
        : '<i class="fa-solid fa-floppy-disk"></i> Update truck';
      btnSave.classList.add('tp3d-editor-btn-full');
      if (truckDirty) btnSave.classList.add('tp3d-editor-btn-attention');
      btnSave.addEventListener('click', () => {
        // Commit the pending/edited geometry. This is the ONLY path that calls the
        // TruckChangeController (reconciliation + preview); dropdown changes do not.
        if (OperationLifecycle && OperationLifecycle.isBusy()) {
          UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Truck' });
          return;
        }
        const next = {
          ...effectiveTruck,
          length: Math.max(24, displayLengthToInches(fL.input.value, effectiveTruck.length, lengthUnit)),
          width: Math.max(24, displayLengthToInches(fW.input.value, effectiveTruck.width, lengthUnit)),
          height: Math.max(24, displayLengthToInches(fH.input.value, effectiveTruck.height, lengthUnit)),
          shapeMode:
            effectiveTruck && (effectiveTruck.shapeMode === 'wheelWells' || effectiveTruck.shapeMode === 'frontBonus')
              ? effectiveTruck.shapeMode
              : 'rect',
          shapeConfig:
            effectiveTruck && effectiveTruck.shapeConfig && typeof effectiveTruck.shapeConfig === 'object'
              ? Utils.deepClone(effectiveTruck.shapeConfig)
              : {},
        };
        // Clamp config values to bounds (safe even if unused)
        if (next.shapeMode === 'wheelWells') {
          const cfg = next.shapeConfig || {};
          if (Number.isFinite(cfg.wellHeight)) cfg.wellHeight = Utils.clamp(Number(cfg.wellHeight), 0, next.height);
          if (Number.isFinite(cfg.wellWidth)) cfg.wellWidth = Utils.clamp(Number(cfg.wellWidth), 0, next.width / 2);
          if (Number.isFinite(cfg.wellLength)) cfg.wellLength = Utils.clamp(Number(cfg.wellLength), 0, next.length);
          if (Number.isFinite(cfg.wellOffsetFromRear)) {
            cfg.wellOffsetFromRear = Utils.clamp(Number(cfg.wellOffsetFromRear), 0, next.length);
          }
          next.shapeConfig = cfg;
        } else if (next.shapeMode === 'frontBonus') {
          const cfg = next.shapeConfig || {};
          if (Number.isFinite(cfg.bonusLength)) cfg.bonusLength = Utils.clamp(Number(cfg.bonusLength), 0, next.length);
          // bonusWidth is no longer used in overhang geometry (the overhang
          // always spans the full trailer width). Kept on shapeConfig for
          // backward compatibility only, normalized to truck.width.
          if (Number.isFinite(cfg.bonusWidth)) cfg.bonusWidth = next.width;
          if (Number.isFinite(cfg.bonusHeight)) cfg.bonusHeight = Utils.clamp(Number(cfg.bonusHeight), 0, next.height);
          next.shapeConfig = cfg;
        }

        clearPendingTruck();
        applyTruckGeometryChange(pack, next, 'Truck updated');
      });

      shapeSelect.addEventListener('change', () => {
        // Pending only: pre-fill the form (and surface the matching config card on the
        // next render). Reconciliation/preview happens when the user clicks Update truck.
        if (OperationLifecycle && OperationLifecycle.isBusy()) {
          UIComponents.showToast('Another operation is in progress. Please wait…', 'info', { title: 'Truck' });
          shapeSelect.value = effectiveTruck && (effectiveTruck.shapeMode === 'wheelWells' || effectiveTruck.shapeMode === 'frontBonus') ? effectiveTruck.shapeMode : 'rect';
          return;
        }
        const mode = String(shapeSelect.value || 'rect');
        const nextTruck = {
          ...effectiveTruck,
          shapeMode: mode === 'wheelWells' || mode === 'frontBonus' ? mode : 'rect',
          shapeConfig:
            effectiveTruck && effectiveTruck.shapeConfig && typeof effectiveTruck.shapeConfig === 'object'
              ? Utils.deepClone(effectiveTruck.shapeConfig)
              : {},
        };

        // Fill sensible defaults (stored) + clamp to trailer bounds.
        if (nextTruck.shapeMode === 'wheelWells') {
          const cfg = nextTruck.shapeConfig || {};
          if (!Number.isFinite(cfg.wellHeight)) cfg.wellHeight = 0.35 * nextTruck.height;
          if (!Number.isFinite(cfg.wellWidth)) cfg.wellWidth = 0.15 * nextTruck.width;
          if (!Number.isFinite(cfg.wellLength)) cfg.wellLength = 0.35 * nextTruck.length;
          if (!Number.isFinite(cfg.wellOffsetFromRear)) cfg.wellOffsetFromRear = 0.25 * nextTruck.length;
          cfg.wellHeight = Utils.clamp(Number(cfg.wellHeight) || 0, 0, nextTruck.height);
          cfg.wellWidth = Utils.clamp(Number(cfg.wellWidth) || 0, 0, nextTruck.width / 2);
          cfg.wellLength = Utils.clamp(Number(cfg.wellLength) || 0, 0, nextTruck.length);
          cfg.wellOffsetFromRear = Utils.clamp(Number(cfg.wellOffsetFromRear) || 0, 0, nextTruck.length);
          nextTruck.shapeConfig = cfg;
        } else if (nextTruck.shapeMode === 'frontBonus') {
          const cfg = nextTruck.shapeConfig || {};
          if (!Number.isFinite(cfg.bonusLength)) cfg.bonusLength = 0.12 * nextTruck.length;
          if (!Number.isFinite(cfg.bonusHeight)) cfg.bonusHeight = 0.45 * nextTruck.height;
          cfg.bonusLength = Utils.clamp(Number(cfg.bonusLength) || 0, 0, nextTruck.length);
          cfg.bonusHeight = Utils.clamp(Number(cfg.bonusHeight) || 0, 0, nextTruck.height);
          // bonusWidth is no longer used in overhang geometry (the overhang
          // always spans the full trailer width). Kept on shapeConfig for
          // backward compatibility only, normalized to truck.width.
          cfg.bonusWidth = nextTruck.width;
          nextTruck.shapeConfig = cfg;
        }

        // Pending only — store the new shape (with its default config) and re-render
        // so the matching config card appears. Committing happens on Update truck.
        setPendingTruck(pack, nextTruck);
        render();
      });

      const statsEl = document.createElement('div');
      statsEl.className = 'card';
      statsEl.classList.add('tp3d-editor-stats-card');
      const unresolvedCount = stats.unresolvedInstances || 0;
      const unresolvedRow = unresolvedCount > 0
        ? `<div class="row space-between"><span class="muted tp3d-editor-fs-sm">Unresolved cases</span><b class="tp3d-text-primary tp3d-editor-fs-sm">${unresolvedCount}</b></div>`
        : '';
      const incompleteNote = unresolvedCount > 0
        ? `<div class="muted tp3d-editor-fs-xs">${unresolvedCount} cargo item${unresolvedCount === 1 ? '' : 's'} could not be resolved. Weight and volume totals are incomplete.</div>`
        : '';
      statsEl.innerHTML = `
              <div class="tp3d-editor-fw-semibold">Stats</div>
              <div class="row space-between"><span class="muted tp3d-editor-fs-sm">Cases loaded</span><b class="tp3d-text-primary tp3d-editor-fs-sm">${stats.totalCases}</b></div>
              <div class="row space-between"><span class="muted tp3d-editor-fs-sm">Packed (in truck)</span><b class="tp3d-text-primary tp3d-editor-fs-sm">${stats.packedCases}</b></div>
              ${unresolvedRow}
              <div class="row space-between"><span class="muted tp3d-editor-fs-sm">Volume used</span><b class="tp3d-text-primary tp3d-editor-fs-sm">${stats.volumePercent.toFixed(1)}%</b></div>
              <div class="row space-between"><span class="muted tp3d-editor-fs-sm">Total weight</span><b class="tp3d-text-primary tp3d-editor-fs-sm">${Utils.formatWeight(stats.totalWeight, prefs.units.weight)}</b></div>
              ${incompleteNote}
            `;

      card.appendChild(shapeRow);
      card.appendChild(dimsRow);
      card.appendChild(btnSave);
      inspectorEl.appendChild(card);

      // === Shape Config Card (Overhang / Wheel Wells) ===
      // Keyed off effectiveTruck (pending or committed), so selecting Wheel Wells /
      // Front Overhang in the dropdown shows that mode's config controls immediately
      // in the form — the 3D scene still shows the committed truck until Update truck.
      const currentMode = effectiveTruck && effectiveTruck.shapeMode ? effectiveTruck.shapeMode : 'rect';
      if (currentMode === 'frontBonus' || currentMode === 'wheelWells') {
        const cfgCard = document.createElement('div');
        cfgCard.className = 'card';
        cfgCard.classList.add('tp3d-editor-card-grid-gap-12');

        const cfg = (effectiveTruck && effectiveTruck.shapeConfig && typeof effectiveTruck.shapeConfig === 'object')
          ? effectiveTruck.shapeConfig : {};
        const tL = effectiveTruck.length || 636;
        const tW = effectiveTruck.width || 102;
        const tH = effectiveTruck.height || 110;

        if (currentMode === 'frontBonus') {
          cfgCard.appendChild(cardHeaderWithInfo(
            'Front Overhang',
            'Adds a raised deck above the cab. Length controls how far it extends. Deck Height controls cab clearance; the space below is blocked.'
          ));

          const defBL = Math.round(0.12 * tL);
          const defBW = tW;
          const defBH = Math.round(0.45 * tH);
          const bonusLength = Number.isFinite(cfg.bonusLength) ? cfg.bonusLength : defBL;
          const bonusHeight = Number.isFinite(cfg.bonusHeight) ? cfg.bonusHeight : defBH;

          const cfgRow = document.createElement('div');
          cfgRow.className = 'tp3d-editor-dims-row tp3d-editor-dims-row--two';
          const fBL = smallField(`Length (${lengthUnit})`, Utils.inchesToUnit(bonusLength, lengthUnit));
          const fBH = smallField(`Deck Height (${lengthUnit})`, Utils.inchesToUnit(bonusHeight, lengthUnit));
          [fBL.wrap, fBH.wrap].forEach(w => w.classList.add('tp3d-editor-field-wrap-full'));
          cfgRow.appendChild(fBL.wrap);
          cfgRow.appendChild(fBH.wrap);
          cfgCard.appendChild(cfgRow);

          const usableOverhangHeight = Math.max(0, tH - bonusHeight);
          const cfgHint = document.createElement('div');
          cfgHint.className = 'muted tp3d-editor-fs-xs';
          cfgHint.textContent =
            `Usable overhang height: ${Utils.inchesToUnit(usableOverhangHeight, lengthUnit).toFixed(1)} ${lengthUnit} ` +
            '(trailer height − deck height)';
          cfgCard.appendChild(cfgHint);

          const btnRow = document.createElement('div');
          btnRow.className = 'row';
          btnRow.classList.add('tp3d-editor-row-gap-10');

          const cfgSave = document.createElement('button');
          cfgSave.className = 'btn btn-primary';
          cfgSave.type = 'button';
          cfgSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update';
          cfgSave.addEventListener('click', () => {
            const nextCfg = {
              bonusLength: Utils.clamp(displayLengthToInches(fBL.input.value, bonusLength, lengthUnit), 0, tL),
              // Width is fixed to the trailer's full width for this mode and
              // is not user-editable. Kept on shapeConfig for backward
              // compatibility only.
              bonusWidth: tW,
              bonusHeight: Utils.clamp(displayLengthToInches(fBH.input.value, bonusHeight, lengthUnit), 0, tH),
            };
            const nextTruck = { ...effectiveTruck, shapeConfig: nextCfg };
            applyTruckGeometryChange(pack, nextTruck, 'Overhang updated');
          });

          const cfgReset = document.createElement('button');
          cfgReset.className = 'btn';
          cfgReset.type = 'button';
          cfgReset.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
          cfgReset.addEventListener('click', () => {
            fBL.input.value = String(Utils.inchesToUnit(defBL, lengthUnit).toFixed(1));
            fBH.input.value = String(Utils.inchesToUnit(defBH, lengthUnit).toFixed(1));
            const nextCfg = { bonusLength: defBL, bonusWidth: defBW, bonusHeight: defBH };
            const nextTruck = { ...effectiveTruck, shapeConfig: nextCfg };
            applyTruckGeometryChange(pack, nextTruck, 'Overhang reset to defaults');
          });

          btnRow.appendChild(cfgSave);
          btnRow.appendChild(cfgReset);
          cfgCard.appendChild(btnRow);
        }

        if (currentMode === 'wheelWells') {
          cfgCard.appendChild(cardHeaderWithInfo(
            'Wheel Wells',
            'Defines matching blocked zones on both sides of the truck. Offset is measured from the rear/loading door.'
          ));

          const defWH = Math.round(0.35 * tH);
          const defWW = Math.round(0.15 * tW);
          const defWL = Math.round(0.35 * tL);
          const defWO = Math.round(0.25 * tL);
          const wellHeight = Number.isFinite(cfg.wellHeight) ? cfg.wellHeight : defWH;
          const wellWidth = Number.isFinite(cfg.wellWidth) ? cfg.wellWidth : defWW;
          const wellLength = Number.isFinite(cfg.wellLength) ? cfg.wellLength : defWL;
          const wellOffset = Number.isFinite(cfg.wellOffsetFromRear) ? cfg.wellOffsetFromRear : defWO;

          const cfgRow1 = document.createElement('div');
          cfgRow1.className = 'tp3d-editor-dims-row';
          const fWH = smallField(`Height (${lengthUnit})`, Utils.inchesToUnit(wellHeight, lengthUnit));
          const fWW = smallField(`Width (${lengthUnit})`, Utils.inchesToUnit(wellWidth, lengthUnit));
          const fWL = smallField(`Length (${lengthUnit})`, Utils.inchesToUnit(wellLength, lengthUnit));
          [fWH.wrap, fWW.wrap, fWL.wrap].forEach(w => w.classList.add('tp3d-editor-field-wrap-full'));
          cfgRow1.appendChild(fWH.wrap);
          cfgRow1.appendChild(fWW.wrap);
          cfgRow1.appendChild(fWL.wrap);
          cfgCard.appendChild(cfgRow1);

          const fWO = smallField(`Offset from rear (${lengthUnit})`, Utils.inchesToUnit(wellOffset, lengthUnit));
          fWO.wrap.classList.add('tp3d-editor-field-wrap-full');
          cfgCard.appendChild(fWO.wrap);

          const btnRow = document.createElement('div');
          btnRow.className = 'row';
          btnRow.classList.add('tp3d-editor-row-gap-10');

          const cfgSave = document.createElement('button');
          cfgSave.className = 'btn btn-primary';
          cfgSave.type = 'button';
          cfgSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update';
          cfgSave.addEventListener('click', () => {
            const nextCfg = {
              wellHeight: Utils.clamp(displayLengthToInches(fWH.input.value, wellHeight, lengthUnit), 0, tH),
              wellWidth: Utils.clamp(displayLengthToInches(fWW.input.value, wellWidth, lengthUnit), 0, tW / 2),
              wellLength: Utils.clamp(displayLengthToInches(fWL.input.value, wellLength, lengthUnit), 0, tL),
              wellOffsetFromRear: Utils.clamp(displayLengthToInches(fWO.input.value, wellOffset, lengthUnit), 0, tL),
            };
            if (nextCfg.wellOffsetFromRear + nextCfg.wellLength > tL) {
              nextCfg.wellLength = tL - nextCfg.wellOffsetFromRear;
            }
            const nextTruck = { ...effectiveTruck, shapeConfig: nextCfg };
            applyTruckGeometryChange(pack, nextTruck, 'Wheel wells updated');
          });

          const cfgReset = document.createElement('button');
          cfgReset.className = 'btn';
          cfgReset.type = 'button';
          cfgReset.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
          cfgReset.addEventListener('click', () => {
            fWH.input.value = String(Utils.inchesToUnit(defWH, lengthUnit).toFixed(1));
            fWW.input.value = String(Utils.inchesToUnit(defWW, lengthUnit).toFixed(1));
            fWL.input.value = String(Utils.inchesToUnit(defWL, lengthUnit).toFixed(1));
            fWO.input.value = String(Utils.inchesToUnit(defWO, lengthUnit).toFixed(1));
            const nextCfg = {
              wellHeight: defWH, wellWidth: defWW,
              wellLength: defWL, wellOffsetFromRear: defWO,
            };
            const nextTruck = { ...effectiveTruck, shapeConfig: nextCfg };
            applyTruckGeometryChange(pack, nextTruck, 'Wheel wells reset to defaults');
          });

          btnRow.appendChild(cfgSave);
          btnRow.appendChild(cfgReset);
          cfgCard.appendChild(btnRow);
        }

        inspectorEl.appendChild(cfgCard);
      }

      inspectorEl.appendChild(statsEl);
    }

    function renderMultiInspector(pack, selected) {
      // === Selection Info Card ===
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');
      const title = document.createElement('div');
      title.classList.add('tp3d-editor-fw-semibold');
      title.textContent = `${selected.length} cases selected`;
      card.appendChild(title);
      // Surface unresolved (dangling) items inside a multi-selection so the user can
      // see they are excluded from AutoPack and Stats.
      const unresolvedSelected = selected
        .map(id => (pack.cases || []).find(i => i.id === id))
        .filter(inst => inst && !CaseLibrary.getById(inst.caseId)).length;
      if (unresolvedSelected > 0) {
        const note = document.createElement('div');
        note.className = 'muted';
        note.classList.add('tp3d-editor-sub-sm');
        note.textContent = `${unresolvedSelected} of these reference a missing case definition and are excluded from AutoPack and Stats.`;
        card.appendChild(note);
      }
      inspectorEl.appendChild(card);

      // === Batch Rotation Card ===
      const rotCard = document.createElement('div');
      rotCard.className = 'card';
      rotCard.classList.add('tp3d-editor-card-grid-gap-12');
      const rotateFlipHelp = 'Turn: Y axis. Tip: X axis. Roll: Z axis. Flip: 180°.';
      rotCard.appendChild(cardHeaderWithInfo('Rotate All', rotateFlipHelp));

      const halfPI = Math.PI / 2;
      const rotRow = document.createElement('div');
      rotRow.className = 'tp3d-editor-rot-grid';
      [
        { label: 'Turn', icon: 'fa-rotate', tone: 'turn', axis: 'y', delta: halfPI },
        { label: 'Tip', icon: 'fa-rotate-left', tone: 'tip', axis: 'x', delta: halfPI },
        { label: 'Roll', icon: 'fa-rotate-right', tone: 'roll', axis: 'z', delta: halfPI },
        { label: 'Flip', icon: 'fa-arrows-up-down', tone: 'flip', axis: 'x', delta: Math.PI },
      ].forEach(({ label, icon, tone, axis, delta }) => {
        const btn = document.createElement('button');
        btn.className = `btn tp3d-editor-rot-btn tp3d-editor-rot-btn--${tone}`;
        btn.type = 'button';
        btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
        btn.addEventListener('click', () => {
          InteractionManager.rotateSelection(axis, delta);
        });
        rotRow.appendChild(btn);
      });
      rotCard.appendChild(rotRow);
      inspectorEl.appendChild(rotCard);

      // === Actions Card ===
      const actCard = document.createElement('div');
      actCard.className = 'card';
      actCard.classList.add('tp3d-editor-card-grid-gap-12');
      const actTitle = document.createElement('div');
      actTitle.classList.add('tp3d-editor-fw-semibold');
      actTitle.textContent = 'Actions';
      actCard.appendChild(actTitle);

      const actRow = document.createElement('div');
      actRow.className = 'tp3d-editor-action-grid';

      const btnSelectAll = makeSelectAllButton(pack, selected.length);

      const btnSetCategory = makeActionButton({
        label: 'Set Category',
        iconClass: 'fa-solid fa-tag',
        onClick: () => openSetCategoryModal(pack, selected),
      });
      const btnVisibility = makeVisibilityButton(pack, selected);
      const btnClear = makeActionButton({
        label: 'Deselect',
        iconClass: 'fa-solid fa-xmark',
        onClick: () => InteractionManager.setSelection([]),
      });
      const btnDuplicate = makeActionButton({
        label: 'Duplicate',
        iconClass: 'fa-solid fa-copy',
        onClick: () => duplicateSelection(pack, selected),
      });
      const btnDelete = makeActionButton({
        label: `Delete (${selected.length})`,
        iconClass: 'fa-solid fa-trash',
        danger: true,
        onClick: () => InteractionManager.deleteSelection(),
      });

      actRow.appendChild(btnSetCategory);
      actRow.appendChild(btnVisibility);
      actRow.appendChild(btnSelectAll);
      actRow.appendChild(btnClear);
      actRow.appendChild(btnDuplicate);
      actRow.appendChild(btnDelete);
      actCard.appendChild(actRow);
      inspectorEl.appendChild(actCard);
    }

    function renderSingleInspector(pack, inst, caseData, prefs) {
      const lengthUnit = getLengthUnit(prefs);
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');

      // Header: name + subtitle
      const header = document.createElement('div');
      const title = document.createElement('div');
      title.classList.add('tp3d-editor-title-lg-semibold');
      title.textContent = caseData.name || '—';
      const sub = document.createElement('div');
      sub.className = 'muted';
      sub.classList.add('tp3d-editor-sub-sm');
      const mfg = caseData.manufacturer ? caseData.manufacturer : '—';
      const d = caseData.dimensions || { length: 0, width: 0, height: 0 };
      sub.textContent = `${mfg} • ${Utils.formatDims(d, lengthUnit)}`;
      header.appendChild(title);
      header.appendChild(sub);
      card.appendChild(header);
      card.appendChild(makeMiniCategoryChip(caseData.category));

      // Handling rules: case-level policy and this-instance lock, shown separately.
      const caseRules = getCaseHandlingSummary(caseData);
      const instRules = getInstanceHandlingSummary(inst);
      if (caseRules.length || instRules.length) {
        const rulesWrap = document.createElement('div');
        rulesWrap.className = 'tp3d-editor-handling-rules';
        const addChips = (labels, extraClass) => {
          const chips = document.createElement('div');
          chips.className = 'tp3d-editor-handling-chips';
          labels.forEach(label => {
            const chip = document.createElement('span');
            chip.className = 'badge tp3d-handling-chip' + (extraClass ? ' ' + extraClass : '');
            chip.textContent = label;
            chips.appendChild(chip);
          });
          rulesWrap.appendChild(chips);
        };
        if (caseRules.length) {
          const lbl = document.createElement('div');
          lbl.className = 'muted tp3d-editor-sub-sm';
          lbl.textContent = 'Handling rules (case)';
          rulesWrap.appendChild(lbl);
          addChips(caseRules);
        }
        if (instRules.length) {
          const lbl2 = document.createElement('div');
          lbl2.className = 'muted tp3d-editor-sub-sm';
          lbl2.textContent = 'This item';
          rulesWrap.appendChild(lbl2);
          addChips(instRules, 'tp3d-handling-chip-instance');
        }
        card.appendChild(rulesWrap);
      }

      inspectorEl.appendChild(card);

      // === Transform Card (Position + Rotate / Flip) ===
      const transformCard = document.createElement('div');
      transformCard.className = 'card';
      transformCard.classList.add('tp3d-editor-card-grid-gap-12', 'tp3d-editor-transform-card');
      transformCard.appendChild(cardHeaderWithInfo(
        'Transform',
        'Position uses the selected display units. Changes are checked against collisions and usable truck zones.'
      ));

      const posTitle = document.createElement('div');
      posTitle.className = 'label';
      posTitle.textContent = 'Position';
      transformCard.appendChild(posTitle);

      const posRow = document.createElement('div');
      posRow.className = 'tp3d-editor-dims-row tp3d-editor-position-row';
      const pos = inst.transform.position || { x: 0, y: 0, z: 0 };
      const fX = inlinePositionField('X', lengthUnit, Utils.inchesToUnit(pos.x, lengthUnit));
      const fY = inlinePositionField('Y', lengthUnit, Utils.inchesToUnit(pos.y, lengthUnit));
      const fZ = inlinePositionField('Z', lengthUnit, Utils.inchesToUnit(pos.z, lengthUnit));
      [fX.wrap, fY.wrap, fZ.wrap].forEach(w => w.classList.add('tp3d-editor-field-wrap-full'));
      posRow.appendChild(fX.wrap);
      posRow.appendChild(fY.wrap);
      posRow.appendChild(fZ.wrap);
      transformCard.appendChild(posRow);

      const savePos = document.createElement('button');
      savePos.className = 'btn btn-primary';
      savePos.classList.add('tp3d-editor-btn-full');
      savePos.type = 'button';
      savePos.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Apply position';
      savePos.addEventListener('click', () => {
        const nextPos = {
          x: Utils.unitToInches(Number(fX.input.value) || 0, lengthUnit),
          y: Utils.unitToInches(Number(fY.input.value) || 0, lengthUnit),
          z: Utils.unitToInches(Number(fZ.input.value) || 0, lengthUnit),
        };
        const obj = CaseScene.getObject(inst.id);
        const originalWorld = obj ? obj.position.clone() : null;
        const candidateWorld = SceneManager.vecInchesToWorld(nextPos);
        const ignoreSet = new Set([inst.id]);
        let check = CaseScene.checkCollision(inst.id, candidateWorld, ignoreSet);
        CaseScene.setCollision(inst.id, check.collides);
        if (check.collides) {
          UIComponents.showToast('Cannot place here: collision detected', 'error');
          return;
        }

        let finalPos = nextPos;
        if (obj) {
          obj.position.copy(candidateWorld);
          const settledY = CaseScene.settleY(inst.id);
          if (settledY !== null) obj.position.y = settledY;
          check = CaseScene.checkCollision(inst.id, obj.position, ignoreSet);
          CaseScene.setCollision(inst.id, check.collides);
          if (check.collides) {
            if (originalWorld) obj.position.copy(originalWorld);
            UIComponents.showToast('Cannot place here: collision detected', 'error');
            return;
          }
          finalPos = SceneManager.vecWorldToInches(obj.position);
        }
        CaseScene.setCollision(inst.id, false);
        const nextCases = (pack.cases || []).map(item =>
          item.id === inst.id
            ? { ...item, transform: { ...item.transform, position: finalPos } }
            : item
        );
        if (typeof PackLibrary.updateCasesWithManualRevalidation === 'function') {
          PackLibrary.updateCasesWithManualRevalidation(pack.id, nextCases, CaseLibrary.getCases());
        } else {
          PackLibrary.update(pack.id, { cases: nextCases });
        }
        SceneManager.focusOnWorldPoint(SceneManager.vecInchesToWorld(finalPos), { duration: 420 });
        UIComponents.showToast('Position updated', 'success');
      });
      transformCard.appendChild(savePos);
      inspectorEl.appendChild(transformCard);

      // === Rotate / Flip Card ===
      const rotCard = document.createElement('div');
      rotCard.className = 'card';
      rotCard.classList.add('tp3d-editor-card-grid-gap-12');
      const rotateFlipHelp = 'Turn: Y axis. Tip: X axis. Roll: Z axis. Flip: 180°.';
      rotCard.appendChild(cardHeaderWithInfo('Rotate / Flip', rotateFlipHelp));
      // TODO(AUTO-PACK-A0): when reset-orientation UI is added, apply PackLibrary.clearOrientationLockPatch().

      const halfPI = Math.PI / 2;
      const rotRow = document.createElement('div');
      rotRow.className = 'tp3d-editor-rot-grid';
      [
        { label: 'Turn', icon: 'fa-rotate', tone: 'turn', axis: 'y', delta: halfPI },
        { label: 'Tip', icon: 'fa-rotate-left', tone: 'tip', axis: 'x', delta: halfPI },
        { label: 'Roll', icon: 'fa-rotate-right', tone: 'roll', axis: 'z', delta: halfPI },
        { label: 'Flip', icon: 'fa-arrows-up-down', tone: 'flip', axis: 'x', delta: Math.PI },
      ].forEach(({ label, icon, tone, axis, delta }) => {
        const btn = document.createElement('button');
        btn.className = `btn tp3d-editor-rot-btn tp3d-editor-rot-btn--${tone}`;
        btn.type = 'button';
        btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
        btn.addEventListener('click', () => {
          InteractionManager.rotateSelection(axis, delta);
        });
        rotRow.appendChild(btn);
      });
      rotCard.appendChild(rotRow);
      inspectorEl.appendChild(rotCard);

      // === Actions Card ===
      const actCard = document.createElement('div');
      actCard.className = 'card';
      actCard.classList.add('tp3d-editor-card-grid-gap-12');
      const actTitle = document.createElement('div');
      actTitle.classList.add('tp3d-editor-fw-semibold');
      actTitle.textContent = 'Actions';
      actCard.appendChild(actTitle);

      const actRow = document.createElement('div');
      actRow.className = 'tp3d-editor-action-grid';

      const selectAll = makeSelectAllButton(pack, 1);
      const setCategory = makeActionButton({
        label: 'Set Category',
        iconClass: 'fa-solid fa-tag',
        onClick: () => openSetCategoryModal(pack, [inst.id]),
      });
      const visibility = makeVisibilityButton(pack, [inst.id]);
      const clear = makeActionButton({
        label: 'Deselect',
        iconClass: 'fa-solid fa-xmark',
        onClick: () => {
          StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true });
          CaseScene.setSelected([]);
        },
      });
      const duplicate = makeActionButton({
        label: 'Duplicate',
        iconClass: 'fa-solid fa-copy',
        onClick: () => duplicateSelection(pack, [inst.id]),
      });
      const deleteButton = makeActionButton({
        label: 'Delete',
        iconClass: 'fa-solid fa-trash',
        danger: true,
        onClick: () => {
          if (editorMutationBlocked()) return;
          deleteInstancesWithFeedback(pack.id, [inst.id]);
        },
      });
      actRow.appendChild(setCategory);
      actRow.appendChild(visibility);
      actRow.appendChild(selectAll);
      actRow.appendChild(clear);
      actRow.appendChild(duplicate);
      actRow.appendChild(deleteButton);
      actCard.appendChild(actRow);
      inspectorEl.appendChild(actCard);
    }

    /**
     * Creates a card header row with a title and a compact help icon.
     */
    function cardHeaderWithInfo(titleText, tooltipText) {
      const header = document.createElement('div');
      header.className = 'row space-between';
      const title = document.createElement('div');
      title.classList.add('tp3d-editor-fw-semibold');
      title.textContent = titleText;
      header.appendChild(title);

      if (tooltipText) {
        const infoIcon = document.createElement('button');
        infoIcon.type = 'button';
        infoIcon.className = 'muted tp3d-editor-info-icon';
        infoIcon.setAttribute('data-tooltip', tooltipText);
        infoIcon.setAttribute('aria-label', tooltipText);
        infoIcon.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
        header.appendChild(infoIcon);
      }

      return header;
    }

    function getLengthUnit(prefs) {
      return prefs && prefs.units && prefs.units.length ? prefs.units.length : 'in';
    }

    function displayLengthToInches(value, fallbackInches, unit) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallbackInches;
      return Utils.unitToInches(n, unit || 'in');
    }

    function inlinePositionField(axis, unit, value) {
      const wrap = document.createElement('div');
      wrap.className = 'field tp3d-editor-inline-position-field';
      wrap.classList.add('tp3d-editor-minw-90');
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = `${axis} (${unit || 'in'})`;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = 'number';
      input.step = '0.1';
      input.value = String(Number(value).toFixed(1));
      wrap.appendChild(l);
      wrap.appendChild(input);
      return { wrap, input };
    }

    function smallField(label, value) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.classList.add('tp3d-editor-minw-90');
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label;
      const input = document.createElement('input');
      input.className = 'input';
      input.type = 'number';
      input.step = '0.1';
      input.value = String(Number(value).toFixed(1));
      wrap.appendChild(l);
      wrap.appendChild(input);
      return { wrap, input };
    }

    function setPanelVisible(side, visible) {
      const isMobile = window.matchMedia('(max-width: 899px)').matches;
      const defaultCol = which => {
        const compact = window.matchMedia('(max-width: 1279px)').matches;
        if (which === 'left') return compact ? '270px' : '290px';
        return compact ? '300px' : '340px';
      };
      if (side === 'left' && !visible) {
        setCaseFiltersVisible(false, false);
      }
      if (side === 'left') {
        if (isMobile) leftEl.classList.toggle('open', visible);
        else shellEl.style.setProperty('--left-col', visible ? defaultCol('left') : '0px');
      }
      if (side === 'right') {
        if (isMobile) rightEl.classList.toggle('open', visible);
        else shellEl.style.setProperty('--right-col', visible ? defaultCol('right') : '0px');
      }

      if (StateStore.get('currentScreen') === 'editor') {
        window.requestAnimationFrame(() => {
          if (SceneManager && typeof SceneManager.resize === 'function') SceneManager.resize();
        });
      }
    }

    function togglePanel(side) {
      const isMobile = window.matchMedia('(max-width: 899px)').matches;
      if (side === 'left') {
        if (isMobile) {
          setPanelVisible('left', !leftEl.classList.contains('open'));
        } else {
          const current = getComputedStyle(shellEl).getPropertyValue('--left-col').trim() || '290px';
          setPanelVisible('left', current === '0px');
        }
      }
      if (side === 'right') {
        if (isMobile) {
          setPanelVisible('right', !rightEl.classList.contains('open'));
        } else {
          const current = getComputedStyle(shellEl).getPropertyValue('--right-col').trim() || '340px';
          setPanelVisible('right', current === '0px');
        }
      }
    }

    function wireDropToViewport(canvasEl) {
      canvasEl.addEventListener('dragover', ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
      });
      canvasEl.addEventListener('drop', ev => {
        ev.preventDefault();
        const caseId = ev.dataTransfer.getData('text/plain');
        if (!caseId) return;
        const world = worldPointOnGround(ev.clientX, ev.clientY, canvasEl);
        if (!world) {
          addCaseToPack(caseId);
          return;
        }
        const inches = SceneManager.vecWorldToInches(world);
        const c = CaseLibrary.getById(caseId);
        if (c && c.dimensions && c.dimensions.height) inches.y = Math.max(1, c.dimensions.height / 2);
        addCaseToPack(caseId, inches);
      });
    }

    function worldPointOnGround(clientX, clientY, canvasEl) {
      const camera = SceneManager.getCamera();
      if (!camera) return null;
      const rect = canvasEl.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x, y }, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const out = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(plane, out);
      return ok ? out : null;
    }

    return { init: initEditorUI, render, onActivated };
  })();

  const onDeactivated = () => { };

  return { ...EditorUI, onDeactivated };
}
