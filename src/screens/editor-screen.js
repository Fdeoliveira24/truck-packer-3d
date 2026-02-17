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

// Editor screen + 3D interaction helpers (extracted from src/app.js; behavior preserved)

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
        ctx.fillStyle = '#FFFFFF';
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
          ctx.font = `${Math.floor(h * 0.07)}px Arial, sans-serif`;
          ctx.fillText(`Max: ${caseData.maxPalletWeight} lb`, w / 2, h * 0.8);
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
        keep.add(inst.id);
        const caseData = CaseLibrary.getById(inst.caseId);
        if (!caseData) return;

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

      // When orientedDims exists (from AutoPack), update halfWorld on the group
      // so that ALL downstream code (getAabbWorld, settleY, snapToNearest, drag
      // floor clamping) uses the correct rotated dimensions — not the originals.
      // Without this, flipped/rotated boxes float, snap wrong, and collide wrong.
      if (inst.orientedDims) {
        group.userData.halfWorld = {
          x: SceneManager.toWorld(inst.orientedDims.length) / 2,
          y: SceneManager.toWorld(inst.orientedDims.height) / 2,
          z: SceneManager.toWorld(inst.orientedDims.width) / 2,
        };
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
        const zonesWorld = TrailerGeometry.zonesInchesToWorld(zonesInches);
        return TrailerGeometry.isAabbContainedInAnyZone(aabb, zonesWorld);
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

    function checkCollision(instanceId, candidateWorldPos, ignoreIds) {
      const aabb = getAabbWorld(instanceId, candidateWorldPos);
      if (!aabb) return { collides: false, insideTruck: false };
      const insideTruck = isInsideTruck(aabb);

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

    /** Settle a case down via gravity: find highest surface below and place on it. */
    function settleY(instanceId) {
      const group = instances.get(instanceId);
      if (!group || !group.userData.halfWorld) return null;
      const halfY = group.userData.halfWorld.y;
      const myAabb = getAabbWorld(instanceId);
      if (!myAabb) return null;

      // Find the highest top surface of any other box that is directly below
      let floorY = halfY; // default: ground floor
      for (const [otherId, otherGroup] of instances.entries()) {
        if (otherId === instanceId) continue;
        if (!otherGroup || otherGroup.visible === false) continue;
        const otherAabb = getAabbWorld(otherId);
        if (!otherAabb) continue;
        // Check XZ overlap (is this box above the other one?)
        if (myAabb.max.x > otherAabb.min.x && myAabb.min.x < otherAabb.max.x &&
            myAabb.max.z > otherAabb.min.z && myAabb.min.z < otherAabb.max.z) {
          const topY = otherAabb.max.y + halfY;
          if (topY > floorY && otherAabb.max.y <= myAabb.min.y + 0.01) {
            floorY = topY;
          }
        }
      }
      return floorY;
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
      const tg = TrailerGeometry;
      if (tg) {
        const tw = SceneManager.toWorld(tg.width) / 2;
        const tl = SceneManager.toWorld(tg.length);
        // Truck X: 0 to length
        const candidates = [
          { myEdge: myMinX, wall: 0 },             // rear wall
          { myEdge: myMaxX, wall: tl },             // front wall
        ];
        candidates.forEach(({ myEdge, wall }) => {
          const dist = Math.abs(myEdge - wall);
          if (dist < snapXDist) {
            snapXDist = dist;
            bestX = wall + (myEdge === myMinX ? half.x : -half.x);
            snapped = true;
          }
        });
        // Truck Z: -tw to +tw
        const zCandidates = [
          { myEdge: myMinZ, wall: -tw },
          { myEdge: myMaxZ, wall: tw },
        ];
        zCandidates.forEach(({ myEdge, wall }) => {
          const dist = Math.abs(myEdge - wall);
          if (dist < snapZDist) {
            snapZDist = dist;
            bestZ = wall + (myEdge === myMinZ ? half.z : -half.z);
            snapped = true;
          }
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
  PreferencesManager,
  UIComponents,
}) {
  const InteractionManager = (() => {
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

    /**
     * Rotate selected instances by delta on given axis, then apply gravity.
     */
    function rotateSelection(axis, delta) {
      const ids = getSelection();
      if (!ids.length) { return; }
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) { return; }
      ids.forEach(id => {
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst) { return; }
        const rot = { ...(inst.transform.rotation || { x: 0, y: 0, z: 0 }) };
        rot[axis] = ((Number(rot[axis]) || 0) + delta) % (2 * Math.PI);
        PackLibrary.updateInstance(packId, id, { transform: { ...inst.transform, rotation: rot } });
        // Gravity after rotation
        requestAnimationFrame(() => {
          const settledY = CaseScene.settleY(id);
          if (settledY !== null) {
            const obj = CaseScene.getObject(id);
            if (obj) { obj.position.y = settledY; }
            const posInches = SceneManager.vecWorldToInches(obj.position);
            PackLibrary.updateInstance(packId, id, {
              transform: { ...inst.transform, rotation: rot, position: posInches },
            });
          }
        });
      });
      UIComponents.showToast(`Rotated ${ids.length} case(s)`, 'info');
    }

    /**
     * Nudge selected instances by delta inches on given world axis.
     */
    function nudgeSelection(axis, deltaInches) {
      const ids = getSelection();
      if (!ids.length) { return; }
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) { return; }
      ids.forEach(id => {
        const inst = (pack.cases || []).find(i => i.id === id);
        if (!inst) { return; }
        const pos = { ...(inst.transform.position || { x: 0, y: 0, z: 0 }) };
        pos[axis] = (Number(pos[axis]) || 0) + deltaInches;
        PackLibrary.updateInstance(packId, id, { transform: { ...inst.transform, position: pos } });
        // Gravity after nudge
        requestAnimationFrame(() => {
          const settledY = CaseScene.settleY(id);
          if (settledY !== null) {
            const obj = CaseScene.getObject(id);
            if (obj) { obj.position.y = settledY; }
            const posInches2 = SceneManager.vecWorldToInches(obj.position);
            PackLibrary.updateInstance(packId, id, {
              transform: { ...inst.transform, position: posInches2 },
            });
          }
        });
      });
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

    function finishDrag() {
      const instanceId = draggingId;
      const obj = CaseScene.getObject(instanceId);
      if (!obj) {
        resetDrag();
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

      const nextCases = (pack.cases || []).map(inst => {
        const pos = nextPositions.get(inst.id);
        if (!pos) return inst;
        return { ...inst, transform: { ...(inst.transform || {}), position: pos } };
      });
      PackLibrary.update(packId, { cases: nextCases });

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
      const ids = getSelection();
      if (!ids.length) return;
      const packId = StateStore.get('currentPackId');
      PackLibrary.removeInstances(packId, ids);
      setSelection([]);
      UIComponents.showToast(`Deleted ${ids.length} case(s)`, 'info');
    }

    return { init: initInteraction, setSelection, selectAllInPack, deleteSelection };
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

    let initialized = false;
    const supportsWebGL = Utils.hasWebGL();
    const browserCats = new Set();
    let activationRaf = null;
    const caseFiltersStorageKey = 'tp3d.editor.caseBrowser.showFilters';
    let showCaseFilters = false;
    let viewportHintOpen = false;

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
      }
      btnLeft.addEventListener('click', () => togglePanel('left'));
      btnRight.addEventListener('click', () => togglePanel('right'));
      btnLeftClose.addEventListener('click', () => setPanelVisible('left', false));
      btnRightClose.addEventListener('click', () => setPanelVisible('right', false));

      btnAutopack.addEventListener('click', async () => {
        btnAutopack.disabled = true;
        await AutoPackEngine.pack();
        btnAutopack.disabled = false;
        render();
      });
      if (btnUnpack) {
        btnUnpack.addEventListener('click', () => unpackAll());
      }
      btnPng.addEventListener('click', () => ExportService.captureScreenshot());
      btnPdf.addEventListener('click', () => ExportService.generatePDF());
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

      btnAutopack.disabled = !pack || AutoPackEngine.running;
      if (btnUnpack) btnUnpack.disabled = !pack || !(pack && (pack.cases || []).length);
      if (btnShare) btnShare.disabled = !pack;
      btnPng.disabled = !pack;
      btnPdf.disabled = !pack;

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

    function renderCaseBrowser() {
      const q = String(caseSearchEl.value || '').trim();
      const prefs = PreferencesManager.get ? PreferencesManager.get() : { units: { length: 'in', weight: 'lb' } };
      const cases = CaseLibrary.search(q, Array.from(browserCats)).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      );
      const counts = CategoryService.listWithCounts(CaseLibrary.getCases());

      caseChipsEl.innerHTML = '';
      caseChipsEl.appendChild(
        makeBrowserChip(
          'All',
          'all',
          browserCats.size === 0,
          () => {
            browserCats.clear();
            renderCaseBrowser();
          },
          '#9b9ba8'
        )
      );
      counts.forEach(c => {
        const active = browserCats.has(c.key);
        caseChipsEl.appendChild(
          makeBrowserChip(
            `${c.name}: ${c.count}`,
            c.key,
            active,
            () => {
              if (browserCats.has(c.key)) browserCats.delete(c.key);
              else browserCats.add(c.key);
              renderCaseBrowser();
            },
            c.color
          )
        );
      });
      setCaseFiltersVisible(showCaseFilters, false);

      caseListEl.innerHTML = '';
      cases.forEach(c => {
        const card = document.createElement('div');
        card.className = 'card';
        card.classList.add('tp3d-editor-card-padding-12', 'tp3d-editor-card-grid-gap-8', 'tp3d-editor-case-browser-card');
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
        const dimsValue = hasDims ? `${c.dimensions.length}×${c.dimensions.width}×${c.dimensions.height} in` : '—';
        const catMeta = CategoryService.meta(c.category || 'default');
        const volumeLabel = hasDims
          ? Utils.formatVolume(c.dimensions, (prefs.units && prefs.units.length) || 'in')
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
        const parts = [dimsValue, volumeLabel, weightLabel].filter(v => v && v !== '—');
        meta1.textContent = parts.join(' · ');

        const meta2 = document.createElement('div');
        meta2.className = 'tp3d-editor-card-dims tp3d-editor-case-meta-secondary';
        const catDot = document.createElement('span');
        catDot.className = 'chip-dot';
        catDot.style.background = catMeta.color;
        meta2.appendChild(catDot);
        const meta2Parts = [catMeta.name];
        if (c.canFlip) meta2Parts.push('Flippable');
        meta2.appendChild(document.createTextNode(' ' + meta2Parts.join(' · ')));

        card.appendChild(header);
        card.appendChild(meta1);
        card.appendChild(meta2);
        caseListEl.appendChild(card);
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

    function addCaseToPack(caseId, positionInches) {
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack) {
        UIComponents.showToast('Create or open a pack first', 'warning');
        AppShell.navigate('packs');
        return;
      }

      const caseData = CaseLibrary.getById(caseId);
      if (!caseData) return;
      const dims = caseData.dimensions || { length: 24, width: 24, height: 24 };
      const truckW = (pack.truck && pack.truck.width) || 102;
      const gap = 4;

      // Determine how many cases are currently staged (outside the truck).
      // Using total count caused new cases to spawn extremely far away after AutoPack.
      const zonesInches = TrailerGeometry.getTrailerUsableZones(pack.truck || {});
      const stagedCount = (pack.cases || []).reduce((acc, inst) => {
        if (!inst || inst.hidden) return acc;
        const c = CaseLibrary.getById(inst.caseId);
        if (!c) return acc;
        const d = c.dimensions || { length: 0, width: 0, height: 0 };
        const od = inst.orientedDims || null;
        const usedDims = {
          length: od ? od.length : d.length,
          width: od ? od.width : d.width,
          height: od ? od.height : d.height,
        };
        const p = (inst.transform && inst.transform.position) || { x: 0, y: 0, z: 0 };
        const aabb = {
          min: { x: p.x - usedDims.length / 2, y: p.y - usedDims.height / 2, z: p.z - usedDims.width / 2 },
          max: { x: p.x + usedDims.length / 2, y: p.y + usedDims.height / 2, z: p.z + usedDims.width / 2 },
        };
        const inside = TrailerGeometry.isAabbContainedInAnyZone(aabb, zonesInches);
        return inside ? acc : acc + 1;
      }, 0);

      // Place beside the truck, but cap how far we go in Z.
      // Once the staging pad is full, start a new "page" behind the truck (negative X)
      // instead of pushing Z farther and farther out.
      const cols = 6;
      const stageZBase = (truckW / 2) + 10 + dims.width / 2;
      const stagingDepth = 180; // inches away from the truck wall (keeps staging near)
      const rowsMax = Math.max(1, Math.floor(stagingDepth / Math.max(1, dims.width + gap)));
      const pageSize = cols * rowsMax;
      const page = Math.floor(stagedCount / pageSize);
      const within = stagedCount % pageSize;
      const col = within % cols;
      const row = Math.floor(within / cols);

      const stageZ = stageZBase + row * (dims.width + gap);
      let stageX;
      if (page === 0) {
        stageX = dims.length / 2 + col * (dims.length + gap);
      } else {
        const pageStride = cols * (dims.length + gap) + 20;
        stageX = -20 - dims.length / 2 - col * (dims.length + gap) - (page - 1) * pageStride;
      }

      const pos = positionInches || { x: stageX, y: Math.max(1, dims.height / 2), z: stageZ };
      const inst = PackLibrary.addInstance(packId, caseId, pos);
      if (inst) {
        StateStore.set({ selectedInstanceIds: [inst.id] }, { skipHistory: true });
        UIComponents.showToast('Case added to pack', 'success');
      }
    }

    function unpackAll() {
      const packId = StateStore.get('currentPackId');
      const pack = PackLibrary.getById(packId);
      if (!pack || !(pack.cases || []).length) {
        UIComponents.showToast('Nothing to unpack', 'info');
        return;
      }
      const truck = pack.truck || {};
      const truckW = truck.width || 102;
      const truckL = truck.length || 636;
      const gap = 4;
      // Place cases beside the truck (offset in Z), arranged in rows along X
      const stageZStart = (truckW / 2) + 10; // 10 inches beside the truck
      let curX = 0;
      let curZ = stageZStart;
      let rowMaxWidth = 0;
      const nextCases = (pack.cases || []).map(inst => {
        const c = CaseLibrary.getById(inst.caseId);
        const baseDims = (c && c.dimensions) || { length: 24, width: 24, height: 24 };
        // Respect any oriented dimensions produced by AutoPack (prevents overlap when
        // cases were rotated/flipped while packed).
        const od = inst && inst.orientedDims ? inst.orientedDims : null;
        const dims = {
          length: od ? od.length : baseDims.length,
          width: od ? od.width : baseDims.width,
          height: od ? od.height : baseDims.height,
        };
        // If we've gone past the truck length, start a new row (further from truck)
        if (curX + dims.length > truckL && curX > 0) {
          curZ += rowMaxWidth + gap;
          curX = 0;
          rowMaxWidth = 0;
        }
        const posX = curX + dims.length / 2;
        const posZ = curZ + dims.width / 2;
        const posY = Math.max(1, dims.height / 2);
        curX += dims.length + gap;
        rowMaxWidth = Math.max(rowMaxWidth, dims.width);
        return {
          ...inst,
          transform: {
            ...inst.transform,
            position: { x: posX, y: posY, z: posZ },
          },
        };
      });
      PackLibrary.update(packId, { cases: nextCases });
      UIComponents.showToast('All cases moved to staging', 'info', { title: 'Unpack' });
      render();
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
      if (!c) return;
      renderSingleInspector(pack, inst, c, prefs);
    }

    function renderTruckInspector(pack, prefs) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');

      const stats = PackLibrary.computeStats(pack);
      card.appendChild(cardHeaderWithInfo('Truck', 'Edit dimensions in inches (internal units). Display units follow Settings.'));

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
      presetSelect.value = inferPresetIdFromTruck(pack.truck);

      presetSelect.addEventListener('change', () => {
        const id = String(presetSelect.value || 'custom');
        if (id === 'custom') return;
        const preset = TrailerPresets.getById(id);
        if (!preset) return;
        const nextTruck = TrailerPresets.applyToTruck(pack.truck, preset);
        PackLibrary.update(pack.id, { truck: nextTruck });
        UIComponents.showToast(`Applied preset: ${preset.label}`, 'success');
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
        pack && pack.truck && (pack.truck.shapeMode === 'wheelWells' || pack.truck.shapeMode === 'frontBonus')
          ? pack.truck.shapeMode
          : 'rect';
      shapeWrap.appendChild(shapeLabel);
      shapeWrap.appendChild(shapeSelect);
      shapeRow.appendChild(shapeWrap);

      card.appendChild(presetRow);
      const dimsRow = document.createElement('div');
      dimsRow.className = 'row';
      dimsRow.classList.add('tp3d-editor-dims-row');
      const fL = smallField('Length (in)', pack.truck.length);
      const fW = smallField('Width (in)', pack.truck.width);
      const fH = smallField('Height (in)', pack.truck.height);
      [fL.wrap, fW.wrap, fH.wrap].forEach(wrap => wrap.classList.add('tp3d-editor-field-wrap-full'));
      dimsRow.appendChild(fL.wrap);
      dimsRow.appendChild(fW.wrap);
      dimsRow.appendChild(fH.wrap);

      const btnSave = document.createElement('button');
      btnSave.className = 'btn btn-primary';
      btnSave.type = 'button';
      btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update truck';
      btnSave.classList.add('tp3d-editor-btn-full');
      btnSave.addEventListener('click', () => {
        const next = {
          ...pack.truck,
          length: Math.max(24, Number(fL.input.value) || pack.truck.length),
          width: Math.max(24, Number(fW.input.value) || pack.truck.width),
          height: Math.max(24, Number(fH.input.value) || pack.truck.height),
          shapeMode:
            pack.truck && (pack.truck.shapeMode === 'wheelWells' || pack.truck.shapeMode === 'frontBonus')
              ? pack.truck.shapeMode
              : 'rect',
          shapeConfig:
            pack.truck && pack.truck.shapeConfig && typeof pack.truck.shapeConfig === 'object'
              ? Utils.deepClone(pack.truck.shapeConfig)
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
          if (Number.isFinite(cfg.bonusWidth)) cfg.bonusWidth = Utils.clamp(Number(cfg.bonusWidth), 0, next.width);
          if (Number.isFinite(cfg.bonusHeight)) cfg.bonusHeight = Utils.clamp(Number(cfg.bonusHeight), 0, next.height);
          next.shapeConfig = cfg;
        }

        PackLibrary.update(pack.id, { truck: next });
        UIComponents.showToast('Truck updated', 'success');
      });

      shapeSelect.addEventListener('change', () => {
        const mode = String(shapeSelect.value || 'rect');
        const nextTruck = {
          ...pack.truck,
          shapeMode: mode === 'wheelWells' || mode === 'frontBonus' ? mode : 'rect',
          shapeConfig:
            pack.truck && pack.truck.shapeConfig && typeof pack.truck.shapeConfig === 'object'
              ? Utils.deepClone(pack.truck.shapeConfig)
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
          if (!Number.isFinite(cfg.bonusWidth)) cfg.bonusWidth = nextTruck.width;
          if (!Number.isFinite(cfg.bonusHeight)) cfg.bonusHeight = nextTruck.height;
          cfg.bonusLength = Utils.clamp(Number(cfg.bonusLength) || 0, 0, nextTruck.length);
          cfg.bonusWidth = Utils.clamp(Number(cfg.bonusWidth) || 0, 0, nextTruck.width);
          cfg.bonusHeight = Utils.clamp(Number(cfg.bonusHeight) || 0, 0, nextTruck.height);
          nextTruck.shapeConfig = cfg;
        }

        const zonesInches = TrailerGeometry.getTrailerUsableZones(nextTruck);
        const rectZone = [
          {
            min: { x: 0, y: 0, z: -nextTruck.width / 2 },
            max: { x: nextTruck.length, y: nextTruck.height, z: nextTruck.width / 2 },
          },
        ];
        let outOfBoundsCount = 0;
        (pack.cases || []).forEach(inst => {
          if (!inst || inst.hidden) return;
          const c = CaseLibrary.getById(inst.caseId);
          if (!c) return;
          const dims = c.dimensions || { length: 0, width: 0, height: 0 };
          const pos = inst.transform && inst.transform.position ? inst.transform.position : { x: 0, y: 0, z: 0 };
          const half = { x: dims.length / 2, y: dims.height / 2, z: dims.width / 2 };
          const aabb = {
            min: { x: pos.x - half.x, y: pos.y - half.y, z: pos.z - half.z },
            max: { x: pos.x + half.x, y: pos.y + half.y, z: pos.z + half.z },
          };
          const wasInsideRect = TrailerGeometry.isAabbContainedInAnyZone(aabb, rectZone);
          const insideNew = TrailerGeometry.isAabbContainedInAnyZone(aabb, zonesInches);
          if (wasInsideRect && !insideNew) outOfBoundsCount++;
        });

        PackLibrary.update(pack.id, { truck: nextTruck });
        if (outOfBoundsCount > 0) {
          UIComponents.showToast('Some items may be out of bounds for this trailer shape.', 'warning');
        }
      });

      const statsEl = document.createElement('div');
      statsEl.className = 'card';
      statsEl.classList.add('tp3d-editor-stats-card');
      statsEl.innerHTML = `
              <div class="tp3d-editor-fw-semibold">Stats</div>
              <div class="muted tp3d-editor-fs-sm">Cases loaded: <b class="tp3d-text-primary">${stats.totalCases}</b></div>
              <div class="muted tp3d-editor-fs-sm">Packed (in truck): <b class="tp3d-text-primary">${stats.packedCases}</b></div>
              <div class="muted tp3d-editor-fs-sm">Volume used: <b class="tp3d-text-primary">${stats.volumePercent.toFixed(1)}%</b></div>
              <div class="muted tp3d-editor-fs-sm">Total weight: <b class="tp3d-text-primary">${Utils.formatWeight(stats.totalWeight, prefs.units.weight)}</b></div>
            `;

      card.appendChild(shapeRow);
      card.appendChild(dimsRow);
      card.appendChild(btnSave);
      inspectorEl.appendChild(card);

      // === Shape Config Card (Overhang / Wheel Wells) ===
      const currentMode = pack.truck && pack.truck.shapeMode ? pack.truck.shapeMode : 'rect';
      if (currentMode === 'frontBonus' || currentMode === 'wheelWells') {
        const cfgCard = document.createElement('div');
        cfgCard.className = 'card';
        cfgCard.classList.add('tp3d-editor-card-grid-gap-12');

        const cfg = (pack.truck && pack.truck.shapeConfig && typeof pack.truck.shapeConfig === 'object')
          ? pack.truck.shapeConfig : {};
        const tL = pack.truck.length || 636;
        const tW = pack.truck.width || 102;
        const tH = pack.truck.height || 110;

        if (currentMode === 'frontBonus') {
          cfgCard.appendChild(cardHeaderWithInfo(
            'Front Overhang',
            'Extra space at the front of the truck (cab side). Dimensions in inches. Must not exceed container bounds.'
          ));

          const defBL = Math.round(0.12 * tL);
          const defBW = tW;
          const defBH = tH;
          const bonusLength = Number.isFinite(cfg.bonusLength) ? cfg.bonusLength : defBL;
          const bonusWidth = Number.isFinite(cfg.bonusWidth) ? cfg.bonusWidth : defBW;
          const bonusHeight = Number.isFinite(cfg.bonusHeight) ? cfg.bonusHeight : defBH;

          const cfgRow = document.createElement('div');
          cfgRow.className = 'tp3d-editor-dims-row';
          const fBL = smallField('Length', bonusLength);
          const fBW = smallField('Width', bonusWidth);
          const fBH = smallField('Height', bonusHeight);
          [fBL.wrap, fBW.wrap, fBH.wrap].forEach(w => w.classList.add('tp3d-editor-field-wrap-full'));
          cfgRow.appendChild(fBL.wrap);
          cfgRow.appendChild(fBW.wrap);
          cfgRow.appendChild(fBH.wrap);
          cfgCard.appendChild(cfgRow);

          const btnRow = document.createElement('div');
          btnRow.className = 'row';
          btnRow.classList.add('tp3d-editor-row-gap-10');

          const cfgSave = document.createElement('button');
          cfgSave.className = 'btn btn-primary';
          cfgSave.type = 'button';
          cfgSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update';
          cfgSave.addEventListener('click', () => {
            const nextCfg = {
              bonusLength: Utils.clamp(Number(fBL.input.value) || 0, 0, tL),
              bonusWidth: Utils.clamp(Number(fBW.input.value) || 0, 0, tW),
              bonusHeight: Utils.clamp(Number(fBH.input.value) || 0, 0, tH),
            };
            const nextTruck = { ...pack.truck, shapeConfig: nextCfg };
            PackLibrary.update(pack.id, { truck: nextTruck });
            UIComponents.showToast('Overhang updated', 'success');
          });

          const cfgReset = document.createElement('button');
          cfgReset.className = 'btn';
          cfgReset.type = 'button';
          cfgReset.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
          cfgReset.setAttribute('data-tooltip', 'Reset to defaults for this truck size');
          cfgReset.addEventListener('click', () => {
            fBL.input.value = String(defBL.toFixed(1));
            fBW.input.value = String(defBW.toFixed(1));
            fBH.input.value = String(defBH.toFixed(1));
            const nextCfg = { bonusLength: defBL, bonusWidth: defBW, bonusHeight: defBH };
            const nextTruck = { ...pack.truck, shapeConfig: nextCfg };
            PackLibrary.update(pack.id, { truck: nextTruck });
            UIComponents.showToast('Overhang reset to defaults', 'info');
          });

          btnRow.appendChild(cfgSave);
          btnRow.appendChild(cfgReset);
          cfgCard.appendChild(btnRow);
        }

        if (currentMode === 'wheelWells') {
          cfgCard.appendChild(cardHeaderWithInfo(
            'Wheel Wells',
            'Blocked zones on each side of the truck. Dimensions in inches. Wells are symmetric left/right.'
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
          const fWH = smallField('Height', wellHeight);
          const fWW = smallField('Width', wellWidth);
          const fWL = smallField('Length', wellLength);
          [fWH.wrap, fWW.wrap, fWL.wrap].forEach(w => w.classList.add('tp3d-editor-field-wrap-full'));
          cfgRow1.appendChild(fWH.wrap);
          cfgRow1.appendChild(fWW.wrap);
          cfgRow1.appendChild(fWL.wrap);
          cfgCard.appendChild(cfgRow1);

          const fWO = smallField('Offset from rear', wellOffset);
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
              wellHeight: Utils.clamp(Number(fWH.input.value) || 0, 0, tH),
              wellWidth: Utils.clamp(Number(fWW.input.value) || 0, 0, tW / 2),
              wellLength: Utils.clamp(Number(fWL.input.value) || 0, 0, tL),
              wellOffsetFromRear: Utils.clamp(Number(fWO.input.value) || 0, 0, tL),
            };
            if (nextCfg.wellOffsetFromRear + nextCfg.wellLength > tL) {
              nextCfg.wellLength = tL - nextCfg.wellOffsetFromRear;
            }
            const nextTruck = { ...pack.truck, shapeConfig: nextCfg };
            PackLibrary.update(pack.id, { truck: nextTruck });
            UIComponents.showToast('Wheel wells updated', 'success');
          });

          const cfgReset = document.createElement('button');
          cfgReset.className = 'btn';
          cfgReset.type = 'button';
          cfgReset.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> Reset';
          cfgReset.setAttribute('data-tooltip', 'Reset to defaults for this truck size');
          cfgReset.addEventListener('click', () => {
            fWH.input.value = String(defWH.toFixed(1));
            fWW.input.value = String(defWW.toFixed(1));
            fWL.input.value = String(defWL.toFixed(1));
            fWO.input.value = String(defWO.toFixed(1));
            const nextCfg = {
              wellHeight: defWH, wellWidth: defWW,
              wellLength: defWL, wellOffsetFromRear: defWO,
            };
            const nextTruck = { ...pack.truck, shapeConfig: nextCfg };
            PackLibrary.update(pack.id, { truck: nextTruck });
            UIComponents.showToast('Wheel wells reset to defaults', 'info');
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
      const hint = document.createElement('div');
      hint.className = 'muted tp3d-editor-fs-sm';
      hint.textContent = 'Shift+Click to add/remove. Ctrl/Cmd+A select all. Delete to remove.';
      card.appendChild(hint);
      inspectorEl.appendChild(card);

      // === Batch Rotation Card ===
      const rotCard = document.createElement('div');
      rotCard.className = 'card';
      rotCard.classList.add('tp3d-editor-card-grid-gap-12');
      rotCard.appendChild(cardHeaderWithInfo('Rotate All', 'Keys: R=Y90° T=X90° E=Z90° F=Flip'));

      const halfPI = Math.PI / 2;
      const rotRow = document.createElement('div');
      rotRow.className = 'tp3d-editor-rot-grid';
      [
        { label: 'Y 90°', axis: 'y', delta: halfPI },
        { label: 'X 90°', axis: 'x', delta: halfPI },
        { label: 'Z 90°', axis: 'z', delta: halfPI },
        { label: 'Flip', axis: 'x', delta: Math.PI },
      ].forEach(({ label, axis, delta }) => {
        const btn = document.createElement('button');
        btn.className = 'btn tp3d-editor-rot-btn';
        btn.type = 'button';
        btn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> ${label}`;
        btn.addEventListener('click', () => {
          selected.forEach(id => {
            const inst = (pack.cases || []).find(i => i.id === id);
            if (!inst) { return; }
            const rot = { ...(inst.transform.rotation || { x: 0, y: 0, z: 0 }) };
            rot[axis] = ((Number(rot[axis]) || 0) + delta) % (2 * Math.PI);
            PackLibrary.updateInstance(pack.id, id, { transform: { ...inst.transform, rotation: rot } });
          });
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
      actRow.className = 'row';

      const btnSetCategory = document.createElement('button');
      btnSetCategory.className = 'btn';
      btnSetCategory.type = 'button';
      btnSetCategory.innerHTML = '<i class="fa-solid fa-tag"></i> Set Category';
      btnSetCategory.addEventListener('click', () => {
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
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = initialMeta.color || '#9ca3af';
        row2.appendChild(colorLabel);
        row2.appendChild(colorInput);
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
      });

      const btnHide = document.createElement('button');
      btnHide.className = 'btn';
      btnHide.type = 'button';
      btnHide.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide';
      btnHide.addEventListener('click', () => {
        selected.forEach(id => PackLibrary.updateInstance(pack.id, id, { hidden: true }));
      });

      const btnShow = document.createElement('button');
      btnShow.className = 'btn';
      btnShow.type = 'button';
      btnShow.innerHTML = '<i class="fa-solid fa-eye"></i> Show';
      btnShow.addEventListener('click', () => {
        selected.forEach(id => PackLibrary.updateInstance(pack.id, id, { hidden: false }));
      });

      const btnClear = document.createElement('button');
      btnClear.className = 'btn';
      btnClear.type = 'button';
      btnClear.innerHTML = '<i class="fa-solid fa-xmark"></i> Deselect';
      btnClear.addEventListener('click', () => StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true }));

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-danger';
      btnDelete.type = 'button';
      btnDelete.innerHTML = `<i class="fa-solid fa-trash"></i> Delete (${selected.length})`;
      btnDelete.addEventListener('click', () => InteractionManager.deleteSelection());

      actRow.appendChild(btnHide);
      actRow.appendChild(btnShow);
      actRow.appendChild(btnSetCategory);
      actRow.appendChild(btnClear);
      actRow.appendChild(btnDelete);
      actCard.appendChild(actRow);
      inspectorEl.appendChild(actCard);
    }

    function renderSingleInspector(pack, inst, caseData, prefs) {
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
      sub.textContent = `${mfg} • ${d.length}×${d.width}×${d.height} in`;
      header.appendChild(title);
      header.appendChild(sub);
      card.appendChild(header);
      card.appendChild(makeMiniCategoryChip(caseData.category));

      inspectorEl.appendChild(card);

      // === Transform Card (Position + Rotate / Flip) ===
      const transformCard = document.createElement('div');
      transformCard.className = 'card';
      transformCard.classList.add('tp3d-editor-card-grid-gap-12', 'tp3d-editor-transform-card');
      transformCard.appendChild(cardHeaderWithInfo('Transform', 'Keys: R=Y90° T=X90° E=Z90° F=Flip'));

      const posTitle = document.createElement('div');
      posTitle.className = 'label';
      posTitle.textContent = 'Position';
      transformCard.appendChild(posTitle);

      const posRow = document.createElement('div');
      posRow.className = 'tp3d-editor-dims-row';
      const pos = inst.transform.position || { x: 0, y: 0, z: 0 };
      const fX = smallField(`X (${prefs.units.length})`, Utils.inchesToUnit(pos.x, prefs.units.length));
      const fY = smallField(`Y (${prefs.units.length})`, Utils.inchesToUnit(pos.y, prefs.units.length));
      const fZ = smallField(`Z (${prefs.units.length})`, Utils.inchesToUnit(pos.z, prefs.units.length));
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
          x: Utils.unitToInches(Number(fX.input.value) || 0, prefs.units.length),
          y: Utils.unitToInches(Number(fY.input.value) || 0, prefs.units.length),
          z: Utils.unitToInches(Number(fZ.input.value) || 0, prefs.units.length),
        };
        PackLibrary.updateInstance(pack.id, inst.id, { transform: { ...inst.transform, position: nextPos } });
        // Apply gravity after position update
        const settledY = CaseScene.settleY(inst.id);
        if (settledY !== null) {
          const obj = CaseScene.getObject(inst.id);
          if (obj) { obj.position.y = settledY; }
          const settledInches = SceneManager.vecWorldToInches({ x: 0, y: settledY, z: 0 });
          nextPos.y = settledInches.y;
          PackLibrary.updateInstance(pack.id, inst.id, { transform: { ...inst.transform, position: nextPos } });
        }
        SceneManager.focusOnWorldPoint(SceneManager.vecInchesToWorld(nextPos), { duration: 420 });
        UIComponents.showToast('Position updated', 'success');
      });
      transformCard.appendChild(savePos);

      const divider = document.createElement('div');
      divider.className = 'tp3d-editor-transform-divider';
      transformCard.appendChild(divider);

      const rotTitle = document.createElement('div');
      rotTitle.className = 'label';
      rotTitle.textContent = 'Rotate / Flip';
      transformCard.appendChild(rotTitle);

      const rot = inst.transform.rotation || { x: 0, y: 0, z: 0 };
      const halfPI = Math.PI / 2;
      const rotRow = document.createElement('div');
      rotRow.className = 'tp3d-editor-rot-grid';
      [
        { label: 'Y 90°', icon: 'fa-rotate-right', axis: 'y', delta: halfPI },
        { label: 'X 90°', icon: 'fa-rotate-right', axis: 'x', delta: halfPI },
        { label: 'Z 90°', icon: 'fa-rotate-right', axis: 'z', delta: halfPI },
        { label: 'Flip', icon: 'fa-arrows-up-down', axis: 'x', delta: Math.PI },
      ].forEach(({ label, icon, axis, delta }) => {
        const btn = document.createElement('button');
        btn.className = 'btn tp3d-editor-rot-btn';
        btn.type = 'button';
        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
        btn.addEventListener('click', () => {
          const curRot = { ...rot };
          curRot[axis] = ((Number(curRot[axis]) || 0) + delta) % (2 * Math.PI);
          PackLibrary.updateInstance(pack.id, inst.id, {
            transform: { ...inst.transform, rotation: curRot },
          });
          // Apply gravity after rotation
          requestAnimationFrame(() => {
            const settledY = CaseScene.settleY(inst.id);
            if (settledY !== null) {
              const obj = CaseScene.getObject(inst.id);
              if (obj) { obj.position.y = settledY; }
              const posInches = SceneManager.vecWorldToInches(obj.position);
              PackLibrary.updateInstance(pack.id, inst.id, {
                transform: { ...inst.transform, rotation: curRot, position: posInches },
              });
            }
          });
        });
        rotRow.appendChild(btn);
      });
      transformCard.appendChild(rotRow);
      inspectorEl.appendChild(transformCard);

      // === Actions Card ===
      const actCard = document.createElement('div');
      actCard.className = 'card';
      actCard.classList.add('tp3d-editor-card-grid-gap-12');
      const actTitle = document.createElement('div');
      actTitle.classList.add('tp3d-editor-fw-semibold');
      actTitle.textContent = 'Actions';
      actCard.appendChild(actTitle);

      const actRow = document.createElement('div');
      actRow.className = 'row';
      actRow.classList.add('tp3d-editor-row-gap-10');
      const hide = document.createElement('button');
      hide.className = 'btn';
      hide.type = 'button';
      hide.innerHTML = inst.hidden
        ? '<i class="fa-solid fa-eye"></i> Unhide'
        : '<i class="fa-solid fa-eye-slash"></i> Hide';
      hide.addEventListener('click', () => PackLibrary.updateInstance(pack.id, inst.id, { hidden: !inst.hidden }));
      const remove = document.createElement('button');
      remove.className = 'btn btn-danger';
      remove.type = 'button';
      remove.innerHTML = '<i class="fa-solid fa-trash"></i> Remove';
      remove.addEventListener('click', () => {
        PackLibrary.removeInstances(pack.id, [inst.id]);
        StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true });
      });
      actRow.appendChild(hide);
      actRow.appendChild(remove);
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
