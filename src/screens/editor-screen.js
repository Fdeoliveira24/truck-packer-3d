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
    let hoveredId = null;
    let draggedId = null;
    let selectedIds = new Set();

    function clear() {
      const scene = SceneManager.getScene();
      if (!scene) return;
      instances.forEach(group => disposeGroup(scene, group));
      instances.clear();
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
      const color = String(caseData.color || CategoryService.meta(caseData.category).color || '#ff9f1c');
      return `${caseData.id}:${d.length}x${d.width}x${d.height}:${color}`;
    }

    function createInstanceGroup(inst, caseData) {
      const group = new THREE.Group();
      group.userData.instanceId = inst.id;
      group.userData.caseId = inst.caseId;
      group.userData.signature = buildSignature(inst, caseData);

      const dims = caseData.dimensions || { length: 1, width: 1, height: 1 };
      const lengthW = SceneManager.toWorld(dims.length);
      const widthW = SceneManager.toWorld(dims.width);
      const heightW = SceneManager.toWorld(dims.height);
      group.userData.halfWorld = { x: lengthW / 2, y: heightW / 2, z: widthW / 2 };

      const baseColor = String(caseData.color || CategoryService.meta(caseData.category).color || '#ff9f1c');
      group.userData.baseColor = baseColor;

      const geo = new THREE.BoxGeometry(lengthW, heightW, widthW);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(baseColor),
        roughness: 0.65,
        metalness: 0.12,
        emissive: new THREE.Color(0x000000),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.instanceId = inst.id;
      group.userData.mesh = mesh;
      group.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const edgeColor = new THREE.Color(baseColor);
      edgeColor.multiplyScalar(0.68);
      const lineMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.95 });
      const lines = new THREE.LineSegments(edges, lineMat);
      group.userData.lines = lines;
      group.add(lines);

      return group;
    }

    function disposeGroup(scene, group) {
      if (!group) return;
      scene.remove(group);
      group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }

    function applyTransform(group, inst) {
      if (!group || !inst || !inst.transform) return;
      const pos = inst.transform.position || { x: 0, y: 0, z: 0 };
      const rot = inst.transform.rotation || { x: 0, y: 0, z: 0 };
      group.position.copy(SceneManager.vecInchesToWorld(pos));
      group.rotation.set(Number(rot.x) || 0, Number(rot.y) || 0, Number(rot.z) || 0);
    }

    function applyHidden(group, hidden) {
      if (!group || !group.userData.mesh) return;
      const prefs = PreferencesManager.get();
      const mesh = group.userData.mesh;
      const lines = group.userData.lines;
      if (hidden) {
        mesh.material.transparent = true;
        mesh.material.opacity = Utils.clamp(Number(prefs.hiddenCaseOpacity) || 0.3, 0, 1);
        mesh.material.depthWrite = false;
        if (lines && lines.material) {
          lines.material.transparent = true;
          lines.material.opacity = Math.max(0.25, mesh.material.opacity);
        }
      } else {
        mesh.material.transparent = false;
        mesh.material.opacity = 1;
        mesh.material.depthWrite = true;
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
        mesh.material.emissive.setHex(isSelected ? Utils.cssHexToInt(Utils.getCssVar('--accent-primary')) : 0x000000);
      });
    }

    function applyHover(instanceId) {
      hoveredId = instanceId || null;
      instances.forEach(group => {
        const mesh = group.userData.mesh;
        if (!mesh || !mesh.material) return;
        if (
          group.userData.instanceId === hoveredId &&
          !selectedIds.has(hoveredId) &&
          group.userData.instanceId !== draggedId
        ) {
          mesh.material.emissive.setHex(0x333333);
        } else if (!selectedIds.has(group.userData.instanceId) && group.userData.instanceId !== draggedId) {
          mesh.material.emissive.setHex(0x000000);
        }
      });
    }

    function applyDragging(instanceId) {
      draggedId = instanceId || null;
      instances.forEach(group => {
        const mesh = group.userData.mesh;
        if (!mesh || !mesh.material) return;
        if (group.userData.instanceId === draggedId) {
          mesh.material.transparent = true;
          mesh.material.opacity = 0.72;
          mesh.material.emissive.setHex(0x111111);
        }
      });
    }

    function setCollision(instanceId, isCollision) {
      const group = instances.get(instanceId);
      if (!group || !group.userData.mesh) return;
      const mesh = group.userData.mesh;
      if (isCollision) {
        mesh.material.emissive.setHex(0xff0000);
      } else if (selectedIds.has(instanceId)) {
        mesh.material.emissive.setHex(Utils.cssHexToInt(Utils.getCssVar('--accent-primary')));
      } else {
        mesh.material.emissive.setHex(0x000000);
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

    function checkCollision(instanceId, candidateWorldPos) {
      const aabb = getAabbWorld(instanceId, candidateWorldPos);
      if (!aabb) return { collides: false, insideTruck: false };
      const insideTruck = isInsideTruck(aabb);
      for (const [otherId] of instances.entries()) {
        if (otherId === instanceId) continue;
        const otherAabb = getAabbWorld(otherId);
        if (!otherAabb) continue;
        if (aabbIntersects(aabb, otherAabb)) return { collides: true, insideTruck };
      }
      return { collides: false, insideTruck };
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
    let lastRaycastTime = 0;
    const RAYCAST_THROTTLE = 50; // ms - throttle hover raycasts

    function initInteraction(canvasEl) {
      domEl = canvasEl;
      domEl.classList.add('tp3d-editor-no-touch-action');
      domEl.addEventListener('pointermove', onMove);
      domEl.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      domEl.addEventListener('dblclick', onDblClick);
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
        updateDrag();
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

      dragPlane.set(new THREE.Vector3(0, 1, 0), -dragStartPosWorld.y);
      dragOffset.copy(CaseScene.getObject(draggingId).position).sub(pressed.pointWorld);

      CaseScene.setDragging(draggingId);
    }

    function updateDrag() {
      const camera = SceneManager.getCamera();
      if (!camera) return;
      raycaster.setFromCamera(pointer, camera);
      const intersection = tmpVec3;
      const ok = raycaster.ray.intersectPlane(dragPlane, intersection);
      if (!ok) return;

      const next = intersection.clone().add(dragOffset);

      // Snap (X/Z) when enabled
      const prefs = PreferencesManager.get();
      if (prefs.snapping && prefs.snapping.enabled) {
        const gridIn = Math.max(0.25, Number(prefs.snapping.gridSize) || 1);
        const gridW = SceneManager.toWorld(gridIn);
        next.x = Math.round(next.x / gridW) * gridW;
        next.z = Math.round(next.z / gridW) * gridW;
      }

      const check = CaseScene.checkCollision(draggingId, next);
      CaseScene.setCollision(draggingId, check.collides);

      const obj = CaseScene.getObject(draggingId);
      if (obj) obj.position.copy(next);
    }

    function finishDrag() {
      const instanceId = draggingId;
      const obj = CaseScene.getObject(instanceId);
      if (!obj) {
        resetDrag();
        return;
      }

      const check = CaseScene.checkCollision(instanceId, obj.position);
      if (check.collides) {
        new TWEEN.Tween(obj.position)
          .to({ x: dragStartPosWorld.x, y: dragStartPosWorld.y, z: dragStartPosWorld.z }, 240)
          .easing(TWEEN.Easing.Cubic.Out)
          .onComplete(() => {
            CaseScene.setCollision(instanceId, false);
            CaseScene.setDragging(null);
            CaseScene.setHover(hoveredId);
          })
          .start();
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
      const inst = (pack.cases || []).find(i => i.id === instanceId);
      if (!inst) {
        resetDrag();
        return;
      }

      const posInches = SceneManager.vecWorldToInches(obj.position);
      PackLibrary.updateInstance(packId, instanceId, {
        transform: { ...inst.transform, position: posInches },
      });

      UIComponents.showToast(
        check.insideTruck ? 'Case placed' : 'Placed in staging (outside truck)',
        check.insideTruck ? 'success' : 'info'
      );
      resetDrag();
    }

    function resetDrag() {
      const controls = SceneManager.getControls();
      if (controls) controls.enabled = true;
      draggingId = null;
      dragStartPosWorld = null;
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
    const shellEl = document.querySelector('.editor-shell');
    const leftEl = document.getElementById('editor-left');
    const rightEl = document.getElementById('editor-right');
    const btnLeft = document.getElementById('btn-editor-left');
    const btnRight = document.getElementById('btn-editor-right');
    const btnLeftClose = document.getElementById('btn-left-close');
    const btnRightClose = document.getElementById('btn-right-close');
    const viewportEl = document.getElementById('viewport');
    const inspectorEl = document.getElementById('inspector-body');
    const caseSearchEl = document.getElementById('editor-case-search');
    const caseFilterToggleEl = document.getElementById('editor-case-filters-toggle');
    const caseChipsEl = document.getElementById('editor-case-chips');
    const caseListEl = document.getElementById('editor-case-list');
    const btnAutopack = document.getElementById('btn-autopack');
    const btnPng = document.getElementById('btn-screenshot');
    const btnPdf = document.getElementById('btn-pdf');

    let initialized = false;
    const supportsWebGL = Utils.hasWebGL();
    const browserCats = new Set();
    let activationRaf = null;
    const caseFiltersStorageKey = 'tp3d.editor.caseBrowser.showFilters';
    let showCaseFilters = true;

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
        render();
      });
      btnPng.addEventListener('click', () => ExportService.captureScreenshot());
      btnPdf.addEventListener('click', () => ExportService.generatePDF());

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
        card.classList.add('tp3d-editor-card-padding-12', 'tp3d-editor-card-grid-gap-8');
        card.draggable = true;
        card.addEventListener('dragstart', ev => {
          ev.dataTransfer.setData('text/plain', c.id);
          ev.dataTransfer.effectAllowed = 'copy';
        });

        const header = document.createElement('div');
        header.className = 'row space-between';
        const left = document.createElement('div');
        left.classList.add('tp3d-editor-col-grid-gap-2');
        const name = document.createElement('div');
        name.classList.add('tp3d-editor-fw-semibold');
        name.textContent = c.name;
        const dims = document.createElement('div');
        dims.className = 'muted';
        dims.classList.add('tp3d-editor-fs-xs');
        dims.textContent = `${c.dimensions.length}×${c.dimensions.width}×${c.dimensions.height} in`;
        left.appendChild(name);
        left.appendChild(dims);
        header.appendChild(left);

        const metaRow = document.createElement('div');
        metaRow.className = 'row space-between';
        metaRow.classList.add('tp3d-editor-card-grid-gap-8');
        metaRow.appendChild(makeMiniCategoryChip(c.category));

        const addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary';
        addBtn.type = 'button';
        addBtn.classList.add('tp3d-editor-btn-add');
        addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
        addBtn.addEventListener('click', () => addCaseToPack(c.id));
        metaRow.appendChild(addBtn);

        card.appendChild(header);
        card.appendChild(metaRow);
        caseListEl.appendChild(card);
      });
    }

    function setCaseFiltersVisible(nextVisible, persist) {
      showCaseFilters = Boolean(nextVisible);
      if (caseChipsEl) caseChipsEl.hidden = !showCaseFilters;
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

      const count = (pack.cases || []).length;
      const caseData = CaseLibrary.getById(caseId);
      if (!caseData) return;
      const stageX = -90 - (count % 4) * 40;
      const stageZ = (Math.floor(count / 4) - 2) * 34;
      const pos = positionInches || { x: stageX, y: Math.max(1, caseData.dimensions.height / 2), z: stageZ };
      const inst = PackLibrary.addInstance(packId, caseId, pos);
      if (inst) {
        StateStore.set({ selectedInstanceIds: [inst.id] }, { skipHistory: true });
        UIComponents.showToast('Case added to pack', 'success');
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
      if (!c) return;
      renderSingleInspector(pack, inst, c, prefs);
    }

    function renderTruckInspector(pack, prefs) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');

      const stats = PackLibrary.computeStats(pack);
      card.innerHTML = `
              <div class="tp3d-editor-fw-semibold">Truck</div>
              <div class="muted tp3d-editor-fs-sm">Edit dimensions in inches (internal units). Display units follow Settings.</div>
            `;

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
      inspectorEl.appendChild(statsEl);
    }

    function renderMultiInspector(pack, selected) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');
      card.innerHTML = `
              <div class="tp3d-editor-fw-semibold">${selected.length} selected</div>
              <div class="muted tp3d-editor-fs-sm">Use keyboard shortcuts: Delete, Esc, Ctrl/Cmd+A.</div>
            `;

      const row = document.createElement('div');
      row.className = 'row';
      row.classList.add('tp3d-editor-row-justify-end');
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-danger';
      btnDelete.type = 'button';
      btnDelete.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
      btnDelete.addEventListener('click', () => InteractionManager.deleteSelection());
      const btnClear = document.createElement('button');
      btnClear.className = 'btn';
      btnClear.type = 'button';
      btnClear.innerHTML = '<i class="fa-solid fa-xmark"></i> Deselect';
      btnClear.addEventListener('click', () => StateStore.set({ selectedInstanceIds: [] }, { skipHistory: true }));
      row.appendChild(btnClear);
      row.appendChild(btnDelete);
      card.appendChild(row);
      inspectorEl.appendChild(card);
    }

    function renderSingleInspector(pack, inst, caseData, prefs) {
      const card = document.createElement('div');
      card.className = 'card';
      card.classList.add('tp3d-editor-card-grid-gap-12');

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

      const posRow = document.createElement('div');
      posRow.className = 'row';
      posRow.classList.add('tp3d-editor-row-gap-10');
      const pos = inst.transform.position || { x: 0, y: 0, z: 0 };
      const fX = smallField(`X (${prefs.units.length})`, Utils.inchesToUnit(pos.x, prefs.units.length));
      const fY = smallField(`Y (${prefs.units.length})`, Utils.inchesToUnit(pos.y, prefs.units.length));
      const fZ = smallField(`Z (${prefs.units.length})`, Utils.inchesToUnit(pos.z, prefs.units.length));
      posRow.appendChild(fX.wrap);
      posRow.appendChild(fY.wrap);
      posRow.appendChild(fZ.wrap);

      const row2 = document.createElement('div');
      row2.className = 'row';
      row2.classList.add('tp3d-editor-row-gap-10');
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
      row2.appendChild(hide);
      row2.appendChild(remove);

      const savePos = document.createElement('button');
      savePos.className = 'btn btn-primary';
      savePos.type = 'button';
      savePos.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Apply position';
      savePos.addEventListener('click', () => {
        const nextPos = {
          x: Utils.unitToInches(Number(fX.input.value) || 0, prefs.units.length),
          y: Utils.unitToInches(Number(fY.input.value) || 0, prefs.units.length),
          z: Utils.unitToInches(Number(fZ.input.value) || 0, prefs.units.length),
        };
        PackLibrary.updateInstance(pack.id, inst.id, { transform: { ...inst.transform, position: nextPos } });
        SceneManager.focusOnWorldPoint(SceneManager.vecInchesToWorld(nextPos), { duration: 420 });
        UIComponents.showToast('Position updated', 'success');
      });

      card.appendChild(posRow);
      card.appendChild(savePos);
      card.appendChild(row2);
      inspectorEl.appendChild(card);
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

  const onDeactivated = () => {};

  return { ...EditorUI, onDeactivated };
}
