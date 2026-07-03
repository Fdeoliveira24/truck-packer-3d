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

export function createSceneRuntime({
  Utils,
  UIComponents,
  PreferencesManager: _PreferencesManager,
  TrailerGeometry,
  StateStore,
}) {
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
    let dirLight = null;
    let cogMarker = null;
    let environmentSize = 0;
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
      camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 5000);
      camera.position.set(28, 18, 20);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        // Make the canvas alpha-enabled so we can render transparent overlay
        // viewports (axis widget) without a solid background color.
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      viewSize = { width, height };
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      containerEl.appendChild(renderer.domElement);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.minDistance = 6;
      controls.maxDistance = 220;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.target.set(14, 2, 0);

      addLighting();
      generateEnvironmentMap();
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
      // Soft ambient base (lower intensity so directional lights define the form)
      const ambient = new THREE.AmbientLight(0xf5f0eb, 0.45);
      scene.add(ambient);

      // Main key light (warm sunlight from upper-right-front)
      dirLight = new THREE.DirectionalLight(0xfff4e0, 1.05);
      dirLight.position.set(35, 55, 30);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.bias = -0.00015;
      dirLight.shadow.normalBias = 0.025;
      dirLight.shadow.camera.left = -80;
      dirLight.shadow.camera.right = 80;
      dirLight.shadow.camera.top = 80;
      dirLight.shadow.camera.bottom = -80;
      dirLight.shadow.radius = 3;
      scene.add(dirLight);
      scene.add(dirLight.target);

      // Fill light (cool blue-ish from opposite side, softer)
      const fill = new THREE.DirectionalLight(0xc8d8f0, 0.35);
      fill.position.set(-25, 20, -18);
      scene.add(fill);

      // Hemisphere sky/ground light for soft ambient bounce
      const hemi = new THREE.HemisphereLight(0x9ec5e8, 0x5c4a32, 0.3);
      scene.add(hemi);

      // Subtle back-rim light to separate objects from background
      const rim = new THREE.DirectionalLight(0xffffff, 0.18);
      rim.position.set(-15, 40, -30);
      scene.add(rim);
    }

    function generateEnvironmentMap() {
      // Create a simple procedural environment for subtle reflections on materials
      if (!renderer || !scene) return;
      try {
        const pmremGen = new THREE.PMREMGenerator(renderer);
        pmremGen.compileEquirectangularShader();
        // Use a simple lit scene as environment
        const envScene = new THREE.Scene();
        envScene.background = new THREE.Color(0xe8e4df);
        const envLight1 = new THREE.DirectionalLight(0xfff8f0, 0.8);
        envLight1.position.set(1, 2, 1);
        envScene.add(envLight1);
        const envLight2 = new THREE.HemisphereLight(0x87ceeb, 0x3d3d2d, 0.6);
        envScene.add(envLight2);
        const envRT = pmremGen.fromScene(envScene, 0.04);
        scene.environment = envRT.texture;
        pmremGen.dispose();
      } catch {
        // Environment map is optional; ignore errors on weak hardware
      }
    }

    // G2.2C: total visual length includes the front-overhang extension
    // (truck.length + bonusLength) for frontBonus shapes with bonusLength > 0.
    // Used to size the grid/floor/shadow bounds and camera target so the
    // overhang is fully visible.
    function getTotalTruckLengthInches(truckInches) {
      const baseLength = Number(truckInches && truckInches.length) || 0;
      if (!truckInches || truckInches.shapeMode !== 'frontBonus') return baseLength;
      const bonus = TrailerGeometry.getFrontBonusZone(truckInches);
      if (!bonus) return baseLength;
      return baseLength + (bonus.max.x - bonus.min.x);
    }

    function calcEnvironmentSize(lengthW, widthW) {
      const base = Math.max(lengthW * 2.2, widthW * 6);
      return Math.max(40, Math.ceil(base));
    }

    function rebuildEnvironment(size) {
      if (!scene) return;
      const prevGridVisible = grid ? grid.visible : true;
      if (ground) {
        scene.remove(ground);
        disposeObject3D(ground);
        ground = null;
      }
      if (grid) {
        scene.remove(grid);
        disposeObject3D(grid);
        grid = null;
      }
      const groundGeo = new THREE.PlaneGeometry(size * 1.3, size * 1.3);
      const groundMat = new THREE.ShadowMaterial({ opacity: 0.22 });
      ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      const divisions = Math.max(10, Math.round(size / 5));
      grid = new THREE.GridHelper(size, divisions);
      grid.name = 'grid';
      grid.visible = prevGridVisible;
      if (Array.isArray(grid.material)) {
        grid.material.forEach(m => { m.transparent = true; m.opacity = 0.15; });
      } else {
        grid.material.transparent = true;
        grid.material.opacity = 0.15;
      }
      scene.add(grid);
      environmentSize = size;
      refreshTheme();
    }

    function updateEnvironmentForTruck(truckInches) {
      if (!truckInches) return;
      const widthW = toWorld(truckInches.width || 0);
      const totalLengthW = toWorld(getTotalTruckLengthInches(truckInches));
      const nextSize = calcEnvironmentSize(totalLengthW, widthW);
      if (!environmentSize || Math.abs(nextSize - environmentSize) > 0.5) {
        rebuildEnvironment(nextSize);
      }
    }

    function updateShadowBounds(lengthW, widthW, heightW) {
      if (!dirLight) return;
      const halfL = Math.max(0.1, lengthW / 2);
      const halfW = Math.max(0.1, widthW / 2);
      const halfH = Math.max(0.1, heightW / 2);
      const radius = Math.sqrt(halfL * halfL + halfW * halfW + halfH * halfH);
      const margin = Math.max(6, radius * 0.35);
      const extent = radius + margin;
      const cam = dirLight.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = Math.max(1, extent * 0.1);
      cam.far = Math.max(60, extent * 6);
      cam.updateProjectionMatrix();
      dirLight.target.position.set(lengthW / 2, Math.max(1, heightW / 2), 0);
      dirLight.target.updateMatrixWorld();
    }

    function addEnvironment() {
      const defaultSize = calcEnvironmentSize(toWorld(636), toWorld(102));
      rebuildEnvironment(defaultSize);
    }

    function addAxisWidget() {
      axisScene = new THREE.Scene();
      axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

      // Build a richer axis gizmo: shaft lines + cone tips + text labels
      axisHelper = new THREE.Group();
      const shaftLen = 2.6;
      const coneH = 0.6;
      const coneR = 0.22;
      const labelOffset = shaftLen + coneH + 0.45;

      const axes = [
        { dir: new THREE.Vector3(1, 0, 0), color: 0xf73b5c, label: 'x' }, // red-pink
        { dir: new THREE.Vector3(0, 1, 0), color: 0x26c97a, label: 'y' }, // green
        { dir: new THREE.Vector3(0, 0, 1), color: 0x3b9ef7, label: 'z' }, // blue
      ];

      for (const ax of axes) {
        // Shaft line
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          ax.dir.clone().multiplyScalar(shaftLen),
        ]);
        const lineMat = new THREE.LineBasicMaterial({ color: ax.color, linewidth: 2 });
        axisHelper.add(new THREE.Line(lineGeo, lineMat));

        // Cone tip
        const coneGeo = new THREE.ConeGeometry(coneR, coneH, 12);
        const coneMat = new THREE.MeshBasicMaterial({ color: ax.color });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        // Position cone at end of shaft; rotate so it points along the axis
        const tipPos = ax.dir.clone().multiplyScalar(shaftLen + coneH / 2);
        cone.position.copy(tipPos);
        if (ax.label === 'x') cone.rotation.z = -Math.PI / 2;
        if (ax.label === 'z') cone.rotation.x = Math.PI / 2;
        // y-axis cone already points up by default
        axisHelper.add(cone);

        // Text label (canvas-based sprite)
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#' + ax.color.toString(16).padStart(6, '0');
        ctx.fillText(ax.label, 32, 32);
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.12, 0.12, 1);
        sprite.position.copy(ax.dir.clone().multiplyScalar(labelOffset));
        axisHelper.add(sprite);
      }

      // Small central cube
      const cubeGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const cubeMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.7 });
      axisHelper.add(new THREE.Mesh(cubeGeo, cubeMat));

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

      // Axis widget render (bottom-right). Use a slightly larger square
      // with a transparent clear so the axis gizmo never gets its corners
      // clipped by the canvas edge.
      const base = Math.max(80, Math.floor(Math.min(width, height) * 0.12));
      const margin = 36; // extra pixels around the widget to avoid cropping
      const size = base + margin;
      const pad = 10;
      renderer.setScissorTest(true);
      renderer.setViewport(width - size - pad, pad, size, size);
      renderer.setScissor(width - size - pad, pad, size, size);

      // Prevent auto-clearing color in the axis viewport (which created the
      // white box). Preserve main scene color; clear only depth manually.
      const prevAutoClear = renderer.autoClear;
      const prevAutoClearColor = renderer.autoClearColor;
      const prevAutoClearDepth = renderer.autoClearDepth;
      renderer.autoClear = false;
      renderer.autoClearColor = false;
      renderer.autoClearDepth = false;

      renderer.clearDepth();
      axisScene.background = null;
      if (axisCamera && camera && axisCamera.fov !== camera.fov) {
        axisCamera.fov = camera.fov;
        axisCamera.updateProjectionMatrix();
      }
      // Move the axis camera further back to ensure tips/labels stay inside
      axisCamera.position.copy(camera.position).sub(controls.target).setLength(12);
      axisCamera.lookAt(axisScene.position);
      renderer.render(axisScene, axisCamera);

      renderer.autoClear = prevAutoClear;
      renderer.autoClearColor = prevAutoClearColor;
      renderer.autoClearDepth = prevAutoClearDepth;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
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
      const bg = Utils.getCssVar('--bg-primary') || '#0f0f10';
      scene.background = new THREE.Color(bg);
      if (grid && grid.material) {
        const gridMat = grid.material;
        const mainColor = new THREE.Color(Utils.getCssVar('--accent-primary') || '#ff9f1c');
        const subColor = new THREE.Color(Utils.getCssVar('--border-strong') || '#2b2b2b');
        if (Array.isArray(gridMat)) {
          if (gridMat[0]) gridMat[0].color.set(mainColor);
          if (gridMat[1]) gridMat[1].color.set(subColor);
        } else {
          gridMat.color.set(subColor);
        }
      }
    }

    function disposeMaterial(mat) {
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach(m => {
        if (!m) return;
        if (m.map && m.map.dispose) m.map.dispose();
        if (m.dispose) m.dispose();
      });
    }

    function disposeObject3D(root) {
      if (!root) return;
      root.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) disposeMaterial(obj.material);
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

    // The front overhang's raised deck is rendered as a real attached volume
    // in setTruck(). The "cab void" beneath that deck (x: truck.length..
    // truck.length+bonusLength, y: 0..bonusHeight, full width) is structural
    // and can never hold cargo, so it is rendered the same way as the
    // wheelWells blocked region: a translucent red guide box.
    function updateTrailerShapeGuides(truckInches) {
      if (!scene) return;
      const mode = truckInches && truckInches.shapeMode ? truckInches.shapeMode : 'rect';

      let guideZones = [];
      if (mode === 'wheelWells') {
        guideZones = TrailerGeometry.getWheelWellsBlockedZones(truckInches);
      } else if (mode === 'frontBonus') {
        guideZones = TrailerGeometry.getFrontBonusBlockedZones(truckInches);
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

      guideZones.forEach(z => {
        // G1.1B: raised from opacity 0.13/lineOpacity 0.48 - blocked/no-load
        // zones (wheel wells, cab void) still read as too faint to clearly
        // signal "no cargo here". Still translucent, but the fill and
        // outline are now strong enough to read as a blocked zone at a
        // glance.
        addGuideBox(group, z, { fillColor: 0xff3b30, lineColor: 0xff3b30, opacity: 0.16, lineOpacity: 0.55 });
      });

      if (!group.children.length) return;
      truck.add(group);
      trailerShapeGuides = group;
      if (scene.userData) scene.userData.shapeGuides = group;
    }

    // Drops edge segments that lie exactly on one of the given local-X
    // planes from an EdgesGeometry. Used by addTrailerVolume() to remove the
    // "ghost" outline edges left behind at a seam where an end cap was
    // intentionally omitted (openMinX/openMaxX). Geometry-only change to the
    // wireframe; the underlying box dimensions/positions are untouched.
    function trimSeamEdges(edgesGeo, seamLocalXs) {
      const pos = edgesGeo.getAttribute('position');
      const EPS = 1e-4;
      const kept = [];
      for (let i = 0; i < pos.count; i += 2) {
        const ax = pos.getX(i);
        const bx = pos.getX(i + 1);
        const onSeam = seamLocalXs.some(sx => Math.abs(ax - sx) < EPS && Math.abs(bx - sx) < EPS);
        if (onSeam) continue;
        kept.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      }
      edgesGeo.dispose();
      const trimmed = new THREE.BufferGeometry();
      trimmed.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
      return trimmed;
    }

    // G1.1C: thin solid BoxGeometry "rails" along the truck's exterior
    // edges. THREE.LineBasicMaterial.linewidth is set on the existing
    // wireframe but is not reliably honored by WebGL (most browsers clamp
    // it to 1px), so the outer silhouette can look thin/unconfident. A
    // small extruded box per edge stays visible regardless of linewidth
    // support, without changing any truck/case geometry.
    const RAIL_THICKNESS = 0.05;

    // Adds one rail as a BoxGeometry mesh spanning the axis-aligned segment
    // a->b, extended by half-thickness on each end so adjoining rails meet
    // cleanly at corners.
    function addRailEdge(group, a, b, material) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length <= 1e-6) return;

      let sx = RAIL_THICKNESS;
      let sy = RAIL_THICKNESS;
      let sz = RAIL_THICKNESS;
      if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz)) {
        sx = length + RAIL_THICKNESS;
      } else if (Math.abs(dy) >= Math.abs(dz)) {
        sy = length + RAIL_THICKNESS;
      } else {
        sz = length + RAIL_THICKNESS;
      }

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      group.add(mesh);
    }

    // Adds the 12 outer-edge rails of an axis-aligned box (x0..x1, y0..y1,
    // z0..z1). opts.openMinX/opts.openMaxX skip the 4 rails on that end-cap
    // face - matching addTrailerVolume's trimSeamEdges so the shared seam
    // between the main box and a front overhang is never railed and no
    // internal divider returns. opts.minXMat/opts.maxXMat/opts.sideMat pick
    // the rail material per face.
    function addBoxRails(group, x0, x1, y0, y1, z0, z1, opts = {}) {
      if (!opts.openMinX) {
        addRailEdge(group, new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y1, z0), opts.minXMat);
        addRailEdge(group, new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x0, y1, z1), opts.minXMat);
        addRailEdge(group, new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0, y0, z1), opts.minXMat);
        addRailEdge(group, new THREE.Vector3(x0, y1, z0), new THREE.Vector3(x0, y1, z1), opts.minXMat);
      }
      if (!opts.openMaxX) {
        addRailEdge(group, new THREE.Vector3(x1, y0, z0), new THREE.Vector3(x1, y1, z0), opts.maxXMat);
        addRailEdge(group, new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x1, y1, z1), opts.maxXMat);
        addRailEdge(group, new THREE.Vector3(x1, y0, z0), new THREE.Vector3(x1, y0, z1), opts.maxXMat);
        addRailEdge(group, new THREE.Vector3(x1, y1, z0), new THREE.Vector3(x1, y1, z1), opts.maxXMat);
      }
      addRailEdge(group, new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y0, z0), opts.sideMat);
      addRailEdge(group, new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x1, y0, z1), opts.sideMat);
      addRailEdge(group, new THREE.Vector3(x0, y1, z0), new THREE.Vector3(x1, y1, z0), opts.sideMat);
      addRailEdge(group, new THREE.Vector3(x0, y1, z1), new THREE.Vector3(x1, y1, z1), opts.sideMat);
    }

    // Adds a translucent trailer volume (walls + wireframe edges + floor)
    // centered at centerX, sharing materials with the main cargo box so the
    // front overhang reads as the same usable cargo space, just narrower.
    // openMinX/openMaxX omit the end-cap wall+wireframe at that face so two
    // adjacent volumes (main box <-> front overhang) read as one continuous
    // connected space instead of two boxes separated by an internal wall.
    // opts.baseY (default 0) raises the entire volume's floor/ceiling span
    // to baseY..baseY+heightW, so a raised over-cab overhang can render as a
    // platform flush with the main box's ceiling instead of a floor-level
    // box. opts.minXLineMat/opts.maxXLineMat optionally override the
    // wireframe color of the min-X/max-X end caps for direction cues.
    function addTrailerVolume(group, lengthW, heightW, widthW, centerX, mat, lineMat, floorMat, opts = {}) {
      const baseY = Number.isFinite(opts.baseY) ? opts.baseY : 0;
      const x0 = centerX - lengthW / 2;
      const x1 = centerX + lengthW / 2;
      const yMid = baseY + heightW / 2;
      const yTop = baseY + heightW;

      function addFace(geo, position, rotation, faceLineMat, seamLocalXs) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        if (rotation) mesh.rotation.copy(rotation);
        mesh.receiveShadow = false;
        group.add(mesh);

        const edges =
          seamLocalXs && seamLocalXs.length
            ? trimSeamEdges(new THREE.EdgesGeometry(geo), seamLocalXs)
            : new THREE.EdgesGeometry(geo);
        const wire = new THREE.LineSegments(edges, faceLineMat || lineMat);
        wire.position.copy(mesh.position);
        if (rotation) wire.rotation.copy(rotation);
        group.add(wire);
      }

      if (!opts.openMinX) {
        addFace(
          new THREE.PlaneGeometry(widthW, heightW),
          new THREE.Vector3(x0, yMid, 0),
          new THREE.Euler(0, Math.PI / 2, 0),
          opts.minXLineMat
        );
      }
      if (!opts.openMaxX) {
        addFace(
          new THREE.PlaneGeometry(widthW, heightW),
          new THREE.Vector3(x1, yMid, 0),
          new THREE.Euler(0, Math.PI / 2, 0),
          opts.maxXLineMat
        );
      }

      // G1.1B: side walls and ceiling each carry their own edge along the
      // seam where an end cap was omitted (openMinX/openMaxX). Left as-is,
      // that edge still draws a "ghost" outline of the removed cap, and for
      // the front overhang it duplicates part of the main box's edge at the
      // same X - the extra internal divider/seam lines seen in Box + Front
      // Overhang. Trim those edges so the two volumes read as one
      // continuous space with no inner seam line.
      const seamLocalXs = [];
      if (opts.openMinX) seamLocalXs.push(-lengthW / 2);
      if (opts.openMaxX) seamLocalXs.push(lengthW / 2);

      addFace(
        new THREE.PlaneGeometry(lengthW, heightW),
        new THREE.Vector3(centerX, yMid, -widthW / 2),
        null,
        null,
        seamLocalXs
      );
      addFace(
        new THREE.PlaneGeometry(lengthW, heightW),
        new THREE.Vector3(centerX, yMid, widthW / 2),
        null,
        null,
        seamLocalXs
      );
      addFace(
        new THREE.PlaneGeometry(lengthW, widthW),
        new THREE.Vector3(centerX, yTop, 0),
        new THREE.Euler(-Math.PI / 2, 0, 0),
        null,
        seamLocalXs
      );

      const floorGeo = new THREE.PlaneGeometry(lengthW, widthW);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(centerX, baseY + 0.001, 0);
      floor.receiveShadow = true;
      group.add(floor);
    }

    function setTruck(truckInches) {
      if (!scene) return;
      const mode = truckInches && truckInches.shapeMode ? truckInches.shapeMode : 'rect';
      const bonus = mode === 'frontBonus' ? TrailerGeometry.getFrontBonusZone(truckInches) : null;
      const bonusKey = bonus
        ? `${bonus.max.x - bonus.min.x}x${bonus.max.y - bonus.min.y}x${bonus.max.z - bonus.min.z}`
        : '0';
      const sig = `${truckInches.length}x${truckInches.width}x${truckInches.height}:${mode}:${bonusKey}`;
      const lengthW = toWorld(truckInches.length);
      const widthW = toWorld(truckInches.width);
      const heightW = toWorld(truckInches.height);
      const totalLengthW = toWorld(getTotalTruckLengthInches(truckInches));

      if (truck && truckSignature === sig) {
        truckBoundsWorld = new THREE.Box3(
          new THREE.Vector3(0, 0, -widthW / 2),
          new THREE.Vector3(totalLengthW, heightW, widthW / 2)
        );
        controls.target.set(totalLengthW / 2, Math.min(6, heightW / 2), 0);
        updateShadowBounds(totalLengthW, widthW, heightW);
        updateEnvironmentForTruck(truckInches);
        updateTrailerShapeGuides(truckInches);
        return;
      }
      truckSignature = sig;

      if (truck) {
        clearTrailerShapeGuides();
        scene.remove(truck);
        disposeObject3D(truck);
        truck = null;
      }

      truck = new THREE.Group();
      truck.name = 'truck';

      const accent = Utils.getCssVar('--accent-primary') || '#ff9f1c';

      // Semi-transparent container walls with slight blue tint
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xd0dce6),
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        roughness: 0.6,
        metalness: 0.15,
        depthWrite: false,
      });

      // Thicker, more visible container wireframe edges
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.92,
        linewidth: 2,
      });

      // Plywood-colored floor with subtle ridged appearance
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xa89070,
        roughness: 0.92,
        metalness: 0.0,
        side: THREE.FrontSide,
      });

      // G2.2E: low-risk, non-sprite direction cues - the rear/loading-door
      // end cap (x=0) is always green, and the front-most/cab-side end cap
      // (the main box's +X cap, or the overhang's +X cap when present) is
      // always red, so front/rear stay visually distinguishable from any
      // angle without adding text sprites.
      // G1.1B: opacity raised from 0.78 - at 0.78 the end-cap cues still
      // read as barely-visible in browser review. 0.9 keeps them short
      // line segments (not full sprites/labels) while making the
      // rear/front color coding actually useful at a glance.
      const doorLineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(0x26c97a),
        transparent: true,
        opacity: 0.9,
        linewidth: 2,
      });
      const cabLineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(0xf7385c),
        transparent: true,
        opacity: 0.9,
        linewidth: 2,
      });

      // G1.1C: mesh-based exterior rails - same color coding as the
      // door/cab end-cap cues above, but as solid BoxGeometry so the
      // outer silhouette reads clearly regardless of WebGL linewidth.
      const railAccentMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.9,
      });
      const railDoorMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x26c97a),
        transparent: true,
        opacity: 0.9,
      });
      const railCabMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xf7385c),
        transparent: true,
        opacity: 0.9,
      });

      // Main cargo box: x=0..truck.length, full width/height, floor at y=0.
      // x=0 is the rear/loading-door end (green cue). When a front overhang
      // is attached, omit the +X end cap so the two volumes read as one
      // connected cargo space; otherwise the +X end cap is the front/cab
      // side (red cue).
      addTrailerVolume(truck, lengthW, heightW, widthW, lengthW / 2, mat, lineMat, floorMat, {
        openMaxX: Boolean(bonus),
        minXLineMat: doorLineMat,
        maxXLineMat: bonus ? undefined : cabLineMat,
      });

      // G2.2: front overhang is a raised over-cab deck, not a floor-level
      // extension. x: truck.length..truck.length+bonusLength, full trailer
      // width, y: bonusHeight..truck.height - flush with the main box's
      // ceiling, starting at the deck height / cab clearance (bonusHeight)
      // measured from the main floor. The space below it (y: 0..bonusHeight)
      // is the blocked "cab void" - see updateTrailerShapeGuides(). Its far
      // end cap is the front/cab side (red cue).
      if (bonus) {
        const bonusLengthW = toWorld(bonus.max.x - bonus.min.x);
        const bonusHeightW = toWorld(bonus.max.y - bonus.min.y);
        const bonusWidthW = toWorld(bonus.max.z - bonus.min.z);
        const bonusCenterX = toWorld(bonus.min.x) + bonusLengthW / 2;
        const bonusBaseY = toWorld(bonus.min.y);
        addTrailerVolume(truck, bonusLengthW, bonusHeightW, bonusWidthW, bonusCenterX, mat, lineMat, floorMat, {
          openMinX: true,
          baseY: bonusBaseY,
          maxXLineMat: cabLineMat,
        });
      }

      // G1.1C: mesh-based exterior rails for the truck/trailer outer
      // silhouette. Main box rails mirror addTrailerVolume's openMaxX/
      // openMinX seam handling above, so the shared seam at x=lengthW is
      // never railed and no internal divider returns when an overhang is
      // present.
      const railsGroup = new THREE.Group();
      railsGroup.name = 'truckOuterRails';
      addBoxRails(railsGroup, 0, lengthW, 0, heightW, -widthW / 2, widthW / 2, {
        openMaxX: Boolean(bonus),
        minXMat: railDoorMat,
        maxXMat: bonus ? undefined : railCabMat,
        sideMat: railAccentMat,
      });
      if (bonus) {
        addBoxRails(
          railsGroup,
          toWorld(bonus.min.x),
          toWorld(bonus.max.x),
          toWorld(bonus.min.y),
          toWorld(bonus.max.y),
          toWorld(bonus.min.z),
          toWorld(bonus.max.z),
          {
            openMinX: true,
            maxXMat: railCabMat,
            sideMat: railAccentMat,
          }
        );
      }
      truck.add(railsGroup);

      scene.add(truck);

      truckBoundsWorld = new THREE.Box3(
        new THREE.Vector3(0, 0, -widthW / 2),
        new THREE.Vector3(totalLengthW, heightW, widthW / 2)
      );

      // Move camera target near the center of the full visual extent
      // (including the front overhang, if any)
      controls.target.set(totalLengthW / 2, Math.min(6, heightW / 2), 0);
      updateShadowBounds(totalLengthW, widthW, heightW);
      updateEnvironmentForTruck(truckInches);
      updateTrailerShapeGuides(truckInches);
    }

    function focusOnWorldPoint(targetWorld, options = {}) {
      if (!controls || !camera) return;
      const duration = Number(options.duration) || 700;
      const nextTarget = targetWorld.clone();
      const dir = camera.position.clone().sub(controls.target);
      const nextPos = nextTarget.clone().add(dir);
      const Tween = window.TWEEN || null;
      if (!Tween) {
        controls.target.copy(nextTarget);
        camera.position.copy(nextPos);
        return;
      }
      new Tween.Tween(controls.target)
        .to({ x: nextTarget.x, y: nextTarget.y, z: nextTarget.z }, duration)
        .easing(Tween.Easing.Cubic.InOut)
        .start();
      new Tween.Tween(camera.position)
        .to({ x: nextPos.x, y: nextPos.y, z: nextPos.z }, duration)
        .easing(Tween.Easing.Cubic.InOut)
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
      const enabled = !renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = enabled;
      if (enabled) {
        perf.perfMode = false;
        perf.lowMs = 0;
      }
      return enabled;
    }

    function restoreShadows() {
      if (!renderer) return false;
      perf.perfMode = false;
      perf.lowMs = 0;
      renderer.shadowMap.enabled = true;
      return true;
    }

    function requestShadowRefresh() {
      if (renderer && renderer.shadowMap) {
        renderer.shadowMap.needsUpdate = true;
      }
    }

    function updateCoG(cogData) {
      if (!scene) return;
      if (!cogData) {
        if (cogMarker) {
          scene.remove(cogMarker);
          cogMarker.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          cogMarker = null;
        }
        return;
      }
      const pos = cogData.position;
      const worldX = toWorld(pos.x);
      const worldY = toWorld(pos.y);
      const worldZ = toWorld(pos.z);
      const color = cogData.status === 'ok' ? 0x00ff00 :
        cogData.status === 'warning' ? 0xffaa00 : 0xff0000;
      if (!cogMarker) {
        cogMarker = new THREE.Group();
        cogMarker.name = 'cog-marker';
        const sphereGeo = new THREE.SphereGeometry(0.3, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -50, 0),
          new THREE.Vector3(0, 50, 0),
        ]);
        const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
        const line = new THREE.LineSegments(lineGeo, lineMat);
        cogMarker.add(sphere);
        cogMarker.add(line);
        scene.add(cogMarker);
      }
      cogMarker.position.set(worldX, worldY, worldZ);
      cogMarker.children.forEach(child => {
        if (child.material) child.material.color.setHex(color);
      });
    }

    return {
      init: initScene,
      resize,
      refreshTheme,
      setTruck,
      updateTrailerShapeGuides,
      updateCoG,
      focusOnWorldPoint,
      toggleGrid,
      toggleShadows,
      restoreShadows,
      requestShadowRefresh,
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
