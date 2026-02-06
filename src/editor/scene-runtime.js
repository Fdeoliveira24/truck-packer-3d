/**
 * @file scene-runtime.js
 * @description 3D scene runtime for the Editor, including renderer lifecycle and scene updates.
 * @module editor/scene-runtime
 * @created Unknown
 * @updated 01/22/2026
 * @author Truck Packer 3D Team
 */

// ============================================================================
// SECTION: IMPORTS AND DEPENDENCIES
// ============================================================================

// Editor scene runtime (extracted from src/app.js; behavior preserved)

export function createSceneRuntime({ Utils, UIComponents, PreferencesManager: _PreferencesManager, TrailerGeometry, StateStore }) {
  const SceneManager = (() => {
    const INCH_TO_WORLD = 0.05;
    const WORLD_TO_INCH = 1 / INCH_TO_WORLD;
    let containerEl = null;
    let scene = null;
    let camera = null;
    let renderer = null;
    let controls = null;
    let truck = null;
    let truckBoundsWorld = null;
    let truckSignature = '';
    let trailerShapeGuides = null;
    let trailerShapeGuidesSig = '';
    let grid = null;
    let ground = null;
    let axisScene = null;
    let axisCamera = null;
    let axisHelper = null;
    const perf = { lastTime: 0, lowMs: 0, perfMode: false, fps: 60 };
    let viewSize = { width: 1, height: 1 };

    // Dev-only performance overlay
    const DevOverlay = (() => {
      let overlayEl = null;
      let visible = false;
      const stats = { fps: 0, frameTime: 0, memory: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
      let lastLogTime = 0;

      function create() {
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.85);
                color: #0f0;
                font-family: 'Courier New', monospace;
                font-size: 11px;
                padding: 8px 12px;
                border-radius: 4px;
                z-index: 10000;
                line-height: 1.5;
                pointer-events: none;
                display: none;
                min-width: 180px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.5);
              `;
        document.body.appendChild(overlayEl);
      }

      function toggle() {
        create();
        visible = !visible;
        overlayEl.style.display = visible ? 'block' : 'none';
        if (visible) {
          console.log('[DevOverlay] Performance monitoring enabled (press P to toggle)');
        }
      }

      function update(time, rendererInfo) {
        if (!visible || !overlayEl) return;

        stats.fps = Math.round(perf.fps);
        stats.frameTime = Math.round((1000 / perf.fps) * 10) / 10;

        if (rendererInfo) {
          stats.drawCalls = rendererInfo.render.calls;
          stats.triangles = rendererInfo.render.triangles;
          stats.geometries = rendererInfo.memory.geometries;
          stats.textures = rendererInfo.memory.textures;
        }

        const perfAny = /** @type {any} */ (performance);
        if (perfAny.memory) {
          stats.memory = Math.round(perfAny.memory.usedJSHeapSize / 1048576);
        }

        const fpsColor = stats.fps >= 55 ? '#0f0' : stats.fps >= 30 ? '#ff0' : '#f00';
        overlayEl.innerHTML = `
                <div style="color: ${fpsColor}; font-weight: bold;">FPS: ${stats.fps}</div>
                <div>Frame: ${stats.frameTime}ms</div>
                ${stats.memory ? `<div>Memory: ${stats.memory}MB</div>` : ''}
                <div style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;">
                  <div>Calls: ${stats.drawCalls}</div>
                  <div>Tris: ${stats.triangles}</div>
                  <div>Geom: ${stats.geometries}</div>
                  <div>Tex: ${stats.textures}</div>
                </div>
              `;

        // Log stats every 10 seconds
        if (time - lastLogTime > 10000) {
          lastLogTime = time;
          console.log('[DevOverlay] Stats:', {
            fps: stats.fps,
            frameTime: stats.frameTime + 'ms',
            memory: stats.memory ? stats.memory + 'MB' : 'N/A',
            renderer: {
              drawCalls: stats.drawCalls,
              triangles: stats.triangles,
              geometries: stats.geometries,
              textures: stats.textures,
            },
          });
        }
      }

      function isVisible() {
        return visible;
      }

      return { toggle, update, isVisible };
    })();

    function toWorld(inches) {
      return Number(inches) * INCH_TO_WORLD;
    }

    function toInches(worldUnits) {
      return Number(worldUnits) * WORLD_TO_INCH;
    }

    function vecInchesToWorld(pos) {
      return new THREE.Vector3(toWorld(pos.x), toWorld(pos.y), toWorld(pos.z));
    }

    function vecWorldToInches(vec) {
      return { x: toInches(vec.x), y: toInches(vec.y), z: toInches(vec.z) };
    }

    function initScene(viewportEl) {
      if (renderer) return;
      containerEl = viewportEl;
      containerEl.innerHTML = '';

      scene = new THREE.Scene();
      refreshTheme();

      const { width, height } = getContainerSize();
      camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 5000);
      camera.position.set(22, 16, 22);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      viewSize = { width, height };
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      containerEl.appendChild(renderer.domElement);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.minDistance = 6;
      controls.maxDistance = 220;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.target.set(14, 2, 0);

      addLighting();
      addEnvironment();
      addAxisWidget();

      // Default truck size (53ft trailer)
      setTruck({ length: 636, width: 102, height: 98 });

      requestAnimationFrame(tick);
    }

    function getContainerSize() {
      const rect = containerEl.getBoundingClientRect();
      const width = Math.max(10, Math.floor(rect.width));
      const height = Math.max(10, Math.floor(rect.height));
      return { width, height };
    }

    function addLighting() {
      const ambient = new THREE.AmbientLight(0xffffff, 0.62);
      scene.add(ambient);

      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(30, 60, 25);
      dir.castShadow = true;
      dir.shadow.mapSize.width = 1024;
      dir.shadow.mapSize.height = 1024;
      dir.shadow.camera.left = -80;
      dir.shadow.camera.right = 80;
      dir.shadow.camera.top = 80;
      dir.shadow.camera.bottom = -80;
      scene.add(dir);

      const hemi = new THREE.HemisphereLight(0x87ceeb, 0x2d2d2d, 0.25);
      scene.add(hemi);
    }

    function addEnvironment() {
      const groundGeo = new THREE.PlaneGeometry(260, 260);
      const groundMat = new THREE.ShadowMaterial({ opacity: 0.18 });
      ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      grid = new THREE.GridHelper(220, 110);
      grid.name = 'grid';
      scene.add(grid);
      refreshTheme();
    }

    function addAxisWidget() {
      axisScene = new THREE.Scene();
      axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
      axisHelper = new THREE.AxesHelper(3.2);
      axisScene.add(axisHelper);
    }

    function tick(time) {
      requestAnimationFrame(tick);
      if (StateStore.get('currentScreen') !== 'editor') return;
      if (controls) controls.update();
      if (window.TWEEN) window.TWEEN.update(time);
      updatePerf(time);
      render();
      if (DevOverlay.isVisible() && renderer) {
        DevOverlay.update(time, renderer.info);
      }
    }

    function updatePerf(time) {
      if (!perf.lastTime) {
        perf.lastTime = time;
        return;
      }
      const dt = Math.max(1, time - perf.lastTime);
      perf.lastTime = time;
      const fps = 1000 / dt;
      perf.fps = perf.fps * 0.9 + fps * 0.1;
      if (perf.fps < 30) perf.lowMs += dt;
      else perf.lowMs = 0;

      if (!perf.perfMode && perf.lowMs > 5000) {
        perf.perfMode = true;
        renderer.shadowMap.enabled = false;
        UIComponents.showToast('Performance mode enabled (shadows disabled)', 'warning', {
          title: 'Performance',
          actions: [
            {
              label: 'Restore',
              onClick: () => {
                perf.perfMode = false;
                perf.lowMs = 0;
                renderer.shadowMap.enabled = true;
              },
            },
          ],
        });
      }
    }

    function render() {
      if (!renderer || !scene || !camera) return;
      const width = viewSize.width;
      const height = viewSize.height;
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.render(scene, camera);

      // Axis widget render (top-right)
      renderer.clearDepth();
      const size = Math.max(90, Math.floor(Math.min(width, height) * 0.2));
      const pad = 12;
      renderer.setScissorTest(true);
      renderer.setViewport(width - size - pad, pad, size, size);
      renderer.setScissor(width - size - pad, pad, size, size);
      axisCamera.position.copy(camera.position).sub(controls.target).setLength(8);
      axisCamera.lookAt(axisScene.position);
      renderer.render(axisScene, axisCamera);
      renderer.setScissorTest(false);
    }

    function resize() {
      if (!renderer || !camera || !containerEl) return;
      const { width, height } = getContainerSize();
      if (width === viewSize.width && height === viewSize.height) return;
      viewSize = { width, height };
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
    }

    function refreshTheme() {
      if (!scene) return;
      const bgHex = Utils.getCssVar('--bg-primary');
      scene.background = new THREE.Color(Utils.cssHexToInt(bgHex));
      if (grid && grid.material) {
        const gridMat = grid.material;
        const mainColor = new THREE.Color(Utils.cssHexToInt(Utils.getCssVar('--accent-primary')));
        const subColor = new THREE.Color(Utils.cssHexToInt(Utils.getCssVar('--border-strong')));
        if (Array.isArray(gridMat)) {
          if (gridMat[0]) gridMat[0].color = mainColor;
          if (gridMat[1]) gridMat[1].color = subColor;
        } else {
          gridMat.color = subColor;
        }
      }
    }

    function disposeObject3D(root) {
      if (!root) return;
      root.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m && m.dispose && m.dispose());
          else obj.material.dispose();
        }
      });
    }

    function clearTrailerShapeGuides() {
      if (!trailerShapeGuides) return;
      if (truck) truck.remove(trailerShapeGuides);
      disposeObject3D(trailerShapeGuides);
      trailerShapeGuides = null;
      if (scene && scene.userData) scene.userData.shapeGuides = null;
    }

    function buildGuideSig(mode, zonesInches) {
      const parts = (zonesInches || [])
        .map(z => `${z.min.x},${z.min.y},${z.min.z},${z.max.x},${z.max.y},${z.max.z}`)
        .join('|');
      return `${mode || 'rect'}:${parts}`;
    }

    function addGuideBox(group, aabbInches, options = {}) {
      const min = {
        x: toWorld(aabbInches.min.x),
        y: toWorld(aabbInches.min.y),
        z: toWorld(aabbInches.min.z),
      };
      const max = {
        x: toWorld(aabbInches.max.x),
        y: toWorld(aabbInches.max.y),
        z: toWorld(aabbInches.max.z),
      };
      const sx = max.x - min.x;
      const sy = max.y - min.y;
      const sz = max.z - min.z;
      if (sx <= 1e-9 || sy <= 1e-9 || sz <= 1e-9) return;

      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const cz = (min.z + max.z) / 2;

      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const fillMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(options.fillColor || 0xff3b30),
        transparent: true,
        opacity: Number.isFinite(options.opacity) ? options.opacity : 0.22,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, fillMat);
      mesh.position.set(cx, cy, cz);
      group.add(mesh);

      const edgeGeo = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(options.lineColor || options.fillColor || 0xff3b30),
        transparent: true,
        opacity: Number.isFinite(options.lineOpacity) ? options.lineOpacity : 0.7,
      });
      const wire = new THREE.LineSegments(edgeGeo, lineMat);
      wire.position.copy(mesh.position);
      group.add(wire);
    }

    function updateTrailerShapeGuides(truckInches) {
      if (!scene) return;
      const mode = truckInches && truckInches.shapeMode ? truckInches.shapeMode : 'rect';

      let guideZones = [];
      if (mode === 'wheelWells') {
        guideZones = TrailerGeometry.getWheelWellsBlockedZones(truckInches);
      } else if (mode === 'frontBonus') {
        const bonus = TrailerGeometry.getFrontBonusZone(truckInches);
        guideZones = bonus ? [bonus] : [];
      }

      const nextSig = buildGuideSig(mode, guideZones);
      if (!guideZones.length) {
        trailerShapeGuidesSig = nextSig;
        clearTrailerShapeGuides();
        return;
      }
      if (nextSig === trailerShapeGuidesSig && trailerShapeGuides) return;

      clearTrailerShapeGuides();
      trailerShapeGuidesSig = nextSig;

      if (!truck || !guideZones.length) return;
      const group = new THREE.Group();
      group.name = 'truckShapeGuides';

      if (mode === 'wheelWells') {
        guideZones.forEach(z => {
          addGuideBox(group, z, { fillColor: 0xff3b30, lineColor: 0xff3b30, opacity: 0.18, lineOpacity: 0.6 });
        });
      } else if (mode === 'frontBonus') {
        guideZones.forEach(z => {
          addGuideBox(group, z, { fillColor: 0x4a9eff, lineColor: 0x4a9eff, opacity: 0.14, lineOpacity: 0.55 });
        });
      }

      if (!group.children.length) return;
      truck.add(group);
      trailerShapeGuides = group;
      if (scene.userData) scene.userData.shapeGuides = group;
    }

    function setTruck(truckInches) {
      if (!scene) return;
      const sig = `${truckInches.length}x${truckInches.width}x${truckInches.height}`;
      const lengthW = toWorld(truckInches.length);
      const widthW = toWorld(truckInches.width);
      const heightW = toWorld(truckInches.height);

      if (truck && truckSignature === sig) {
        truckBoundsWorld = new THREE.Box3(
          new THREE.Vector3(0, 0, -widthW / 2),
          new THREE.Vector3(lengthW, heightW, widthW / 2)
        );
        controls.target.set(lengthW / 2, Math.min(6, heightW / 2), 0);
        updateTrailerShapeGuides(truckInches);
        return;
      }
      truckSignature = sig;

      if (truck) {
        clearTrailerShapeGuides();
        scene.remove(truck);
        truck.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        truck = null;
      }

      truck = new THREE.Group();
      truck.name = 'truck';

      const geo = new THREE.BoxGeometry(lengthW, heightW, widthW);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(Utils.cssHexToInt(Utils.getCssVar('--accent-primary'))),
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(lengthW / 2, heightW / 2, 0);
      mesh.receiveShadow = false;
      truck.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(Utils.cssHexToInt(Utils.getCssVar('--accent-primary'))),
      });
      const wire = new THREE.LineSegments(edges, lineMat);
      wire.position.copy(mesh.position);
      truck.add(wire);

      scene.add(truck);

      truckBoundsWorld = new THREE.Box3(
        new THREE.Vector3(0, 0, -widthW / 2),
        new THREE.Vector3(lengthW, heightW, widthW / 2)
      );

      // Move camera target near the center of the truck
      controls.target.set(lengthW / 2, Math.min(6, heightW / 2), 0);
      updateTrailerShapeGuides(truckInches);
    }

    function focusOnWorldPoint(targetWorld, options = {}) {
      if (!controls || !camera) return;
      const duration = Number(options.duration) || 700;
      const nextTarget = targetWorld.clone();
      const dir = camera.position.clone().sub(controls.target);
      const nextPos = nextTarget.clone().add(dir);
      new TWEEN.Tween(controls.target)
        .to({ x: nextTarget.x, y: nextTarget.y, z: nextTarget.z }, duration)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();
      new TWEEN.Tween(camera.position)
        .to({ x: nextPos.x, y: nextPos.y, z: nextPos.z }, duration)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();
    }

    function getTruckBoundsWorld() {
      return truckBoundsWorld;
    }

    function toggleGrid() {
      if (!grid) return false;
      grid.visible = !grid.visible;
      return grid.visible;
    }

    function toggleShadows() {
      if (!renderer) return false;
      renderer.shadowMap.enabled = !renderer.shadowMap.enabled;
      return renderer.shadowMap.enabled;
    }

    return {
      init: initScene,
      resize,
      refreshTheme,
      setTruck,
      updateTrailerShapeGuides,
      focusOnWorldPoint,
      toggleGrid,
      toggleShadows,
      toggleDevOverlay: () => DevOverlay.toggle(),
      getScene: () => scene,
      getCamera: () => camera,
      getRenderer: () => renderer,
      getControls: () => controls,
      getTruckBoundsWorld,
      toWorld,
      toInches,
      vecInchesToWorld,
      vecWorldToInches,
      getPerf: () => ({ ...perf }),
    };
  })();

  return SceneManager;
}
