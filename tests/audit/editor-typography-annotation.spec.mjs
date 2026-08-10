import test from 'node:test';
import assert from 'node:assert/strict';

const vendorThreePath = new URL('../../vendor/three.module.js', import.meta.url);
const foundationPath = new URL('../../src/editor/text-annotation-foundation.js', import.meta.url);
const editorScreenPath = new URL('../../src/screens/editor-screen.js', import.meta.url);

function installCanvasDocument() {
  const canvases = [];
  globalThis.document = {
    createElement() {
      const calls = [];
      const canvas = {
        width: 0,
        height: 0,
        calls,
        getContext: () => ({
          fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
          scale() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
          measureText: value => ({ width: String(value).length * 12 }),
          fillText: (...args) => calls.push(args),
        }),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  return canvases;
}

function makeInstance(id, caseId = 'case-a', x = 20) {
  return {
    id,
    caseId,
    transform: { position: { x, y: 8, z: 10 }, rotation: { x: 0, y: 0, z: 0 } },
    placement: 'packed',
  };
}

async function makeSceneFixture(overrides = {}) {
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  globalThis.THREE = THREE;
  installCanvasDocument();
  globalThis.window = { devicePixelRatio: overrides.dpr || 1 };
  const Editor = await import(`${editorScreenPath.href}?t=${Date.now()}-${Math.random()}`);
  const scene = new THREE.Scene();
  let prefs = { hiddenCaseOpacity: 0.3, showLabels: true, labelFontSize: 12 };
  const cases = new Map();
  const baseCase = {
    id: 'case-a', name: 'Professional Logistics Identification Case',
    dimensions: { length: 20, width: 18, height: 16 }, weight: 10,
    color: '#8844aa', category: 'default', canFlip: true, shape: 'box',
    ...overrides.caseData,
  };
  cases.set(baseCase.id, baseCase);
  const CaseScene = Editor.createCaseScene({
    SceneManager: {
      getScene: () => scene,
      toWorld: value => Number(value) || 0,
      toInches: value => Number(value) || 0,
      vecInchesToWorld: value => new THREE.Vector3(value.x, value.y, value.z),
    },
    CaseLibrary: { getById: id => cases.get(id) || null },
    CategoryService: { meta: () => ({ color: '#8844aa' }) },
    PackLibrary: { getById: () => null }, StateStore: { get: () => null }, TrailerGeometry: {},
    Utils: { clamp: (value, min, max) => Math.max(min, Math.min(max, value)), getCssVar: () => '#ff9f1c' },
    PreferencesManager: { get: () => prefs },
  });
  return { THREE, CaseScene, baseCase, cases, scene, setPrefs: next => { prefs = { ...prefs, ...next }; } };
}

test('TYPOGRAPHY raster cache uses bounded DPR identity, bounded wrapping, and exact ownership', async () => {
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  const canvases = installCanvasDocument();
  const Foundation = await import(`${foundationPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(Foundation.resolveTextDprBucket(1), 1);
  assert.equal(Foundation.resolveTextDprBucket(1.5), 1.5);
  assert.equal(Foundation.resolveTextDprBucket(2), 2);
  assert.equal(Foundation.resolveTextDprBucket(8), 2);
  assert.equal(Foundation.resolveLabelTextScale(12), 1);
  assert.equal(Foundation.resolveLabelTextScale(24), 1.5);

  const cache = Foundation.createTextTextureCache({ THREE, documentRef: globalThis.document });
  const options = {
    content: { name: 'A very long logistics case name that cannot fit on two complete lines', weight: '999999 lb', handling: '⇧⇧ Keep upright' },
    logicalWidth: 320, logicalHeight: 160, fontScale: 1, maxLines: 2, effectiveDpr: 2,
  };
  const first = cache.acquire(options);
  const second = cache.acquire(options);
  assert.strictEqual(first.texture, second.texture, 'identical pixel inputs share one texture');
  assert.equal(first.texture.image.width, 640);
  assert.equal(first.texture.image.height, 320);
  assert.ok(first.texture.userData.textLayout.nameLines.length <= 2);
  assert.ok(first.texture.userData.textLayout.nameLines.some(line => line.includes('…')));
  let disposed = 0;
  first.texture.addEventListener('dispose', () => { disposed += 1; });
  cache.release(first.key);
  assert.equal(disposed, 0);
  cache.release(second.key);
  assert.equal(disposed, 1);

  const capped = cache.acquire({ ...options, effectiveDpr: 99 });
  const maxBucket = cache.acquire({ ...options, effectiveDpr: 2 });
  assert.strictEqual(capped.texture, maxBucket.texture, 'DPR values in the capped bucket share identity');
  assert.ok(canvases.every(canvas => canvas.width <= 1024 && canvas.height <= 640));
  cache.release(capped.key);
  cache.release(maxBucket.key);
});

test('TYPOGRAPHY surface labels separate body resources, stay local/no-pick, and follow preferences', async () => {
  const fixture = await makeSceneFixture();
  const { CaseScene, baseCase, setPrefs } = fixture;
  const first = makeInstance('a');
  const second = makeInstance('b', 'case-a', 50);
  CaseScene.sync({ id: 'p', cases: [first, second] });
  const group = CaseScene.getObject('a');
  const peer = CaseScene.getObject('b');
  const bodyTexture = group.userData.mesh.material[0].map;
  const label = group.userData.labelRoot.children[0];
  assert.ok(label.isMesh && label.material.isMeshBasicMaterial, 'identity label is a WebGL plane');
  assert.equal(label.userData.pickable, false);
  assert.equal(label.userData.caseIdentityLabel, true);
  assert.ok(group.children.includes(group.userData.labelRoot), 'label is case-local');
  assert.strictEqual(label.material.map, peer.userData.labelRoot.children[0].material.map, 'identical labels share texture');
  assert.deepEqual(CaseScene.getRaycastMeshes(), [group.userData.mesh, peer.userData.mesh]);
  const aabb = structuredClone(CaseScene.getAabbWorld('a'));

  baseCase.name = 'Different Name';
  CaseScene.sync({ id: 'p', cases: [first, second] });
  assert.strictEqual(CaseScene.getObject('a').userData.mesh.material[0].map, bodyTexture,
    'name changes preserve the body texture resource');
  assert.notStrictEqual(CaseScene.getObject('a').userData.labelRoot.children[0].material.map, label.material.map,
    'name changes replace label identity');
  assert.deepEqual(CaseScene.getAabbWorld('a'), aabb);

  const bodyAfterName = CaseScene.getObject('a').userData.mesh.material[0].map;
  baseCase.weight = 500000;
  CaseScene.sync({ id: 'p', cases: [first, second] });
  assert.strictEqual(CaseScene.getObject('a').userData.mesh.material[0].map, bodyAfterName);
  const beforeFont = CaseScene.getObject('a').userData.labelRoot.children[0].material.map;
  setPrefs({ labelFontSize: 24 });
  CaseScene.sync({ id: 'p', cases: [first, second] });
  assert.notStrictEqual(CaseScene.getObject('a').userData.labelRoot.children[0].material.map, beforeFont);
  assert.deepEqual(CaseScene.getAabbWorld('a'), aabb);

  setPrefs({ showLabels: false });
  CaseScene.applyLabelPreferences();
  assert.equal(CaseScene.getObject('a').userData.labelRoot.visible, false);
  setPrefs({ showLabels: true });
  CaseScene.applyLabelPreferences();
  assert.equal(CaseScene.getObject('a').userData.labelRoot.visible, true);
  assert.deepEqual(CaseScene.getAabbWorld('a'), aabb);

  const localPosition = CaseScene.getObject('a').userData.labelRoot.children[0].position.clone();
  first.transform.rotation.y = Math.PI / 2;
  CaseScene.sync({ id: 'p', cases: [first, second] });
  assert.equal(CaseScene.getObject('a').rotation.y, Math.PI / 2);
  assert.deepEqual(CaseScene.getObject('a').userData.labelRoot.children[0].position.toArray(), localPosition.toArray());
  CaseScene.clear();
});

test('TYPOGRAPHY box, cylinder, pallet, visual states, and 25/100/300 scale remain resource-safe', async () => {
  for (const shapeCase of [
    { id: 'box', shape: 'box', canFlip: false },
    { id: 'drum', shape: 'cylinder', canFlip: true },
    { id: 'pallet', shape: 'box', isPallet: true, maxPalletWeight: 1200 },
  ]) {
    const fixture = await makeSceneFixture({ caseData: shapeCase });
    const inst = makeInstance('one', shapeCase.id);
    fixture.CaseScene.sync({ id: 'p', cases: [inst] });
    const group = fixture.CaseScene.getObject('one');
    const layout = group.userData.labelRoot.children[0].material.map.userData.textLayout;
    assert.equal(layout.content.handling !== '', shapeCase.canFlip === false && shapeCase.isPallet !== true);
    assert.equal(layout.content.warning !== '', shapeCase.isPallet === true);
    const labelTexture = group.userData.labelRoot.children[0].material.map;
    const labelGeometry = group.userData.labelRoot.children[0].geometry;
    fixture.CaseScene.setHover('one');
    fixture.CaseScene.setSelected(['one']);
    fixture.CaseScene.setDragging('one');
    fixture.CaseScene.setCollision('one', true);
    assert.strictEqual(group.userData.labelRoot.children[0].material.map, labelTexture);
    assert.strictEqual(group.userData.labelRoot.children[0].geometry, labelGeometry);
    fixture.CaseScene.clear();
  }

  for (const count of [25, 100, 300]) {
    const fixture = await makeSceneFixture();
    const instances = Array.from({ length: count }, (_, index) => makeInstance(`i-${index}`, 'case-a', index * 24));
    fixture.CaseScene.sync({ id: 'p', cases: instances });
    const first = fixture.CaseScene.getObject('i-0');
    const sharedTexture = first.userData.labelRoot.children[0].material.map;
    const sharedGeometry = first.userData.labelRoot.children[0].geometry;
    for (let index = 1; index < count; index += 1) {
      const group = fixture.CaseScene.getObject(`i-${index}`);
      assert.strictEqual(group.userData.labelRoot.children[0].material.map, sharedTexture);
      assert.strictEqual(group.userData.labelRoot.children[0].geometry, sharedGeometry);
    }
    let disposed = 0;
    sharedTexture.addEventListener('dispose', () => { disposed += 1; });
    fixture.CaseScene.clear();
    assert.equal(disposed, 1, `${count} cases release the final shared label texture exactly once`);
  }
});

test('TYPOGRAPHY Sprite annotation is WebGL, bounded, shared, no-pick, and explicitly released', async () => {
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  installCanvasDocument();
  const Foundation = await import(`${foundationPath.href}?t=${Date.now()}-${Math.random()}`);
  const cache = Foundation.createTextTextureCache({ THREE, documentRef: globalThis.document });
  const input = { THREE, textureCache: cache, content: { name: 'Future measurement', weight: '12 in' }, scale: 100 };
  const first = Foundation.createCameraFacingAnnotation(input);
  const second = Foundation.createCameraFacingAnnotation(input);
  assert.ok(first.isSprite);
  assert.equal(first.userData.pickable, false);
  assert.deepEqual(first.scale.toArray(), [8, 4, 1]);
  assert.strictEqual(first.material.map, second.material.map);
  let disposed = 0;
  first.material.map.addEventListener('dispose', () => { disposed += 1; });
  first.userData.release();
  first.userData.release();
  assert.equal(disposed, 0);
  second.userData.release();
  assert.equal(disposed, 1);
});
