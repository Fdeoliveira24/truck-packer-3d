// scene rendering invariants: contract tests from the former security suite.

import {
  appPath,
  assert,
  autoPackEnginePath,
  autoPackSolverPath,
  editorScreenPath,
  fs,
  packLibraryPath,
  sceneRuntimePath,
  test,
} from '../fixtures/security-invariants-support.mjs';

test('G1.1B-SCENE-CUE-CLEANUP scene cue cleanup lives in scene-runtime.js and is not duplicated into AutoPack', async () => {
  const [sceneSrc, autopackEngineSrc, autopackSolverSrc] = await Promise.all([
    fs.readFile(sceneRuntimePath, 'utf8'),
    fs.readFile(autoPackEnginePath, 'utf8'),
    fs.readFile(autoPackSolverPath, 'utf8'),
  ]);

  // Source-of-truth markers for the G1.1B scene-cue cleanup: the seam-trim
  // helper and the tuned door/cab end-cap cue materials must live in
  // scene-runtime.js (the owner module for scene visuals).
  assert.match(sceneSrc, /function trimSeamEdges\(edgesGeo, seamLocalXs\)/,
    'scene-runtime.js must own the G1.1B seam-trim helper (trimSeamEdges)');
  assert.match(sceneSrc, /const doorLineMat = new THREE\.LineBasicMaterial\(/,
    'scene-runtime.js must own the G1.1B rear/loading-door end-cap cue material (doorLineMat)');
  assert.match(sceneSrc, /const cabLineMat = new THREE\.LineBasicMaterial\(/,
    'scene-runtime.js must own the G1.1B front/cab end-cap cue material (cabLineMat)');

  assert.doesNotMatch(autopackEngineSrc, /trimSeamEdges|doorLineMat|cabLineMat/,
    'G1.1B scene-cue cleanup must not be duplicated into src/services/autopack-engine.js');
  assert.doesNotMatch(autopackSolverSrc, /trimSeamEdges|doorLineMat|cabLineMat/,
    'G1.1B scene-cue cleanup must not be duplicated into src/services/autopack-solver.js');
});

test('G1.1B-SCENE-CUE-CLEANUP scene-runtime defines no ArrowHelper or other large default direction-arrow indicators', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.doesNotMatch(src, /ArrowHelper/,
    'scene-runtime must not add THREE.ArrowHelper-based direction indicators to the default scene');
  assert.doesNotMatch(src, /Arrow/,
    'scene-runtime must not define arrow-shaped direction indicators');
});

test('G1.1B-SCENE-CUE-CLEANUP direction-cue and shape-guide code paths use no THREE.Sprite or CSS2D labels', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Direction-cue block (door/cab end-cap line materials).
  const cuesStart = src.indexOf('const doorLineMat = new THREE.LineBasicMaterial(');
  const cuesEnd = src.indexOf('maxXLineMat: cabLineMat', cuesStart);
  const cuesBlock = cuesStart >= 0 && cuesEnd > cuesStart ? src.slice(cuesStart, cuesEnd) : '';
  assert.ok(cuesBlock, 'direction-cue setup block must be present in setTruck');
  assert.doesNotMatch(cuesBlock, /THREE\.Sprite|CSS2DObject/,
    'rear/front end-cap direction cues must not use THREE.Sprite or CSS2DObject');

  // Cab-void / wheel-well guide-box block.
  const guidesStart = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const guidesEnd = src.indexOf('\n    function addTrailerVolume', guidesStart);
  const guidesBlock = guidesStart >= 0 && guidesEnd > guidesStart ? src.slice(guidesStart, guidesEnd) : '';
  assert.ok(guidesBlock, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.doesNotMatch(guidesBlock, /THREE\.Sprite|CSS2DObject/,
    'cab-void/wheel-well blocked-zone guides must not use THREE.Sprite or CSS2DObject');

  assert.doesNotMatch(src, /CSS2DRenderer|CSS2DObject/,
    'scene-runtime must not introduce CSS2D label rendering');
});

test('G1.1B-SCENE-CUE-CLEANUP end-cap direction cues remain subtle (reduced opacity) but still distinct and correctly mapped', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const src = await fs.readFile(sceneRuntimePath, 'utf8');
  const truck = { length: 240, width: 96, height: 72 };
  const model = PackLibrary.getTruckDirectionModel(truck);

  assert.equal(model.rear.value, 0, 'G1 direction model: rear/loading-door is x=0');
  assert.equal(model.front.value, truck.length, 'G1 direction model: front/cab is x=truck.length');

  // doorLineMat (green) maps to the rear/loading-door end (x=0, minX cap).
  assert.match(src, /const doorLineMat = new THREE\.LineBasicMaterial\(\{\s*color: new THREE\.Color\(0x26c97a\),\s*transparent: true,\s*opacity: 0\.9,/,
    'rear/loading-door end-cap cue must remain green and be tuned to opacity 0.9 (clearly visible, was 0.78)');
  assert.match(src, /minXLineMat: doorLineMat/,
    'main cargo box minX cap (x=0, rear/loading-door per G1 direction model) must use doorLineMat');

  // cabLineMat (red) maps to the front/cab end (the main box's maxX cap, or
  // the overhang's maxX cap when a frontBonus overhang is present).
  assert.match(src, /const cabLineMat = new THREE\.LineBasicMaterial\(\{\s*color: new THREE\.Color\(0xf7385c\),\s*transparent: true,\s*opacity: 0\.9,/,
    'front/cab end-cap cue must remain red and be tuned to opacity 0.9 (clearly visible, was 0.78)');
  assert.match(src, /maxXLineMat: bonus \? undefined : cabLineMat/,
    'main cargo box maxX cap (x=truck.length, front/cab per G1 direction model) must use cabLineMat when no overhang is present');
  assert.match(src, /maxXLineMat: cabLineMat/,
    'overhang volume maxX cap (front/cab side) must use cabLineMat when a frontBonus overhang is present');
});

test('G1.1B-SCENE-CUE-CLEANUP cab-void/wheel-well guide box intensity is reduced but still rendered (not removed)', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /addGuideBox\(group, z, \{ fillColor: 0xff3b30, lineColor: 0xff3b30, opacity: 0\.16, lineOpacity: 0\.55 \}\)/,
    'blocked/no-load guide box (cab void + wheel wells) must remain present with tuned opacity/lineOpacity (readable but translucent, was 0.13/0.48)');

  // Still wired up for both shape modes that rely on it.
  assert.match(src, /TrailerGeometry\.getWheelWellsBlockedZones\(truckInches\)/,
    'wheel-well blocked zones must still be rendered via the guide-box helper');
  assert.match(src, /TrailerGeometry\.getFrontBonusBlockedZones\(truckInches\)/,
    'frontBonus cab-void zone must still be rendered via the guide-box helper');
});

test('G1.1B-SCENE-CUE-CLEANUP front-overhang seam edges are trimmed without touching end-cap or geometry contracts', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // A dedicated, geometry-only helper trims the "ghost" outline edges left
  // at an omitted end cap (openMinX/openMaxX) - this is what removes the
  // extra internal divider/seam lines in Box + Front Overhang.
  assert.match(src, /function trimSeamEdges\(edgesGeo, seamLocalXs\)/,
    'a trimSeamEdges helper must exist to remove ghost seam-line edges at omitted end caps');

  const addTrailerVolumeStart = src.indexOf('function addTrailerVolume(');
  const addTrailerVolumeEnd = src.indexOf('\n    function setTruck(', addTrailerVolumeStart);
  const volumeBlock = addTrailerVolumeStart >= 0 && addTrailerVolumeEnd > addTrailerVolumeStart
    ? src.slice(addTrailerVolumeStart, addTrailerVolumeEnd)
    : '';
  assert.ok(volumeBlock, 'addTrailerVolume must be defined in scene-runtime.js');

  // Side walls and ceiling pass seamLocalXs derived from openMinX/openMaxX so
  // their edges are trimmed at a seam where an end cap was omitted.
  assert.match(volumeBlock, /const seamLocalXs = \[\];/,
    'addTrailerVolume must compute which local-X seam(s), if any, to trim');
  assert.match(volumeBlock, /if \(opts\.openMinX\) seamLocalXs\.push\(-lengthW \/ 2\);/,
    'an omitted minX end cap must trim the matching -lengthW/2 seam edge');
  assert.match(volumeBlock, /if \(opts\.openMaxX\) seamLocalXs\.push\(lengthW \/ 2\);/,
    'an omitted maxX end cap must trim the matching lengthW/2 seam edge');

  // End-cap faces (minX/maxX, which carry the door/cab direction cues when
  // present) must keep their full, untrimmed EdgesGeometry - only the
  // side-wall/ceiling seam edges are trimmed.
  const minXFaceEnd = volumeBlock.indexOf('opts.minXLineMat');
  const minXFaceBlock = volumeBlock.slice(0, minXFaceEnd);
  assert.match(minXFaceBlock, /new THREE\.EdgesGeometry\(geo\)/,
    'minX end-cap face must still call addFace without seam trimming');

  const maxXFaceStart = volumeBlock.indexOf('opts.openMaxX');
  const maxXFaceBlock = volumeBlock.slice(maxXFaceStart, volumeBlock.indexOf('seamLocalXs', maxXFaceStart));
  assert.doesNotMatch(maxXFaceBlock, /seamLocalXs/,
    'maxX end-cap face must not be passed seamLocalXs (direction cue outline stays intact)');
});

test('G1.1B-SCENE-CUE-CLEANUP cab-over/frontBonus geometry contracts remain untouched', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = {
    length: 240,
    width: 96,
    height: 72,
    shapeMode: 'frontBonus',
    shapeConfig: { bonusLength: 60, bonusWidth: 54, bonusHeight: 24 },
  };

  const zones = PackLibrary.getTrailerUsableZones(truck);
  const overhangZone = zones.find(z => z.min.x === truck.length);
  assert.ok(overhangZone, 'frontBonus overhang usable zone must still start at x=truck.length');
  assert.equal(overhangZone.max.x, truck.length + truck.shapeConfig.bonusLength,
    'frontBonus overhang usable zone must still extend by bonusLength (geometry untouched by visual cue cleanup)');

  const blocked = PackLibrary.getFrontBonusBlockedZones(truck);
  assert.deepEqual(blocked[0], {
    min: { x: truck.length, y: 0, z: -truck.width / 2 },
    max: { x: truck.length + truck.shapeConfig.bonusLength, y: truck.shapeConfig.bonusHeight, z: truck.width / 2 },
  }, 'cab-void blocked zone must remain x:truck.length..truck.length+bonusLength, y:0..bonusHeight, full width');
});

test('G1.1C-EXTERIOR-RAILS exterior-rail helpers live in scene-runtime.js and are not duplicated elsewhere', async () => {
  const [sceneSrc, autopackEngineSrc, autopackSolverSrc, appSrc, packLibSrc, editorSrc] = await Promise.all([
    fs.readFile(sceneRuntimePath, 'utf8'),
    fs.readFile(autoPackEnginePath, 'utf8'),
    fs.readFile(autoPackSolverPath, 'utf8'),
    fs.readFile(appPath, 'utf8'),
    fs.readFile(packLibraryPath, 'utf8'),
    fs.readFile(editorScreenPath, 'utf8'),
  ]);

  // Source-of-truth markers for the G1.1C exterior rails: the rail-mesh
  // helpers and the truckOuterRails group must live in scene-runtime.js
  // (the owner module for scene visuals).
  assert.match(sceneSrc, /function addRailEdge\(group, a, b, material\)/,
    'scene-runtime.js must own the G1.1C addRailEdge helper');
  assert.match(sceneSrc, /function addBoxRails\(group, x0, x1, y0, y1, z0, z1, opts = \{\}\)/,
    'scene-runtime.js must own the G1.1C addBoxRails helper');
  assert.match(sceneSrc, /railsGroup\.name = 'truckOuterRails';/,
    'scene-runtime.js must own the G1.1C truckOuterRails group');

  const otherSources = {
    'src/services/autopack-engine.js': autopackEngineSrc,
    'src/services/autopack-solver.js': autopackSolverSrc,
    'src/app.js': appSrc,
    'src/services/pack-library.js': packLibSrc,
    'src/screens/editor-screen.js': editorSrc,
  };
  for (const [file, src] of Object.entries(otherSources)) {
    assert.doesNotMatch(src, /addRailEdge|addBoxRails|truckOuterRails/,
      `G1.1C exterior-rail helpers must not be duplicated into ${file}`);
  }
});

test('G1.1C-EXTERIOR-RAILS truck outer rails are built from mesh geometry, not line-only wireframe', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  assert.match(src, /function addRailEdge\(group, a, b, material\)/,
    'a rail-edge helper must exist for the mesh-based exterior rails');
  assert.match(src, /new THREE\.Mesh\(new THREE\.BoxGeometry\(sx, sy, sz\), material\)/,
    'each exterior rail must be a THREE.BoxGeometry mesh, not a LineSegments/EdgesGeometry overlay');

  assert.match(src, /function addBoxRails\(group, x0, x1, y0, y1, z0, z1, opts = \{\}\)/,
    'an addBoxRails helper must build the 12 outer-edge rails of an axis-aligned box');

  // truckOuterRails group exists and is added under the truck group.
  assert.match(src, /const railsGroup = new THREE\.Group\(\);\s*railsGroup\.name = 'truckOuterRails';/,
    'a truckOuterRails group must be created');
  assert.match(src, /truck\.add\(railsGroup\);/,
    'truckOuterRails group must be added under the truck group so existing disposal cleans it up');
});

test('G1.1C-EXTERIOR-RAILS introduces no sprites, CSS2D labels, or arrow indicators', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Scope to the new rail helpers + truckOuterRails construction block, not
  // the whole module (the axis gizmo elsewhere in scene-runtime.js already
  // legitimately uses THREE.Sprite and predates G1.1C).
  const railHelpersStart = src.indexOf('function addRailEdge(group, a, b, material)');
  const railHelpersEnd = src.indexOf('\n    function addTrailerVolume', railHelpersStart);
  const railHelpersBlock = railHelpersStart >= 0 && railHelpersEnd > railHelpersStart
    ? src.slice(railHelpersStart, railHelpersEnd)
    : '';
  assert.ok(railHelpersBlock, 'addRailEdge/addBoxRails helpers must be defined in scene-runtime.js');

  const railsGroupStart = src.indexOf("railsGroup.name = 'truckOuterRails'");
  const railsGroupEnd = src.indexOf('truck.add(railsGroup);', railsGroupStart);
  const railsGroupBlock = railsGroupStart >= 0 && railsGroupEnd > railsGroupStart
    ? src.slice(railsGroupStart, railsGroupEnd)
    : '';
  assert.ok(railsGroupBlock, 'truckOuterRails construction block must exist in setTruck');

  const railBlocks = `${railHelpersBlock}\n${railsGroupBlock}`;
  assert.doesNotMatch(railBlocks, /THREE\.Sprite|CSS2DObject|CSS2DRenderer/,
    'exterior rails must not use THREE.Sprite or CSS2D labels');
  assert.doesNotMatch(railBlocks, /ArrowHelper/,
    'exterior rails must not add THREE.ArrowHelper-based direction indicators');
  assert.doesNotMatch(railBlocks, /Arrow/,
    'exterior rails must not define arrow-shaped indicators');
});

test('G1.1C-EXTERIOR-RAILS standard/rect mode rails the main box with door (green) and cab (red) end-cap rails', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Rail materials reuse the same door/cab colors as the G2.2E/G1.1B
  // end-cap line cues, as solid mesh materials.
  assert.match(src, /const railDoorMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(0x26c97a\),/,
    'rear/loading-door rail material must be green (0x26c97a)');
  assert.match(src, /const railCabMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(0xf7385c\),/,
    'front/cab rail material must be red (0xf7385c)');
  assert.match(src, /const railAccentMat = new THREE\.MeshBasicMaterial\(\{\s*color: new THREE\.Color\(accent\),/,
    'long side/top/floor rails must use the neutral accent color');

  // Main box rail call wires minX -> door (green), maxX -> cab (red) when no
  // overhang is present, matching the G1 direction model (rear=x:0,
  // front=x:truck.length).
  assert.match(src, /addBoxRails\(railsGroup, 0, lengthW, 0, heightW, -widthW \/ 2, widthW \/ 2, \{\s*openMaxX: Boolean\(bonus\),\s*minXMat: railDoorMat,\s*maxXMat: bonus \? undefined : railCabMat,\s*sideMat: railAccentMat,\s*\}\)/,
    'main box outer rails must use railDoorMat at x=0 (rear) and railCabMat at x=truck.length (front) when no overhang is present');
});

test('G1.1C-EXTERIOR-RAILS frontBonus rails the stepped silhouette without railing the open internal seam', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // Main box: maxX rails are skipped (openMaxX) when an overhang is
  // present, so the shared seam at x=lengthW is never railed - mirrors
  // addTrailerVolume's openMaxX/trimSeamEdges handling from G1.1B.
  const mainRailsMatch = src.match(/addBoxRails\(railsGroup, 0, lengthW, 0, heightW, -widthW \/ 2, widthW \/ 2, \{([\s\S]*?)\}\);/);
  assert.ok(mainRailsMatch, 'main box rail call must exist');
  assert.match(mainRailsMatch[1], /openMaxX: Boolean\(bonus\)/,
    'main box rails must skip the +X end-cap rails when a frontBonus overhang is present (open seam)');

  // Overhang volume: minX rails are skipped (openMinX), so the overhang
  // side of the same seam is also never railed.
  const bonusBlockStart = src.indexOf('if (bonus) {', src.indexOf('railsGroup.name'));
  const bonusBlockEnd = src.indexOf('truck.add(railsGroup);', bonusBlockStart);
  const bonusRailsBlock = bonusBlockStart >= 0 && bonusBlockEnd > bonusBlockStart
    ? src.slice(bonusBlockStart, bonusBlockEnd)
    : '';
  assert.ok(bonusRailsBlock, 'frontBonus rail block must exist');
  assert.match(bonusRailsBlock, /openMinX: true/,
    'overhang rails must skip the -X end-cap rails (open seam shared with the main box)');
  assert.match(bonusRailsBlock, /maxXMat: railCabMat/,
    'overhang far end cap (front-most, x=truck.length+bonusLength) must use railCabMat (red)');
});

test('G1.1C-EXTERIOR-RAILS wheel-well blocked guide zones are not railed as truck frame edges', async () => {
  const src = await fs.readFile(sceneRuntimePath, 'utf8');

  // The wheel-well blocked-zone guide boxes (addGuideBox + getWheelWellsBlockedZones)
  // must remain a separate translucent guide path, not part of addBoxRails.
  const guidesStart = src.indexOf('function updateTrailerShapeGuides(truckInches)');
  const guidesEnd = src.indexOf('\n    function trimSeamEdges', guidesStart);
  const guidesBlock = guidesStart >= 0 && guidesEnd > guidesStart ? src.slice(guidesStart, guidesEnd) : '';
  assert.ok(guidesBlock, 'updateTrailerShapeGuides must be defined in scene-runtime.js');
  assert.doesNotMatch(guidesBlock, /addBoxRails|addRailEdge|railsGroup/,
    'wheel-well/cab-void blocked-zone guides must not call the rail helpers');

  // The rail-building call sites (in setTruck) must not reference the
  // wheel-well/cab-void guide zone helpers.
  const railsGroupStart = src.indexOf("railsGroup.name = 'truckOuterRails'");
  const railsGroupEnd = src.indexOf('truck.add(railsGroup);', railsGroupStart);
  const railsBlock = railsGroupStart >= 0 && railsGroupEnd > railsGroupStart
    ? src.slice(railsGroupStart, railsGroupEnd)
    : '';
  assert.ok(railsBlock, 'truckOuterRails construction block must exist in setTruck');
  assert.doesNotMatch(railsBlock, /getWheelWellsBlockedZones|getFrontBonusBlockedZones|addGuideBox/,
    'truck outer rails must not be derived from wheel-well/cab-void blocked-zone guide geometry');
});
