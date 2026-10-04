// cargo constraint invariants: contract tests from the former security suite.

import {
  CARGO_HEADER,
  RIGHT_ANGLE,
  RIGHT_ANGLES,
  appPath,
  assert,
  assertHostileCanonical,
  autoPackEnginePath,
  autoPackItemBuilderPath,
  autoPackSolverPath,
  cargoCanonicalPath,
  caseLibraryPath,
  caseModalPath,
  casesScreenPath,
  editorScreenPath,
  findRowWarning,
  fs,
  handlingRulesP0cCase,
  handlingRulesP0cInstance,
  handlingRulesP0dMemoryStorage,
  hostileRawCase,
  importExportPath,
  installWindowXLSX,
  makeCsvFile,
  makePackImportInstance,
  makePackImportSafeCase,
  normalizerPath,
  orientedDimsPath,
  p5Modules,
  packLibraryPath,
  packingCoreValidationPath,
  r1cSolverItem,
  stateStorePath,
  storagePath,
  test,
  threeOracleHeightAxisVertical,
  threeOrientedTruth,
  vendorThreePath,
} from '../fixtures/security-invariants-support.mjs';

test('CARGO-RULE-V3 typed boolean parser: accepts true/false/yes/no/1/0, rejects unknown', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  const cases = [
    [true, true, true], [false, false, true], [1, true, true], [0, false, true],
    ['true', true, true], ['false', false, true], ['YES', true, true], ['No', false, true],
    ['1', true, true], ['0', false, true], ['on', true, true], ['off', false, true],
    ['', false, true], [null, false, true], [undefined, false, true],
    ['maybe', false, false], ['2', false, false], [2, false, false], ['garbage', false, false],
  ];
  for (const [raw, value, valid] of cases) {
    assert.deepEqual(C.parseCargoBoolean(raw, false), { value, valid }, `bool ${JSON.stringify(raw)}`);
  }
  // Never general JS truthiness: the string "false" must be FALSE, not true.
  assert.equal(C.parseCargoBoolean('false', false).value, false, '"false" string is false, not truthy');
  // stackable default true: blank/garbage fall back to true, explicit false wins.
  assert.equal(C.parseCargoBoolean('', true).value, true, 'stackable blank -> true');
  assert.equal(C.parseCargoBoolean('false', true).value, false, 'stackable explicit false -> false');
  assert.equal(C.parseCargoBoolean('garbage', true).value, true, 'stackable garbage -> default true (invalid)');
});

test('A1 operational booleans use canonical tokens in storage and Case normalization', async () => {
  const C = await import(cargoCanonicalPath.href);
  const { normalizeCase } = await import(normalizerPath.href);
  const { buildStorableCase } = await import(caseLibraryPath.href);
  const tokens = [
    [true, true], [false, false], ['true', true], ['false', false],
    ['1', true], ['0', false], ['yes', true], ['no', false],
    ['on', true], ['off', false], ['invalid', false],
  ];
  const base = { id: 'a1-bool', name: 'Boolean Case', dimensions: { length: 10, width: 10, height: 10 } };
  for (const field of ['mustLoadLast', 'mustUnloadFirst']) {
    for (const [raw, expected] of tokens) {
      const input = { ...base, [field]: raw };
      assert.equal(C.canonicalCargoForStorage(input)[field], expected, `${field} canonical ${String(raw)}`);
      assert.equal(normalizeCase(input, 123)[field], expected, `${field} normalized ${String(raw)}`);
      assert.equal(buildStorableCase(input)[field], expected, `${field} stored ${String(raw)}`);
    }
    assert.equal(normalizeCase(base, 123)[field], false, `${field} missing defaults false`);
  }
});

test('CARGO-RULE-V3 typed numeric parsers: reject malformed/NaN/Infinity, floor counts, clamp bounds', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  // Non-negative number.
  assert.deepEqual(C.parseCargoNonNegNumber('2000'), { value: 2000, valid: true });
  assert.deepEqual(C.parseCargoNonNegNumber(''), { value: 0, valid: true });
  assert.equal(C.parseCargoNonNegNumber('abc').valid, false, 'malformed string invalid');
  assert.equal(C.parseCargoNonNegNumber('abc').value, 0, 'malformed -> safe 0 for storage');
  assert.equal(C.parseCargoNonNegNumber(-5).valid, false, 'negative invalid');
  assert.equal(C.parseCargoNonNegNumber(Infinity).valid, false, 'Infinity invalid');
  assert.equal(C.parseCargoNonNegNumber(NaN).valid, false, 'NaN invalid');
  // Out-of-bounds clamps (so 1e300 can never produce infinite volume).
  const big = C.parseCargoNonNegNumber(1e300, { max: C.WEIGHT_MAX_LBS });
  assert.equal(big.valid, false, '1e300 is out of bounds');
  assert.equal(big.value, C.WEIGHT_MAX_LBS, 'out-of-bounds clamps to the max, never Infinity');
  // Count: floor decimals consistently; negatives/malformed invalid -> 0.
  assert.deepEqual(C.parseCargoCount('2.7'), { value: 2, valid: true }, 'decimal floored');
  assert.deepEqual(C.parseCargoCount(3), { value: 3, valid: true });
  assert.equal(C.parseCargoCount(-1).valid, false);
  assert.equal(C.parseCargoCount('x').valid, false);
  // Dimension sanity cap.
  assert.equal(C.parseCargoDimension(1e300).value, C.DIMENSION_MAX_INCHES, 'dimension clamps to sane max');
  assert.equal(C.parseCargoDimension(0).valid, false, 'zero dimension invalid');
});

test('CARGO-RULE-V3 lane parser keeps Automatic/Always/Never distinct; unknown is invalid', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.deepEqual(C.parseCargoLane(null), { value: null, valid: true }, 'Automatic -> null');
  assert.deepEqual(C.parseCargoLane('auto'), { value: null, valid: true });
  assert.deepEqual(C.parseCargoLane('always'), { value: true, valid: true }, 'Always -> true');
  assert.deepEqual(C.parseCargoLane(true), { value: true, valid: true });
  assert.deepEqual(C.parseCargoLane('never'), { value: false, valid: true }, 'Never -> false');
  assert.deepEqual(C.parseCargoLane(false), { value: false, valid: true });
  // Unknown text must be INVALID and must not silently become Automatic-as-valid.
  assert.deepEqual(C.parseCargoLane('sometimes'), { value: null, valid: false }, 'unknown lane invalid');
});

test('CARGO-RULE-V3 same raw value canonicalizes identically across storage and comparison', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const C = await import(`${cargoCanonicalPath.href}${stamp}`);
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  // Raw case with string "false" handling values and a decimal stack count.
  const raw = { id: 'x', name: 'X', dimensions: { length: 10, width: 10, height: 10 }, weight: 5,
    canFlip: 'false', stackable: 'false', noStackOnTop: 'no', isPallet: '0', maxStackCount: '2.7', laneItem: 'never' };
  CaseLibrary.upsert(raw);
  const stored = StateStore.get('caseLibrary')[0];
  assert.equal(stored.canFlip, false, 'stored canFlip from "false" is false');
  assert.equal(stored.stackable, false, 'stored stackable from "false" is false');
  assert.equal(stored.maxStackCount, 2, 'decimal stack count floored at storage');
  assert.equal(stored.laneItem, false, '"never" lane stored as false');
  // The raw and the stored case must compare equal (same canonical result).
  assert.ok(C.cargoFieldsEqual(raw, stored), 'raw and stored canonicalize to the same comparison key');
});

test('CARGO-RULE-V3 comparison: invalid value never equals a valid default', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  const base = { name: 'A', dimensions: { length: 10, width: 10, height: 10 }, weight: 5 };
  const validZeroStack = { ...base, maxStackCount: 0 };
  const invalidStack = { ...base, maxStackCount: 'abc' };
  assert.ok(!C.cargoFieldsEqual(validZeroStack, invalidStack), 'invalid maxStackCount != valid 0');
  const validWeight = { ...base, weight: 0 };
  const invalidWeight = { ...base, weight: 'oops' };
  assert.ok(!C.cargoFieldsEqual(validWeight, invalidWeight), 'invalid weight != valid 0 weight');
  // Two identical invalids DO match (deterministic sentinel).
  assert.ok(C.cargoFieldsEqual(invalidStack, { ...base, maxStackCount: 'abc' }), 'identical invalids match');
});

test('CARGO-RULE-V3 comparison identity excludes manufacturer/category, includes physical fields', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  const a = { name: 'Box', manufacturer: 'ACME', category: 'Tools', dimensions: { length: 10, width: 10, height: 10 }, weight: 5, canFlip: true };
  // Different manufacturer casing + different category → still the same physical case.
  const b = { ...a, manufacturer: 'acme inc', category: 'HARDWARE' };
  assert.ok(C.cargoFieldsEqual(a, b), 'manufacturer/category differences do not fork a physical case');
  // A physical change (weight) → different physical case.
  const c = { ...a, weight: 50 };
  assert.ok(!C.cargoFieldsEqual(a, c), 'a physical (weight) difference is a different case');
  const d = { ...a, canFlip: false };
  assert.ok(!C.cargoFieldsEqual(a, d), 'a handling (canFlip) difference is a different case');
});

test('CARGO-RULE-V3 data-sanity: an absurd dimension never yields infinite volume after normalization', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const out = Normalizer.normalizeCase(
    { id: 'z', name: 'Z', dimensions: { length: 1e300, width: 1e300, height: 1e300 }, weight: 1e300 },
    Date.now()
  );
  assert.ok(Number.isFinite(out.volume), 'volume is finite, not Infinity');
  assert.ok(Number.isFinite(out.weight), 'weight is finite');
  assert.ok(out.dimensions.length <= 100000 && out.dimensions.length > 0, 'dimension clamped to sane bound');
});

test('CARGO-RULE-V3 extensions: safe unknown metadata survives normalize; unsafe values dropped', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Normalizer = await import(`${normalizerPath.href}${stamp}`);
  const raw = {
    id: 'e', name: 'E', dimensions: { length: 10, width: 10, height: 10 },
    customTag: 'keep-me', nested: { ok: 1, fn: () => 1 }, badNum: Infinity,
    evil: () => 'x',
  };
  const out = Normalizer.normalizeCase(raw, Date.now());
  assert.equal(out.customTag, 'keep-me', 'safe scalar extension preserved');
  assert.deepEqual(out.nested, { ok: 1 }, 'nested object kept; function child dropped');
  assert.equal('badNum' in out, false, 'non-finite extension dropped');
  assert.equal('evil' in out, false, 'function extension dropped');
  assert.equal(typeof out.name, 'string', 'known fields still normalized');
});

test('CARGO-RULE-V3 prototype-pollution keys are never preserved as extensions', async () => {
  const C = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  const raw = JSON.parse('{"id":"p","name":"P","__proto__":{"polluted":true},"constructor":{"bad":1},"safe":"ok"}');
  const ext = C.pickSafeExtensions(raw, C.CANONICAL_CASE_KEYS);
  assert.equal(ext.safe, 'ok', 'a normal extension is picked');
  assert.equal(Object.prototype.hasOwnProperty.call(ext, '__proto__'), false, '__proto__ never copied');
  assert.equal(Object.prototype.hasOwnProperty.call(ext, 'constructor'), false, 'constructor never copied');
  assert.equal(({}).polluted, undefined, 'global prototype not polluted');
});

test('CARGO-RULE-V5 computeStats defines totals: total/packed/staged/unresolved + completeness', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const PackLibrary = await import(`${packLibraryPath.href}${stamp}`);
  const truck = { length: 240, width: 96, height: 96 };
  const cases = [
    { id: 'real', name: 'R', dimensions: { length: 20, width: 20, height: 20 }, weight: 100, volume: 8000 },
  ];
  const pack = { id: 'p', title: 'P', truck, cases: [
    // packed (inside truck, near floor/center)
    { id: 'a', caseId: 'real', transform: { position: { x: 20, y: 10, z: 0 } } },
    // staged (far outside the truck in -X staging area)
    { id: 'b', caseId: 'real', transform: { position: { x: -200, y: 10, z: 0 } } },
    // unresolved (no such case)
    { id: 'c', caseId: 'ghost', transform: { position: { x: 30, y: 10, z: 0 } } },
  ] };
  const stats = PackLibrary.computeStats(pack, cases);
  assert.equal(stats.totalCases, 3, 'totalCases counts every instance');
  assert.equal(stats.packedCases, 1, 'one packed');
  assert.equal(stats.stagedCases, 1, 'one staged (resolved but outside truck)');
  assert.equal(stats.unresolvedInstances, 1, 'one unresolved');
  assert.equal(stats.totalsComplete, false, 'totals incomplete with an unresolved instance');
  assert.equal(stats.utilizationComplete, false, 'utilization incomplete');
  // Sanity: packed + staged + unresolved == total (hidden = 0 here).
  assert.equal(stats.packedCases + stats.stagedCases + stats.unresolvedInstances, stats.totalCases);
});

test('CARGO-RULE-V5 editor never fabricates 24in-cube dims for dangling items', async () => {
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.doesNotMatch(editorSrc, /\{\s*length:\s*24,\s*width:\s*24,\s*height:\s*24\s*\}/,
    'no fabricated 24x24x24 fallback may remain in editor placement/movement/unpack paths');
});

test('CARGO-RULE-V1 idempotence holds across alias/number formats and through reload normalization', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });

  // First import: bundled uses 'on side' alias + string dims.
  PackLibrary.importPackPayload({
    pack: { id: 'p1', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('sc', { id: 'a', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 10, orientationLock: 'on side', dimensions: { length: '10', width: '10', height: '10' } })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 2);

  // Simulate a reload: normalize the whole library, then re-import with canonical 'onSide' + numeric dims.
  const reloaded = Normalizer.normalizeAppData({ caseLibrary: StateStore.get('caseLibrary'), packLibrary: [], folderLibrary: [] });
  StateStore.init({ caseLibrary: reloaded.caseLibrary, packLibrary: [], folderLibrary: [], preferences: {} });
  const importedCase = reloaded.caseLibrary.find(c => /\(Imported/.test(c.name));
  assert.ok(importedCase.importSourceKey, 'importSourceKey survives reload normalization');

  const r = PackLibrary.importPackPayload({
    pack: { id: 'p2', title: 'P', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('sc', { id: 'b', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'sc', name: 'Side Case', weight: 10, orientationLock: 'onSide', dimensions: { length: 10, width: 10, height: 10 } })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 2, 'alias/format-equivalent re-import after reload reuses the imported case');
  assert.equal(r.caseConflicts.length, 0, 'no new conflict after reload');
});

test('CARGO-RULE-V1 laneItem:false does not compare equal to Automatic; distinct cargo stays separate', async () => {
  const StateStore = await import(stateStorePath.href);
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 99 })], packLibrary: [], folderLibrary: [], preferences: {} });
  // Two conflicting bundled cases differing only by laneItem false vs automatic(null) → two distinct imported cases.
  PackLibrary.importPackPayload({
    pack: { id: 'pa', title: 'A', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ln', { id: 'x', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 10, laneItem: false })],
  });
  PackLibrary.importPackPayload({
    pack: { id: 'pb', title: 'B', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('ln', { id: 'y', transform: { position: { x: 5, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'ln', name: 'Lane Case', weight: 10, laneItem: null })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 3, 'laneItem:false and Automatic are distinct cargo → two imported cases');
});

test('CARGO-RULE-V1 case-rule-summary returns only active non-default rules', async () => {
  const summaryPath = new URL('../../src/services/case-rule-summary.js', import.meta.url);
  const { getCaseHandlingSummary, getInstanceHandlingSummary } = await import(`${summaryPath.href}?t=${Date.now()}-${Math.random()}`);

  // Defaults → nothing shown
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'any', canFlip: false, noStackOnTop: false, maxStackCount: 0, isPallet: false, laneItem: null, loadPriority: 0 }), []);
  // Each active rule
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'upright' }), ['Upright']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'onSide' }), ['On side']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'any', canFlip: true }), ['Flipping allowed']);
  assert.deepEqual(getCaseHandlingSummary({ orientationLock: 'upright', canFlip: true }), ['Upright'], 'canFlip not shown when policy is not any');
  assert.deepEqual(getCaseHandlingSummary({ noStackOnTop: true }), ['No top load']);
  assert.deepEqual(getCaseHandlingSummary({ stackable: false }), ['No top load']);
  assert.deepEqual(getCaseHandlingSummary({ maxStackCount: 2 }), ['Max 2 on top']);
  assert.deepEqual(getCaseHandlingSummary({ isPallet: true }), ['Pallet base']);
  assert.deepEqual(getCaseHandlingSummary({ isPallet: true, maxPalletWeight: 2000 }), ['Pallet base', 'Max load warning: 2,000 lb']);
  assert.deepEqual(getCaseHandlingSummary({ maxPalletWeight: 2000 }), [], 'pallet warning only shown for pallets');
  assert.deepEqual(getCaseHandlingSummary({ laneItem: true }), ['Lane: Always']);
  assert.deepEqual(getCaseHandlingSummary({ laneItem: false }), ['Lane: Never']);
  assert.deepEqual(getCaseHandlingSummary({ loadPriority: 1 }), ['Priority: High']);
  assert.deepEqual(getCaseHandlingSummary({ loadPriority: -1 }), ['Priority: Low']);
  // Instance lock shown separately
  assert.deepEqual(getInstanceHandlingSummary({ orientationLocked: true }), ['Orientation locked (this item)']);
  assert.deepEqual(getInstanceHandlingSummary({ orientationLocked: false }), []);
});

test('CARGO-RULE-V1 all case surfaces use the shared rule-summary source', async () => {
  const casesSrc = await fs.readFile(casesScreenPath, 'utf8');
  const editorSrc = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(casesSrc, /import \{ getCaseHandlingSummary \} from '\.\.\/services\/case-rule-summary\.js'/, 'cases screen imports the shared summary');
  assert.match(casesSrc, /getCaseHandlingSummary\(c\)/, 'cases screen renders the shared summary (cards + list)');
  assert.match(editorSrc, /import \{ getCaseHandlingSummary, getInstanceHandlingSummary \} from '\.\.\/services\/case-rule-summary\.js'/, 'editor imports the shared summary');
  assert.match(editorSrc, /getCaseHandlingSummary\(c\)/, 'editor case browser uses the shared summary');
  assert.match(editorSrc, /getCaseHandlingSummary\(caseData\)/, 'inspector uses the shared summary');
  // 3D pallet label is warning-worded, not an enforced cap
  assert.match(editorSrc, /Warning limit: \$\{caseData\.maxPalletWeight\} lb/, '3D pallet label must read as a warning limit');
  assert.ok(!/`Max: \$\{caseData\.maxPalletWeight\} lb`/.test(editorSrc), 'must not show the old enforced-looking "Max: X lb" label');
});

test('CARGO-RULE-V1 P1 shared oriented-dims helper matches THREE Euler XYZ for every right-angle combo', async () => {
  const { getOrientedDimsForRotation } = await import(`${orientedDimsPath.href}?t=${Date.now()}-${Math.random()}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  // Asymmetric case so every axis permutation is distinguishable.
  const dims = { length: 30, width: 20, height: 10 };
  // identity, single, compound, full, plus negative and >360 right angles.
  const rotations = [
    { x: 0, y: 0, z: 0 },
    { x: H, y: 0, z: 0 },
    { x: 0, y: H, z: 0 },
    { x: 0, y: 0, z: H },
    { x: H, y: H, z: 0 },
    { x: H, y: 0, z: H },
    { x: 0, y: H, z: H },
    { x: H, y: H, z: H },
    { x: -H, y: 0, z: 0 },
    { x: 0, y: -H, z: -H },
    { x: Math.PI, y: 0, z: 0 },
    { x: 3 * H, y: H, z: 2 * Math.PI + H },
    { x: 5 * Math.PI, y: -3 * H, z: 4 * Math.PI },
  ];
  for (const rot of rotations) {
    const got = getOrientedDimsForRotation(dims, rot);
    const want = truth(dims, rot);
    assert.deepEqual(got, want, `oriented dims mismatch vs THREE for rot ${JSON.stringify(rot)}`);
  }
});

test('CARGO-RULE-V1 P1 all consumer paths derive identical oriented dims from the shared helper', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const { getOrientedDimsForRotation } = await import(`${orientedDimsPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const truth = await threeOrientedTruth();
  const H = Math.PI / 2;
  const dims = { length: 30, width: 20, height: 10 };
  const rot = { x: H, y: 0, z: H }; // compound — the case that exposed the bug.
  const want = truth(dims, rot);

  // Core shared helper.
  assert.deepEqual(getOrientedDimsForRotation(dims, rot), want, 'core helper');
  // pack-library re-export produces identical results to the shared helper.
  assert.deepEqual(PackLib.getOrientedDimsForRotation(dims, rot), want, 'pack-library path matches the shared helper');
  // Solver candidate for a locked compound rotation uses the same math.
  const cands = Solver.buildOrientationCandidates(
    { l: dims.length, w: dims.width, h: dims.height },
    { orientationLocked: true, lockedRotation: rot }
  );
  assert.equal(cands.length, 1, 'locked rotation yields exactly one candidate');
  assert.deepEqual(
    { length: cands[0].l, width: cands[0].w, height: cands[0].h },
    want,
    'solver locked-candidate dims match THREE'
  );
});

test('CARGO-RULE-V1 orientation aliases canonicalize consistently across every path', async () => {
  const orientationPath = new URL('../../src/core/orientation.js', import.meta.url);
  const { canonicalOrientationLock } = await import(`${orientationPath.href}?t=${Date.now()}-${Math.random()}`);
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 30, w: 20, h: 10 };

  const sideAliases = ['onSide', 'onside', 'on-side', 'on side', 'ON SIDE', 'On-Side', 'on_side'];
  for (const a of sideAliases) {
    assert.equal(canonicalOrientationLock(a), 'onSide', `core canon: ${a}`);
    // Solver: every alias must produce the 2 side candidates (never 0).
    assert.equal(Solver.buildOrientationCandidates(dims, { orientationLock: a, canFlip: false }).length, 2, `solver candidates for ${a}`);
    // Normalizer / model store canonical onSide.
    assert.equal(Normalizer.normalizeCase({ id: 'o', name: 'O', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: a }, Date.now()).orientationLock, 'onSide', `normalizer canon: ${a}`);
    // Spreadsheet cell parser canonicalizes with no spurious warning.
    assert.deepEqual(IE.parseOrientationLockCell(a), { value: 'onSide', warning: null }, `import cell: ${a}`);
    // Manual rotation policy agrees with AutoPack: onSide permits a tipped rotation.
    assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: a }, { x: Math.PI / 2, y: 0, z: 0 }), true, `manual policy onSide: ${a}`);
  }
  for (const a of ['upright', 'UPRIGHT']) assert.equal(canonicalOrientationLock(a), 'upright');
  for (const a of ['any', 'ANY', '', null, undefined, 'sideways', 'garbage']) assert.equal(canonicalOrientationLock(a), 'any', `invalid->any: ${a}`);
  // Invalid spreadsheet orientation warns and falls back to any.
  assert.equal(IE.parseOrientationLockCell('sideways').value, 'any');
  assert.ok(IE.parseOrientationLockCell('sideways').warning, 'invalid orientation warns');

  // Pack-import conflict comparator treats aliases as equivalent (no false conflict).
  const StateStore = await import(stateStorePath.href);
  StateStore.init({ caseLibrary: [makePackImportSafeCase({ id: 'oc', name: 'Orient Case', orientationLock: 'onSide' })], packLibrary: [], folderLibrary: [], preferences: {} });
  const res = PackLib.importPackPayload({
    pack: { id: 'op', title: 'OP', truck: { length: 120, width: 60, height: 60 }, cases: [makePackImportInstance('oc', { id: 'oi', transform: { position: { x: 10, y: 5, z: 0 } } })] },
    bundledCases: [makePackImportSafeCase({ id: 'oc', name: 'Orient Case', orientationLock: 'on side' })],
  });
  assert.equal((StateStore.get('caseLibrary') || []).length, 1, 'alias-equivalent bundled case must be reused, not duplicated');
  assert.equal(res.caseConflicts.length, 0, 'orientation alias difference is not a real conflict');
});

test('CARGO-RULE-V4 repeatedBatchKey uses canonical orientation (aliases batch together)', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const mkItem = (lock) => ({
    className: 'BOX',
    candidates: [{ l: 10, w: 10, h: 10 }],
    dims: { l: 10, w: 10, h: 10 },
    item: { caseId: 'c', orientationLock: lock, canFlip: false, noStackOnTop: false, stackable: true, maxStackCount: 0 },
  });
  const keyA = Solver.repeatedBatchKey(mkItem('onSide'));
  for (const alias of ['onside', 'on-side', 'on side', 'ON SIDE', 'On_Side']) {
    assert.equal(Solver.repeatedBatchKey(mkItem(alias)), keyA, `alias "${alias}" must produce the same batch key as onSide`);
  }
  assert.notEqual(
    Solver.repeatedBatchKey({ ...mkItem('onSide'), item: { ...mkItem('onSide').item, caseId: 'different-case-id' } }),
    keyA,
    'different case ids stay in separate repeated batches even when physical dimensions and orientation aliases match'
  );
  // A genuinely different policy yields a different key.
  assert.notEqual(Solver.repeatedBatchKey(mkItem('upright')), keyA, 'upright is a distinct batch key');
});

test('CARGO-RULE-V4 live item preparation (buildLegacyAutoPackItems) is alias-invariant', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const ItemBuilder = await import(`${autoPackItemBuilderPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const orientationTools = {
    normalizeRightAngleRotation: PackLib.normalizeRightAngleRotation,
    getOrientedDimsForRotation: PackLib.getOrientedDimsForRotation,
  };
  const volumeInCubicInches = (d) => d.length * d.width * d.height;
  const build = (lock) => {
    const cases = { c: { id: 'c', dimensions: { length: 30, width: 20, height: 10 }, orientationLock: lock, canFlip: false, shape: 'box', volume: 6000 } };
    const items = ItemBuilder.buildLegacyAutoPackItems({
      instances: [{ id: 'i', caseId: 'c', hidden: false }],
      getCaseById: (id) => cases[id] || null,
      volumeInCubicInches,
      orientationTools,
    });
    return items[0].orientations;
  };
  const base = build('onSide');
  // on-side must yield the SAME orientation set as onSide (previously 'on-side'
  // failed the lowercase compare and fell through to the wrong branch).
  for (const alias of ['on-side', 'on side', 'ON SIDE']) {
    assert.deepEqual(build(alias), base, `item preparation must be invariant for alias "${alias}"`);
  }
  // onSide must NOT equal upright's orientation set (sanity: the fix didn't collapse policies).
  assert.notDeepEqual(build('upright'), base, 'onSide and upright remain distinct orientation sets');
});

test('CARGO-RULE-V1 CaseLibrary.upsert canonicalizes cargo fields and preserves unknown fields', async () => {
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  CaseLibrary.upsert({
    id: 'u1', name: 'Upsert Case', category: 'default', dimensions: { length: 10, width: 10, height: 10 }, weight: 5,
    orientationLock: 'on side', maxStackCount: 2.7, maxPalletWeight: -3, loadPriority: '1', laneItem: 'false',
    stackable: false, canFlip: 'yes', isPallet: 1,
    importSourceKey: 'keep-me', someExtensionField: 'preserve',
  });
  const c = (StateStore.get('caseLibrary') || []).find(x => x.id === 'u1');
  assert.equal(c.orientationLock, 'onSide', 'orientation alias canonicalized on upsert');
  assert.equal(c.maxStackCount, 2, 'decimal maxStackCount floored to integer');
  assert.equal(c.maxPalletWeight, 0, 'negative maxPalletWeight clamped');
  assert.equal(c.stackable, false, 'explicit stackable:false preserved');
  assert.equal(c.canFlip, true, 'canFlip coerced to boolean');
  assert.equal(c.isPallet, true, 'isPallet coerced to boolean');
  assert.equal(c.importSourceKey, 'keep-me', 'unknown idempotence field preserved');
  assert.equal(c.someExtensionField, 'preserve', 'unknown extension field preserved');
});

test('CARGO-RULE-V1 normalizers floor decimal maxStackCount', async () => {
  const Normalizer = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const base = { id: 'm', name: 'M', dimensions: { length: 10, width: 10, height: 10 } };
  assert.equal(Normalizer.normalizeCase({ ...base, maxStackCount: 3.9 }, Date.now()).maxStackCount, 3, 'core normalizer floors maxStackCount');
});

test('CARGO-RULE-V6 warnings (non-blocking) are distinct from blocking row errors', async () => {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  // Row 1: valid dims but invalid handling cells -> warnings, still imports.
  // Row 2: invalid dimension (length 0) -> blocking error, excluded.
  const csv = `${CARGO_HEADER}\nGoodDims,10,10,10,5,maybe,any,auto,1\nBadDims,0,10,10,5,yes,any,auto,1`;
  const result = await IE.parseAndValidateSpreadsheet(makeCsvFile(csv), []);
  assert.equal(result.valid.length, 1, 'only the dimensionally-valid row imports');
  assert.ok(result.valid[0].warnings.length > 0, 'the imported row carries non-blocking warnings');
  assert.equal(result.invalidRows.length, 1, 'the bad-dimension row is a blocking error, not a warning');
  assert.ok((result.invalidRows[0].reasons || []).some(r => /length/i.test(r)), 'blocking reason names the bad field');
});

test('CARGO-RULE-V6 extreme numeric values raise a data-sanity warning', async () => {
  installWindowXLSX();
  const IE = await import(`${importExportPath.href}?t=${Date.now()}-${Math.random()}`);
  const csv = `${CARGO_HEADER}\nHuge,1e9,10,10,5,yes,any,auto,1`;
  const result = await IE.parseAndValidateSpreadsheet(makeCsvFile(csv), []);
  const rec = result.valid[0];
  const lenWarn = findRowWarning(rec, 'length');
  assert.ok(lenWarn, 'an extreme length raises a data-sanity warning');
  assert.match(lenWarn.message, /exceeds the maximum/);
});

test('CARGO-RULE-V1 unchecking no-top-load clears legacy stackable:false (modal save)', async () => {
  // Verified at the source level since the modal builds DOM imperatively.
  const src = await fs.readFile(caseModalPath, 'utf8');
  assert.match(src, /noStackOnTop: noTopChecked/);
  assert.match(src, /stackable: noTopChecked \? initial\.stackable !== false : true/);
  // Phase 7: the stack cap is PRESERVED (not zeroed) under no-top-load; the field is
  // disabled and the solver ignores it while noStackOnTop is active.
  assert.match(src, /maxStackCount: Math\.max\(0, parseInt\(fMaxStack\.input\.value, 10\) \|\| 0\)/);
  assert.doesNotMatch(src, /maxStackCount: noTopChecked \? 0 :/, 'no-top-load must not silently zero the saved stack count');
  assert.match(src, /AutoPack may still place them normally/i, 'lane copy reflects that Always is a preference, not a guarantee');
});

test('CARGO-RULE-V1 canonicalOrientationLock maps all accepted spellings', async () => {
  const Modal = await import(`${caseModalPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.equal(Modal.canonicalOrientationLock('upright'), 'upright');
  assert.equal(Modal.canonicalOrientationLock('UPRIGHT'), 'upright');
  assert.equal(Modal.canonicalOrientationLock('onside'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('on-side'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('on side'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('onSide'), 'onSide');
  assert.equal(Modal.canonicalOrientationLock('any'), 'any');
  assert.equal(Modal.canonicalOrientationLock(undefined), 'any');
  assert.equal(Modal.canonicalOrientationLock('garbage'), 'any');
});

test('CARGO-RULE-V1 case duplicate preserves all handling rules', async () => {
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const src = {
    id: 'dup-src', name: 'Dup Source', category: 'default',
    dimensions: { length: 30, width: 20, height: 10 }, weight: 50,
    canFlip: true, orientationLock: 'onSide', noStackOnTop: true, stackable: false,
    maxStackCount: 3, isPallet: true, maxPalletWeight: 1500, laneItem: false, loadPriority: 1,
    hazmatClass: 'flammable', stopGroup: 'A',
  };
  StateStore.init({ caseLibrary: [src], packLibrary: [], folderLibrary: [], preferences: {} });
  const copy = CaseLibrary.duplicate('dup-src');
  for (const f of ['canFlip', 'orientationLock', 'noStackOnTop', 'stackable', 'maxStackCount', 'isPallet', 'maxPalletWeight', 'laneItem', 'loadPriority', 'hazmatClass', 'stopGroup']) {
    assert.deepEqual(copy[f], src[f], `duplicate must preserve ${f}`);
  }
  assert.notEqual(copy.id, src.id, 'duplicate gets a new id');
});

test('CARGO-RULE-V1 case modal exposes only honest handling controls with canonical save mapping', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  // Section + controls
  assert.match(src, /Handling Rules/, 'modal must add a Handling Rules section');
  assert.match(src, /\['onSide', 'Place on side'\]/, 'orientation select must offer onSide canonical');
  assert.match(src, /'Do not place cargo on top'/, 'no-top-load control label');
  assert.match(src, /Max items directly on top \(0 = no limit\)/, 'maxStackCount control with 0=no limit copy');
  assert.match(src, /Treat as pallet \/ load base/, 'pallet control label');
  assert.match(src, /Max load — warning only/, 'pallet weight labeled warning-only');
  assert.match(src, /does not block AutoPack/i, 'pallet weight help must say it does not block packing');
  assert.match(src, /Packing priority \(tie-breaker\)/, 'priority labeled as tie-breaker');
  // Canonical save mapping
  assert.match(src, /canFlip:\s*orientationLock === 'any' && Boolean\(flip\.checked\)/, 'canFlip only when policy is any');
  assert.match(src, /orientationLock,\n[\s\S]*noStackOnTop: noTopChecked/, 'save sets orientationLock + noStackOnTop');
  assert.match(src, /maxStackCount: Math\.max\(0, parseInt\(fMaxStack\.input\.value, 10\) \|\| 0\)/, 'maxStackCount preserved (not zeroed) under no-top-load; field disabled and solver ignores it');
  assert.match(src, /stackable: noTopChecked \? initial\.stackable !== false : true/, 'unchecking no-top-load clears the legacy stackable:false rule');
  assert.match(src, /laneItem: laneValue/, 'save sets laneItem tri-state');
  assert.match(src, /loadPriority: priorityValue/, 'save sets loadPriority');
  assert.match(src, /\.\.\.initial,/, 'save must spread ...initial to preserve hidden/deferred fields');
  // Dependencies
  assert.match(src, /flip\.disabled = !isAny/, 'flip disabled when orientation not any');
  assert.match(src, /fMaxStack\.input\.disabled = noTop\.checked/, 'maxStackCount disabled under no-top-load');
  assert.match(src, /fPalletWarn\.wrap\.style\.display = pallet\.checked/, 'pallet warn shown only when pallet enabled');
  // No deferred/inert controls exposed
  assert.ok(!/createCheckRow\(doc, '[^']*[Ff]ragile/.test(src), 'must not expose a Fragile control');
  assert.ok(!/[Hh]azmat|stopGroup|mustLoadLast|deliverySequence/.test(src), 'must not expose deferred/inert fields');
});

test('CARGO-RULE-V7 no-top-load disables but never erases the saved stack count', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  // Field disabled while no-top-load is on, but the saved value is kept.
  assert.match(src, /fMaxStack\.input\.disabled = noTop\.checked/, 'stack-count field disabled under no-top-load');
  assert.match(src, /maxStackCount: Math\.max\(0, parseInt\(fMaxStack\.input\.value, 10\) \|\| 0\)/,
    'save preserves the stack count regardless of no-top-load');
  assert.doesNotMatch(src, /maxStackCount: noTopChecked \? 0/, 'must not zero the saved stack count');
});

test('CARGO-RULE-V7 storage keeps the cap and the solver gate blocks children under noStackOnTop', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  // The saved cap survives storage alongside no-top-load (never silently erased).
  CaseLibrary.upsert({ id: 'base', name: 'Base', dimensions: { length: 40, width: 40, height: 6 }, noStackOnTop: true, maxStackCount: 5 });
  const saved = StateStore.get('caseLibrary').find(c => c.id === 'base');
  assert.equal(saved.noStackOnTop, true, 'no-top-load persisted');
  assert.equal(saved.maxStackCount, 5, 'stack cap preserved alongside no-top-load (not erased)');
  // The "can have items on top" gate is governed by noStackOnTop/stackable,
  // independent of maxStackCount, so the preserved cap is ignored while no-top-load
  // is on. The gate lives once in packing-core/validation.js (the single validation
  // authority) and the solver delegates to it.
  const validationSrc = await fs.readFile(packingCoreValidationPath, 'utf8');
  assert.match(validationSrc, /!\(rules\.noStackOnTop \|\| rules\.stackable === false\)/,
    'the top-load gate depends on noStackOnTop/stackable, not on maxStackCount');
  const solverSrc = await fs.readFile(autoPackSolverPath, 'utf8');
  assert.match(solverSrc, /rulesAllowStackOnTop\(getPlacementRules\(placement\)\)/,
    'the solver delegates the top-load gate to the shared validation authority');
});

test('CARGO-RULE-V7 pallet + no-top-load shows an explanatory note; pallet warning is dormant when not a pallet', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  assert.match(src, /This pallet is marked .No top load,. so AutoPack will not place cargo on it\./,
    'pallet + no-top-load copy explains AutoPack will not load it');
  // Pallet warning value preserved (dormant) when pallet is unchecked — toggling
  // Pallet off/on must not destroy the saved warning value.
  assert.match(src, /maxPalletWeight: pallet\.checked \? Math\.max\(0, Number\(fPalletWarn\.input\.value\) \|\| 0\) : \(Math\.max\(0, Number\(initial\.maxPalletWeight\) \|\| 0\)\)/,
    'non-pallet keeps the dormant maxPalletWeight value');
});

test('CARGO-RULE-V7 manual-rotation policy block uses accurate wording (not "orientation locked")', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  assert.match(src, /Cannot rotate: the case's orientation policy does not allow this rotation\./,
    'policy-blocked rotation message names the case orientation policy');
  assert.doesNotMatch(src, /this item is orientation-locked/, 'must not mislabel a policy block as an instance lock');
});

test('CARGO-RULE-V7 orientation distinction: canFlip governs AutoPack tipping; manual exact lock allowed under "any"', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const dims = { l: 30, w: 20, h: 10 };
  const tippedRot = { x: Math.PI / 2, y: 0, z: 0 };
  // canFlip controls AUTOPACK-generated tipping: any + canFlip:false → no tipped candidate.
  const noFlipCands = Solver.buildOrientationCandidates(dims, { orientationLock: 'any', canFlip: false });
  assert.ok(noFlipCands.every(c => c.h === dims.h), 'any + canFlip:false generates no AutoPack tip');
  // BUT a manual exact rotation is still permitted under the "any" policy (it does not
  // depend on canFlip) — this is the chosen product contract for manual exact locks.
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'any', canFlip: false }, tippedRot), true,
    'manual exact lock permitted under any policy regardless of canFlip');
  // upright blocks BOTH manual and automatic tipping.
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, tippedRot), false,
    'upright blocks a manual tip');
  assert.ok(Solver.buildOrientationCandidates(dims, { orientationLock: 'upright', canFlip: true }).every(c => c.h === dims.h),
    'upright blocks AutoPack tipping even with canFlip');
  // An exact instance lock overrides case candidate generation (one candidate).
  const locked = Solver.buildOrientationCandidates(dims, { orientationLock: 'any', canFlip: true, orientationLocked: true, lockedRotation: tippedRot });
  assert.equal(locked.length, 1, 'instance exact lock overrides candidate generation');
  assert.equal(locked[0].locked, true, 'the single candidate is the locked one');
});

test('CARGO-RULE-V8 matrix: modal-save sink (CaseLibrary.upsert) canonicalizes + drops a function extension', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  // Include a function extension: it must be dropped so storage stays clone-safe.
  CaseLibrary.upsert(hostileRawCase({ evil() { return 1; } }));
  const stored = StateStore.get('caseLibrary')[0];
  assertHostileCanonical(stored);
  // Autosave clones state with structuredClone — a stored function would throw.
  assert.doesNotThrow(() => structuredClone(stored), 'stored case is structuredClone-safe (no function)');
});

test('CARGO-RULE-V8 matrix: duplicate keeps the canonical cargo rules', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  CaseLibrary.upsert(hostileRawCase({ evil() { return 1; } }));
  const dup = CaseLibrary.duplicate('hostile');
  assert.ok(dup && dup.id !== 'hostile', 'duplicate has a new id');
  assertHostileCanonical(CaseLibrary.getById(dup.id));
});

test('CARGO-RULE-V8 matrix: undo/redo restores canonical state after an edit', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const StateStore = await import(stateStorePath.href);
  const CaseLibrary = await import(`${caseLibraryPath.href}${stamp}`);
  StateStore.init({ caseLibrary: [], packLibrary: [], folderLibrary: [], preferences: {} });
  CaseLibrary.upsert(hostileRawCase());
  const afterFirst = StateStore.get('caseLibrary')[0].weight;
  CaseLibrary.upsert({ ...hostileRawCase(), weight: 999 });
  assert.equal(StateStore.get('caseLibrary')[0].weight, 999, 'edit applied');
  StateStore.undo();
  assert.equal(StateStore.get('caseLibrary')[0].weight, afterFirst, 'undo restores the prior canonical state');
  StateStore.redo();
  assert.equal(StateStore.get('caseLibrary')[0].weight, 999, 'redo re-applies the edit');
});

test('CARGO-RULE-V1 orientation truth table: upright/onSide beat canFlip; instance lock overrides all', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 30, w: 20, h: 10 }; // all distinct so a tipped face has h !== 10
  const cand = (item) => Solver.buildOrientationCandidates(dims, item);
  const hasTipped = (cs) => cs.some(c => c.h !== dims.h);
  const allUpright = (cs) => cs.every(c => c.h === dims.h);

  // 1) any + false → upright yaw only
  let cs = cand({ orientationLock: 'any', canFlip: false });
  assert.equal(cs.length, 2); assert.equal(allUpright(cs), true, 'any+false must be upright only');
  // 2) any + true → tipped faces allowed
  cs = cand({ orientationLock: 'any', canFlip: true });
  assert.equal(hasTipped(cs), true, 'any+true must allow tipped faces');
  // 3) upright + false → upright only
  cs = cand({ orientationLock: 'upright', canFlip: false });
  assert.equal(allUpright(cs), true, 'upright+false must be upright only');
  // 4) upright + true → STILL upright only (the fix)
  cs = cand({ orientationLock: 'upright', canFlip: true });
  assert.equal(allUpright(cs), true, 'upright+true must remain upright (orientation policy beats flip)');
  // 5) onSide + false → side orientations regardless of canFlip
  cs = cand({ orientationLock: 'onSide', canFlip: false });
  assert.equal(cs.length > 0, true); assert.equal(hasTipped(cs), true, 'onSide+false must produce side faces');
  // 6) onSide + true → still side orientations only
  cs = cand({ orientationLock: 'onSide', canFlip: true });
  assert.equal(hasTipped(cs), true, 'onSide+true side faces');
  // 7) valid instance exact lock overrides both policy and canFlip
  cs = cand({ orientationLock: 'any', canFlip: true, orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 } });
  assert.equal(cs.length, 1, 'instance lock yields exactly one candidate');
  assert.equal(cs[0].locked, true, 'instance lock candidate is marked locked');

  // Manual rotate policy and AutoPack now agree: upright disallows a tipped rotation.
  const tippedRot = { x: Math.PI / 2, y: 0, z: 0 };
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, tippedRot), false,
    'manual policy: upright rejects a tipped rotation — matches AutoPack producing no tipped candidate');
  assert.equal(PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'any' }, tippedRot), true,
    'manual policy: any allows tipped — matches AutoPack canFlip behavior');
});

test('CARGO-RULE-V1 new-case modal initial defaults canFlip to false', async () => {
  const src = await fs.readFile(caseModalPath, 'utf8');
  // The new-case branch builds an inline initial object; assert canFlip:false and no canFlip:true new-case default.
  assert.match(src, /canFlip:\s*false/, 'case modal new-case initial must default canFlip to false');
  assert.ok(!/\n\s*canFlip:\s*true\s*,/.test(src), 'case modal must not default a new case to canFlip:true');
});

test('AUTO-PACK-A1-R4 stack phase honors noStackOnTop and stackable false supports', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 24, width: 24, height: 48 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 24, y: 48, z: 12 } }];

  const noStackOutput = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'fragile-base', loadPriority: 2, noStackOnTop: true, dims: { l: 24, w: 24, h: 24 } },
      { instanceId: 'top-case', loadPriority: 1, dims: { l: 24, w: 24, h: 24 } },
    ],
  });
  assert.equal(noStackOutput.placements.size, 1);
  assert.deepEqual(noStackOutput.unpacked, ['top-case']);
  assert.equal(noStackOutput.phaseStats.stackCount, 0,
    'noStackOnTop support must not receive stacked items');

  const stackableFalseOutput = Solver.solveAutoPack({
    truck,
    zones,
    items: [
      { instanceId: 'unstackable-base', loadPriority: 2, stackable: false, dims: { l: 24, w: 24, h: 24 } },
      { instanceId: 'top-case', loadPriority: 1, dims: { l: 24, w: 24, h: 24 } },
    ],
  });
  assert.equal(stackableFalseOutput.placements.size, 1);
  assert.deepEqual(stackableFalseOutput.unpacked, ['top-case']);
  assert.equal(stackableFalseOutput.phaseStats.stackCount, 0,
    'stackable=false support must not receive stacked items');
});

test('5A noStackOnTop is honored through the filler and repack passes', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 96, width: 48, height: 120 };
  const zones = [{ min: { x: 0, y: 0, z: -24 }, max: { x: 96, y: 120, z: 24 } }];
  const items = [
    { instanceId: 'frag', dims: { l: 96, w: 48, h: 24 }, weight: 2000, noStackOnTop: true },
    ...Array.from({ length: 6 }, (_, i) => ({ instanceId: `x${i}`, dims: { l: 48, w: 24, h: 24 }, weight: 10 })),
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const od = out.orientedDims.get('frag');
  const fragAabb = Solver.getAabb(out.placements.get('frag'), { l: od.length, w: od.width, h: od.height });
  let onFrag = 0;
  for (let i = 0; i < 6; i++) {
    const pos = out.placements.get(`x${i}`);
    if (!pos) continue;
    const cod = out.orientedDims.get(`x${i}`);
    const a = Solver.getAabb(pos, { l: cod.length, w: cod.width, h: cod.height });
    if (Math.abs(a.min.y - fragAabb.max.y) < 0.06 && a.min.x < fragAabb.max.x && a.max.x > fragAabb.min.x) onFrag++;
  }
  assert.equal(onFrag, 0, 'no item may rest on a noStackOnTop base after the floor base covers the deck (filler + repack must not bypass it)');
  assert.equal(out.placements.has('frag'), true, 'the noStackOnTop base itself is still floor-placed');
});

test('5A maxStackCount 0 means unlimited direct children', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 48, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 48, y: 72, z: 12 } }];
  const items = [
    { instanceId: 'base', dims: { l: 48, w: 24, h: 24 }, weight: 1000, maxStackCount: 0, loadPriority: 5 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  assert.equal(out.placements.size, 3);
  assert.deepEqual(out.unpacked, []);
  assert.equal(out.phaseStats.stackCount, 2, 'maxStackCount: 0 must be treated as no limit, so both children may stack on the base');
});

test('5A maxStackCount caps direct children but allows a taller multi-layer tower', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 72, width: 24, height: 72 };
  const zones = [{ min: { x: 0, y: 0, z: -12 }, max: { x: 72, y: 72, z: 12 } }];
  const items = [
    { instanceId: 'base', dims: { l: 72, w: 24, h: 24 }, weight: 1000, maxStackCount: 2, loadPriority: 5 },
    { instanceId: 'c1', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c2', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
    { instanceId: 'c3', dims: { l: 24, w: 24, h: 24 }, weight: 10, loadPriority: 1 },
  ];
  const out = Solver.solveAutoPack({ truck, zones, items, loadFrontFirst: true });
  const aabb = id => {
    const od = out.orientedDims.get(id);
    return Solver.getAabb(out.placements.get(id), { l: od.length, w: od.width, h: od.height });
  };
  const baseTop = aabb('base').max.y;
  const direct = ['c1', 'c2', 'c3'].filter(id => Math.abs(aabb(id).min.y - baseTop) < 0.06).length;
  assert.equal(direct, 2, 'maxStackCount: 2 limits the base to exactly two direct children');
  assert.equal(out.placements.size, 4, 'the third child still packs by stacking onto a child layer (per-support cap, not a global tower-height cap)');
});

test('5A case normalizer preserves explicit stackable:false and maxStackCount:0', async () => {
  const { normalizeCase } = await import(`${normalizerPath.href}?t=${Date.now()}-${Math.random()}`);
  const now = Date.now();
  // Pass an explicit id so normalization does not fall through to uuid()/window.
  const norm = extra => normalizeCase({ id: 'case-5a', name: 'Case 5A', dimensions: { length: 48, width: 24, height: 24 }, ...extra }, now);
  assert.equal(norm({ stackable: false }).stackable, false, 'explicit stackable:false must survive normalization');
  assert.equal(norm({}).stackable, true, 'missing stackable must default to true');
  assert.equal(norm({ maxStackCount: 0 }).maxStackCount, 0, 'explicit maxStackCount:0 must survive normalization');
  assert.equal(norm({ maxStackCount: 3 }).maxStackCount, 3, 'explicit maxStackCount must survive normalization');
  assert.equal(norm({ maxStackCount: -2 }).maxStackCount, 0, 'negative maxStackCount clamps to 0');
  assert.equal(norm({ noStackOnTop: true }).noStackOnTop, true, 'explicit noStackOnTop:true must survive normalization');
  assert.equal(norm({}).noStackOnTop, false, 'missing noStackOnTop must default to false');
});

test('REPAIR-1C 5 (P0-B): an exact instance lock at a pose the case policy forbids does not override it and still does not pack', async () => {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  const Solver = await import(`${autoPackSolverPath.href}${stamp}`);
  const PackLib = await import(`${packLibraryPath.href}${stamp}`);
  const truck = { length: 240, width: 96, height: 96 };
  const zones = PackLib.getTrailerUsableZones(truck);
  // Old fixture rule (onSide) → unpacked (only tall/too-wide candidates).
  const before = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true,
    items: [r1cSolverItem({ orientationLock: 'onSide', canFlip: false })] });
  assert.ok(!before.placements.has('i'), 'onSide beam does not pack (engine correctly honors the case policy)');
  // P0-B: the horizontal (identity) pose is upright — isHeightAxisVertical is true —
  // which is illegal under an onSide case policy. Locking to it no longer overrides
  // the case policy (that was the confirmed P0-B defect); buildOrientationCandidates
  // returns no candidate for the stale lock, so the item still does not pack, exactly
  // like the unlocked "before" case. The case rule itself is unchanged.
  const after = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true,
    items: [r1cSolverItem({ orientationLock: 'onSide', canFlip: false, orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 } })] });
  assert.ok(!after.placements.has('i'),
    'an exact instance lock at a case-policy-illegal pose (onSide + horizontal/upright) must not override the policy and must not pack');
  assert.equal(
    Solver.buildOrientationCandidates({ l: 144, w: 8, h: 8 },
      { orientationLock: 'onSide', canFlip: false, orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 } }
    ).length,
    0, 'the stale lock yields no orientation candidate at all — no silent fallback to another pose'
  );
});

test('placement-safety-P0A single inspector Rotate/Flip routes through rotateSelection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const singleStart = src.indexOf('function renderSingleInspector(pack, inst, caseData, prefs)');
  const singleEnd = src.indexOf('\n    /**\n     * Creates a card header row', singleStart);
  const singleBlock = singleStart >= 0 && singleEnd > singleStart ? src.slice(singleStart, singleEnd) : '';

  assert.match(singleBlock, /InteractionManager\.rotateSelection\(axis,\s*delta\)/,
    'single inspector rotate/flip buttons must route through InteractionManager.rotateSelection');
  // The deferred rAF+double-updateInstance pattern without collision guard must be gone.
  // (rotateSelection handles settle + collision check internally before any persist.)
  assert.doesNotMatch(singleBlock, /requestAnimationFrame[\s\S]{0,300}PackLibrary\.updateInstance[\s\S]{0,300}rotation:/,
    'single inspector rotate/flip must not persist rotation via deferred rAF without collision guard');
});

test('placement-safety-P0A multi-select Rotate All routes through rotateSelection', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const multiStart = src.indexOf('function renderMultiInspector(pack, selected)');
  const multiEnd = src.indexOf('// === Actions Card ===', multiStart);
  const multiBlock = multiStart >= 0 && multiEnd > multiStart ? src.slice(multiStart, multiEnd) : '';

  assert.match(multiBlock, /InteractionManager\.rotateSelection\(axis,\s*delta\)/,
    'multi-select Rotate All must route through InteractionManager.rotateSelection');
  assert.doesNotMatch(multiBlock, /selected\.forEach[\s\S]*PackLibrary\.updateInstance/,
    'multi-select Rotate All must not iterate selected items and directly call PackLibrary.updateInstance');
});

test('placement-safety-P0B createInstanceGroup stores baseHalfWorld for reset fallback', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const createStart = src.indexOf('function createInstanceGroup(inst, caseData)');
  const createEnd = src.indexOf('\n    function ', createStart + 1);
  const createBlock = createEnd > createStart ? src.slice(createStart, createEnd) : src.slice(createStart);

  assert.match(createBlock, /group\.userData\.baseHalfWorld\s*=\s*\{/,
    'createInstanceGroup must store baseHalfWorld so applyTransform can reset to base dims');
});

test('placement-safety-P0B applyTransform resets halfWorld to base dims when orientedDims absent', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const applyStart = src.indexOf('function applyTransform(group, inst)');
  const applyEnd = src.indexOf('\n    function ', applyStart + 1);
  const applyBlock = applyEnd > applyStart ? src.slice(applyStart, applyEnd) : src.slice(applyStart);

  assert.match(applyBlock, /else if \(group\.userData\.baseHalfWorld\)/,
    'applyTransform must have an else-if branch to reset halfWorld from baseHalfWorld when orientedDims absent');
  assert.match(applyBlock, /group\.userData\.halfWorld\s*=\s*\{\s*\.\.\.\s*group\.userData\.baseHalfWorld\s*\}/,
    'applyTransform must spread baseHalfWorld into halfWorld on the reset path');
});

test('placement-safety-P0C buildStagedPose derives an atomic identity pose from real case dimensions', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const stagingStart = src.indexOf('export function buildStagedPose(item)');
  const stagingEnd = src.indexOf('\nexport function createAutoPackEngine', stagingStart);
  const stagingBlock = stagingStart >= 0 && stagingEnd > stagingStart ? src.slice(stagingStart, stagingEnd) : '';

  assert.ok(stagingBlock.length > 0, 'buildStagedPose must be a module-scope exported helper');
  assert.doesNotMatch(stagingBlock, /item\.inst\.orientedDims/,
    'buildStagedPose must not read stale inst.orientedDims from a previous AutoPack run (RC-4)');
  assert.doesNotMatch(stagingBlock, /item\.orientations\[0\]/,
    'buildStagedPose must not use packing-policy orientation candidates');
  assert.match(stagingBlock, /item && item\.caseData && item\.caseData\.dimensions/,
    'buildStagedPose must use real base case dimensions');
  assert.match(stagingBlock, /rotation = \{ x: 0, y: 0, z: 0 \}/,
    'the staged pose must carry deterministic identity rotation');
  assert.match(stagingBlock, /getOrientedDimsForRotation\(base, rotation\)/,
    'the staged pose dimensions must be derived from that identity rotation');
});

test('placement-safety-P0C nextCases applies an atomic staged pose (rotation + orientedDims agree with position)', async () => {
  const src = await fs.readFile(autoPackEnginePath, 'utf8');
  const persistStart = src.indexOf('export function buildAutoPackNextCases(');
  const persistEnd = src.indexOf('\nexport function createAutoPackEngine', persistStart);
  const persistBlock = persistStart >= 0 && persistEnd > persistStart ? src.slice(persistStart, persistEnd) : '';

  // Staged items take the full pose (position + rotation + orientedDims) from the
  // staging map, so the three values describe the same orientation.
  assert.match(persistBlock, /const staged = stagingMap instanceof Map \? stagingMap\.get\(inst\.id\) : null;/,
    'unpacked items read the full staged pose from the staging map');
  assert.match(persistBlock, /pos = staged\.position;[\s\S]*rot = staged\.rotation[\s\S]*od = staged\.orientedDims/,
    'unpacked items apply staging position, rotation and orientedDims together (atomic)');
  // Packed items still take fresh solver dims; staged items persist identity
  // orientedDims explicitly so preview, commit and scene bounds use one pose.
  assert.match(persistBlock, /else if \(od\)[\s\S]*next\.orientedDims = od/,
    'identity staged orientation persists matching orientedDims');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy exported from pack-library', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  assert.strictEqual(typeof PackLibrary.isOrientationAllowedByCasePolicy, 'function',
    'isOrientationAllowedByCasePolicy must be exported from pack-library.js');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy blocks X-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: halfPI, y: 0, z: 0 }
  );
  assert.strictEqual(result, false,
    'upright-locked case must reject X-axis rotation (would tip on its side)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy blocks Z-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: 0, y: 0, z: halfPI }
  );
  assert.strictEqual(result, false,
    'upright-locked case must reject Z-axis rotation (would tip on its side)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy allows Y-rotation for upright-lock case', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  const result = PackLibrary.isOrientationAllowedByCasePolicy(
    { orientationLock: 'upright' },
    { x: 0, y: halfPI, z: 0 }
  );
  assert.strictEqual(result, true,
    'upright-locked case must allow Y-axis rotation (stays flat, just turns)');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy allows all rotations when lock is missing or "any"', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // No lock set — default 'any' — must not block TVs, mattresses, doors, flat panels
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: halfPI, y: 0, z: 0 }), true,
    'no-lock case must allow X rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: 0, y: halfPI, z: 0 }), true,
    'no-lock case must allow Y rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({}, { x: 0, y: 0, z: halfPI }), true,
    'no-lock case must allow Z rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'any' }, { x: halfPI, y: 0, z: 0 }), true,
    'explicit "any" lock must allow X rotation');
});

test('placement-safety-P1A isOrientationAllowedByCasePolicy handles onside and on-side consistently', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // 'onside' and 'on-side' must be treated identically
  // onside allows X/Z rotations but blocks Y-only (upright) orientation
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'onside' }, { x: halfPI, y: 0, z: 0 }), true,
    '"onside" must allow X rotation');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'on-side' }, { x: halfPI, y: 0, z: 0 }), true,
    '"on-side" must allow X rotation (normalized same as "onside")');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'onside' }, { x: 0, y: halfPI, z: 0 }), false,
    '"onside" must block pure Y rotation (upright orientation not allowed)');
  assert.strictEqual(PackLibrary.isOrientationAllowedByCasePolicy({ orientationLock: 'on-side' }, { x: 0, y: 0, z: 0 }), false,
    '"on-side" must block the neutral upright orientation');
});

test('placement-safety-P1A rotateSelection checks orientation policy before CaseScene.getObject mutation', async () => {
  const src = await fs.readFile(editorScreenPath, 'utf8');
  const fnStart = src.indexOf('function rotateSelection(axis, delta)');
  const fnEnd = src.indexOf('\n    /**', fnStart + 1);
  const fnBlock = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart, fnStart + 2000);

  assert.match(fnBlock, /isOrientationAllowedByCasePolicy/,
    'rotateSelection must call isOrientationAllowedByCasePolicy');
  assert.match(fnBlock, /policyBlockedCount\s*\+=\s*1/,
    'rotateSelection must track policy-blocked items separately from collision-blocked items');
  // Policy check must come before getObject so no scene mutation occurs for rejected items
  const policyPos = fnBlock.indexOf('isOrientationAllowedByCasePolicy');
  const getObjPos = fnBlock.indexOf('CaseScene.getObject(id)');
  assert.ok(policyPos >= 0 && getObjPos >= 0 && policyPos < getObjPos,
    'isOrientationAllowedByCasePolicy check must appear before CaseScene.getObject in rotateSelection');
  // Confirm policy-blocked path cannot reach PackLibrary.updateInstance
  // The early return exits the forEach callback before any scene writes
  assert.doesNotMatch(
    fnBlock.slice(policyPos, fnBlock.indexOf('return;', policyPos) + 7),
    /PackLibrary\.updateInstance/,
    'the policy-blocked early-return path must not call PackLibrary.updateInstance'
  );
});

test('placement-safety-euler-order getOrientedDimsForRotation single-axis Y unchanged', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // Y-only rotate swaps length↔width; height stays 30 — identical for any application order
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: 0, y: halfPI, z: 0 }
  );
  assert.deepEqual(result, { length: 24, width: 48, height: 30 },
    'Y-only rotation must swap length and width; height must be unchanged');
});

test('placement-safety-euler-order getOrientedDimsForRotation single-axis X unchanged', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // X-only rotate swaps width↔height; length stays 48 — identical for any application order
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: halfPI, y: 0, z: 0 }
  );
  assert.deepEqual(result, { length: 48, width: 30, height: 24 },
    'X-only rotation must swap width and height; length must be unchanged');
});

test('placement-safety-euler-order getOrientedDimsForRotation compound Y+Z truss must give correct height', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // A 120"×12"×12" truss standing upright (height=120) after Z-rotation then Y-rotation:
  // The long axis must end up in the Y-world direction (height 120) so settleY=60 (floor at y=0).
  // Old X→Y→Z order produced {length:12, height:12, width:120} → settleY=6 → visual bottom −54" below floor.
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 120, width: 12, height: 12 },
    { x: 0, y: halfPI, z: halfPI }
  );
  assert.deepEqual(result, { length: 12, height: 120, width: 12 },
    'compound Y+Z rotation must raise the 120" axis into the vertical (height) slot so settleY=60 keeps the case on the floor');
});

test('placement-safety-euler-order getOrientedDimsForRotation compound X+Z gives THREE.js-correct AABB', async () => {
  const PackLibrary = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const halfPI = Math.PI / 2;
  // Verified against THREE.js matrix Rx*Ry*Rz applied to each local axis vector:
  //   length {48,0,0} → Rz→Ry→Rx → {0,0,48}  (contributes z=48 → width)
  //   height {0,30,0} → Rz→Ry→Rx → {-30,0,0} (contributes x=30 → length)
  //   width  {0,0,24} → Rz→Ry→Rx → {0,-24,0} (contributes y=24 → height)
  // Old X→Y→Z order: {length:24, height:48, width:30} — wrong; height≠visual height
  const result = PackLibrary.getOrientedDimsForRotation(
    { length: 48, width: 24, height: 30 },
    { x: halfPI, y: 0, z: halfPI }
  );
  assert.deepEqual(result, { length: 30, height: 24, width: 48 },
    'compound X+Z rotation AABB must match THREE.js matrix Rx*Ry*Rz applied in Rz-first order');
});

test('AUTOPACK-MAX-A relaxes noStackOnTop and stackable:false only inside the Max solve', async () => {
  const { Solver, PackLib } = await p5Modules();
  const truck = { length: 48, width: 48, height: 24, shapeMode: 'rect' };
  const zones = PackLib.getTrailerUsableZones(truck);
  const items = ['a', 'b'].map(instanceId => ({
    instanceId,
    caseId: 'no-top',
    dims: { l: 48, w: 48, h: 12 },
    orientationLock: 'upright',
    canFlip: false,
    noStackOnTop: true,
    stackable: false,
    weight: 20,
  }));
  const normal = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items });
  const max = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items, maxCapacityMode: true });
  assert.equal(normal.placements.size, 1, 'normal solver preserves No top load');
  assert.equal(max.placements.size, 2, 'Max may use the otherwise forbidden support surface');
  assert.equal(max.phaseStats.stackCount, 1, 'the additional item is a real supported stack placement');
});

test('HANDLING-RULES-P0D legacy string-typed Case rules survive raw Storage.load() but are canonicalized by the same applyCanonicalCargoFields() step app.js now applies before publication', async () => {
  const Storage = await import(`${storagePath.href}?t=${Date.now()}-${Math.random()}`);
  const { applyCanonicalCargoFields } = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);
  const summaryPath = new URL('../../src/services/case-rule-summary.js', import.meta.url);
  const { getCaseHandlingSummary } = await import(`${summaryPath.href}?t=${Date.now()}-${Math.random()}`);

  const originalWindow = globalThis.window;
  const localStorage = handlingRulesP0dMemoryStorage();
  const legacyCase = {
    id: 'case-p0d-legacy',
    name: 'Legacy Case',
    manufacturer: 'QA',
    category: 'Default',
    dimensions: { length: 20, width: 10, height: 5 },
    weight: 12,
    createdAt: 100,
    updatedAt: 200,
    canFlip: 'false',
    stackable: 'false',
    noStackOnTop: 'true',
    isPallet: 'false',
    laneItem: 'false',
    someApprovedExtensionField: 'keep-me',
  };

  try {
    globalThis.window = { localStorage };
    Storage.setStorageScope('p0d-user');
    Storage.setWorkspaceScope('p0d-org');
    localStorage.setItem('truckPacker3d:v1:p0d-user', JSON.stringify({
      version: 'test',
      savedAt: 1,
      preferences: {},
    }));
    localStorage.setItem('truckPacker3d:v1:p0d-user:workspace:p0d-org', JSON.stringify({
      version: 'test',
      savedAt: 2,
      caseLibrary: [legacyCase],
      packLibrary: [],
      folderLibrary: [],
      currentPackId: null,
    }));

    const loaded = Storage.load();
    const rawCase = loaded.caseLibrary.find(c => c.id === 'case-p0d-legacy');
    assert.equal(typeof rawCase.stackable, 'string',
      'ordinary Storage.load() alone does not canonicalize Case rule types (this is the confirmed P0-D gap)');
    assert.equal(rawCase.stackable, 'false');

    // This is the exact transform app.js's seedIfEmpty()/loadScopedStateOrSeed()
    // now apply to stored.caseLibrary before it reaches placement repair/publication.
    const canonicalCases = loaded.caseLibrary.map(applyCanonicalCargoFields);
    const canon = canonicalCases.find(c => c.id === 'case-p0d-legacy');

    assert.equal(canon.canFlip, false);
    assert.equal(typeof canon.canFlip, 'boolean');
    assert.equal(canon.stackable, false);
    assert.equal(typeof canon.stackable, 'boolean');
    assert.equal(canon.noStackOnTop, true);
    assert.equal(typeof canon.noStackOnTop, 'boolean');
    assert.equal(canon.isPallet, false);
    assert.equal(typeof canon.isPallet, 'boolean');
    assert.equal(canon.laneItem, false);
    assert.equal(typeof canon.laneItem, 'boolean');

    assert.equal(canon.id, 'case-p0d-legacy', 'Case id must be unchanged');
    assert.equal(canon.name, 'Legacy Case', 'unrelated display fields must survive');
    assert.deepEqual(canon.dimensions, { length: 20, width: 10, height: 5 }, 'dimensions must be untouched');
    assert.equal(canon.weight, 12, 'weight must be untouched');
    assert.equal(canon.createdAt, 100, 'createdAt must be untouched');
    assert.equal(canon.someApprovedExtensionField, 'keep-me', 'safe extension metadata must survive');

    // Summary must now agree with what repair/AutoPack already treated as canonical.
    assert.deepEqual(getCaseHandlingSummary(rawCase), [],
      'the strict-equality summary reads the raw legacy string as "no restriction" — this is the divergence P0-D closes');
    assert.deepEqual(getCaseHandlingSummary(canon), ['No top load', 'Lane: Never'],
      'once canonicalized, the summary agrees with the canonical value repair/AutoPack use');
  } finally {
    Storage.setStorageScope('anon');
    Storage.setWorkspaceScope('no-org');
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('HANDLING-RULES-P0D restored placement repair must evaluate a legacy stackable:"false" support canonically and must not silently retain a child resting on it as packed', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const { applyCanonicalCargoFields } = await import(`${cargoCanonicalPath.href}?t=${Date.now()}-${Math.random()}`);

  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };
  // The base covers nearly the whole floor so, once its support is correctly
  // disqualified, there is no other legal floor spot for the child to repair
  // to — the outcome is deterministic (staged), not geometry-dependent.
  const rawBaseCase = makePackImportSafeCase({
    id: 'p0d-base-case',
    dimensions: { length: 100, width: 44, height: 10 },
    weight: 200,
    stackable: 'false', // legacy string, as Storage.load() would return it uncanonicalized
  });
  const childCase = makePackImportSafeCase({
    id: 'p0d-child-case',
    dimensions: { length: 10, width: 10, height: 10 },
    weight: 5,
  });
  const baseInst = makePackImportInstance('p0d-base-case', {
    id: 'p0d-base',
    transform: { position: { x: 60, y: 5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });
  const childInst = makePackImportInstance('p0d-child-case', {
    id: 'p0d-child',
    transform: { position: { x: 60, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    placement: 'packed',
  });
  const pack = { id: 'p0d-pack', truck, cases: [baseInst, childInst] };

  // Pre-fix contrast: feeding repair the raw, uncanonicalized rule value
  // reproduces the confirmed defect — the child is silently retained as packed
  // on a support whose rule says it must not carry anything.
  const preFixResult = PackLib.repairRestoredPackPlacements(pack, [rawBaseCase, childCase]);
  assert.equal(preFixResult.cases.find(c => c.id === 'p0d-child').placement, 'packed',
    'documents the confirmed P0-D defect: raw string "false" does not trip the strict stackable === false check');

  // Fixed pipeline: canonicalize before repair, exactly as app.js now does.
  const canonicalCases = [applyCanonicalCargoFields(rawBaseCase), childCase];
  const fixedResult = PackLib.repairRestoredPackPlacements(pack, canonicalCases);
  const repairedChild = fixedResult.cases.find(c => c.id === 'p0d-child');
  const repairedBase = fixedResult.cases.find(c => c.id === 'p0d-base');

  assert.notEqual(repairedChild.placement, 'packed',
    'restored placement repair must not silently accept a child resting on a canonically stackable:false support');
  assert.equal(repairedChild.placement, 'staged',
    'with no other legal floor space, the correctly-disqualified child must be staged');
  assert.equal(repairedBase.placement, 'packed',
    'the valid, unaffected support must not be moved or staged by this repair');
});

test('HANDLING-RULES-P0D both ordinary load entry points (seedIfEmpty and loadScopedStateOrSeed) canonicalize Case cargo rules before repair, not just initial boot', async () => {
  const appSrc = await fs.readFile(appPath, 'utf8');

  for (const fnName of ['seedIfEmpty', 'loadScopedStateOrSeed']) {
    const start = appSrc.indexOf(`function ${fnName}(`);
    assert.ok(start >= 0, `${fnName} must be extractable from app.js`);
    const repairCallIdx = appSrc.indexOf('repairRestoredPackPlacements', start);
    assert.ok(repairCallIdx > start, `${fnName} must call repairRestoredPackPlacements`);
    const body = appSrc.slice(start, repairCallIdx);
    assert.match(body, /\.map\(applyCanonicalCargoFields\)[\s\S]*\.map\(applyCaseDefaultColor\)/,
      `${fnName} must canonicalize Case cargo-rule fields (applyCanonicalCargoFields) before ` +
      'applyCaseDefaultColor and before placement repair, not just at initial application boot');
  }

  assert.match(appSrc, /import \{ applyCanonicalCargoFields \} from '\.\/core\/cargo-canonical\.js'/,
    'app.js must import the existing narrow cargo-rule canonicalizer, not reimplement it');
});

test('HANDLING-RULES-P0C isHeightAxisVertical direct truth table for the required single-axis right-angle cases', async () => {
  const { isHeightAxisVertical } = await import(`${orientedDimsPath.href}?t=${Date.now()}-${Math.random()}`);

  const cases = [
    ['IDENTITY', { x: 0, y: 0, z: 0 }, true],
    ['YAW 90', { x: 0, y: RIGHT_ANGLE, z: 0 }, true],
    ['YAW 180', { x: 0, y: Math.PI, z: 0 }, true],
    ['YAW 270', { x: 0, y: 3 * RIGHT_ANGLE, z: 0 }, true],
    ['X 90', { x: RIGHT_ANGLE, y: 0, z: 0 }, false],
    ['X 180', { x: Math.PI, y: 0, z: 0 }, true],
    ['X 270', { x: 3 * RIGHT_ANGLE, y: 0, z: 0 }, false],
    ['Z 90', { x: 0, y: 0, z: RIGHT_ANGLE }, false],
    ['Z 180', { x: 0, y: 0, z: Math.PI }, true],
    ['Z 270', { x: 0, y: 0, z: 3 * RIGHT_ANGLE }, false],
    // Representative compound right-angle rotations.
    ['X180+YAW90', { x: Math.PI, y: RIGHT_ANGLE, z: 0 }, true],
    ['X180+Z180', { x: Math.PI, y: 0, z: Math.PI }, true],
    ['X90+Z90', { x: RIGHT_ANGLE, y: 0, z: RIGHT_ANGLE }, false],
    ['X90+YAW180', { x: RIGHT_ANGLE, y: Math.PI, z: 0 }, false],
  ];

  for (const [label, rotation, expected] of cases) {
    assert.equal(isHeightAxisVertical(rotation), expected, `${label}: ${JSON.stringify(rotation)}`);
  }
});

test('HANDLING-RULES-P0C 64-combination right-angle matrix agrees with an independent THREE.js oracle for geometric verticality and both upright/onSide policy results', async () => {
  const THREE = await import(`${vendorThreePath.href}?t=${Date.now()}-${Math.random()}`);
  const { isHeightAxisVertical } = await import(`${orientedDimsPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  let checked = 0;
  const disagreementClassCovered = { xPiOnSideFalse: false, zPiUprightTrue: false };

  for (const x of RIGHT_ANGLES) {
    for (const y of RIGHT_ANGLES) {
      for (const z of RIGHT_ANGLES) {
        const rotation = { x, y, z };
        const expectedVertical = threeOracleHeightAxisVertical(THREE, x, y, z);

        assert.equal(isHeightAxisVertical(rotation), expectedVertical,
          `geometric classification disagrees with independent oracle at x=${x} y=${y} z=${z}`);

        const uprightAllowed = PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, rotation);
        const onSideAllowed = PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'onSide' }, rotation);
        assert.equal(uprightAllowed, expectedVertical,
          `upright policy disagrees with oracle at x=${x} y=${y} z=${z}`);
        assert.equal(onSideAllowed, !expectedVertical,
          `onSide policy disagrees with oracle at x=${x} y=${y} z=${z}`);

        if (x === Math.PI && y === 0 && z === 0) {
          assert.equal(onSideAllowed, false, 'the original confirmed defect: x=π must NOT be legal onSide');
          disagreementClassCovered.xPiOnSideFalse = true;
        }
        if (x === 0 && y === 0 && z === Math.PI) {
          assert.equal(uprightAllowed, true, 'the mirror confirmed defect: z=π must be legal upright');
          disagreementClassCovered.zPiUprightTrue = true;
        }

        checked += 1;
      }
    }
  }

  assert.equal(checked, 64, 'must cover all 4×4×4 right-angle combinations');
  assert.equal(disagreementClassCovered.xPiOnSideFalse, true, 'the x=π/onSide disagreement class must be exercised');
  assert.equal(disagreementClassCovered.zPiUprightTrue, true, 'the z=π/upright disagreement class must be exercised');
});

test('HANDLING-RULES-P0C required policy regressions A-F: the confirmed defects, their mirrors, genuine tips, any-policy, and canFlip independence', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);

  // A: onSide + x=π must REJECT (saved height axis remains vertical).
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'onSide' }, { x: Math.PI, y: 0, z: 0 }),
    false, 'A: onSide policy must reject x=π — the height axis is still vertical, merely inverted'
  );

  // B: upright + z=π must ACCEPT (saved height axis remains vertical).
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, { x: 0, y: 0, z: Math.PI }),
    true, 'B: upright policy must accept z=π — the height axis is still vertical, merely inverted'
  );

  // C: onSide + x=π/2 must ACCEPT (genuine tip).
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'onSide' }, { x: RIGHT_ANGLE, y: 0, z: 0 }),
    true, 'C: onSide policy must accept a genuine x=π/2 tip'
  );

  // D: upright + y=π/2 must ACCEPT (yaw never tips the height axis).
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, { x: 0, y: RIGHT_ANGLE, z: 0 }),
    true, 'D: upright policy must accept a pure yaw — it never tips the height axis'
  );

  // E: 'any' policy allows every right-angle pose regardless of upright/onSide classification.
  for (const x of RIGHT_ANGLES) {
    for (const y of RIGHT_ANGLES) {
      for (const z of RIGHT_ANGLES) {
        assert.equal(
          PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'any' }, { x, y, z }),
          true, `E: 'any' policy must allow x=${x} y=${y} z=${z}`
        );
      }
    }
  }

  // F: canFlip must not affect manual policy results (it is AutoPack-scoped only).
  for (const canFlip of [true, false]) {
    assert.equal(
      PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'onSide', canFlip }, { x: Math.PI, y: 0, z: 0 }),
      false, `F: canFlip=${canFlip} must not change the onSide/x=π rejection`
    );
    assert.equal(
      PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright', canFlip }, { x: 0, y: 0, z: Math.PI }),
      true, `F: canFlip=${canFlip} must not change the upright/z=π acceptance`
    );
  }
});

test('HANDLING-RULES-P0C manual revalidation rejects a packed onSide-policy instance at x=π through the real PackLibrary validation path', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };

  const caseData = handlingRulesP0cCase({ id: 'case-p0c-onside', orientationLock: 'onSide' });
  const inst = handlingRulesP0cInstance('inst-p0c-onside', 'case-p0c-onside', { x: Math.PI, y: 0, z: 0 });
  const pack = { id: 'pack-p0c-onside', truck, cases: [inst] };

  const result = PackLib.revalidateManualPlacements(pack, [caseData]);

  assert.deepEqual(result.invalidIds, ['inst-p0c-onside'],
    'reproduces the original defect through the real production path: x=π must be invalid under an onSide policy');
  assert.deepEqual(result.stagedIds, ['inst-p0c-onside'],
    'the existing invalid-placement handling behavior (staging) must still apply — no new behavior invented');
  const revalidated = result.pack.cases.find(c => c.id === 'inst-p0c-onside');
  assert.equal(revalidated.placement, 'staged');
});

test('HANDLING-RULES-P0C manual revalidation does not reject a packed upright-policy instance at z=π on orientation grounds', async () => {
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 120, width: 60, height: 60, shapeMode: 'rect' };

  const caseData = handlingRulesP0cCase({ id: 'case-p0c-upright', orientationLock: 'upright' });
  const inst = handlingRulesP0cInstance('inst-p0c-upright', 'case-p0c-upright', { x: 0, y: 0, z: Math.PI });
  const pack = { id: 'pack-p0c-upright', truck, cases: [inst] };

  const result = PackLib.revalidateManualPlacements(pack, [caseData]);

  assert.deepEqual(result.invalidIds, [],
    'the mirror defect fix: z=π must not be rejected by orientation policy under an upright lock');
  assert.deepEqual(result.stagedIds, []);
  const revalidated = result.pack.cases.find(c => c.id === 'inst-p0c-upright');
  assert.equal(revalidated.placement, 'packed', 'the valid pose must remain packed in place, untouched');
  assert.deepEqual(revalidated.transform.position, { x: 60, y: 5, z: 0 });
});

test('HANDLING-RULES-P0C isOrientationAllowedByCasePolicy delegates to the shared oriented-dims helper instead of reimplementing Euler-component checks', async () => {
  const src = await fs.readFile(packLibraryPath, 'utf8');
  const start = src.indexOf('export function isOrientationAllowedByCasePolicy(');
  assert.ok(start >= 0, 'isOrientationAllowedByCasePolicy must be extractable');
  const end = src.indexOf('\nfunction isFinitePositive(', start);
  const body = src.slice(start, end);

  assert.match(body, /isHeightAxisVertical\(rotation\)/,
    'the policy predicate must delegate to isHeightAxisVertical, not reimplement axis math');
  assert.doesNotMatch(body, /rx\s*===\s*0/,
    'the old raw Euler-component check (rx === 0) must be removed');
  assert.doesNotMatch(body, /rz\s*===\s*0/,
    'the old raw Euler-component check (rz === 0) must be removed');

  assert.match(src, /isHeightAxisVertical,?\s*\n?\s*\} from '\.\.\/core\/oriented-dims\.js'/,
    'isHeightAxisVertical must be imported from the existing rotation authority, not redefined locally');
});

test('HANDLING-RULES-P0B direct exact-lock matrix A-H against the real buildOrientationCandidates()', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 10, w: 20, h: 30 };
  const cand = (orientationLock, lockedRotation, canFlip) =>
    Solver.buildOrientationCandidates(dims, { orientationLock, orientationLocked: true, lockedRotation, canFlip });

  // A: upright + illegal tip -> no candidate.
  assert.deepEqual(cand('upright', { x: RIGHT_ANGLE, y: 0, z: 0 }), [],
    'A: upright policy + a tipped lock must yield no candidate');

  // B: upright + normal upright -> exactly one candidate, preserving lock/rotation/dims.
  let cs = cand('upright', { x: 0, y: 0, z: 0 });
  assert.equal(cs.length, 1, 'B: upright + identity lock must yield exactly one candidate');
  assert.equal(cs[0].locked, true, 'B: the candidate must be marked locked');
  assert.deepEqual(cs[0].rotation, { x: 0, y: 0, z: 0 }, 'B: rotation must be the normalized locked rotation');
  assert.deepEqual({ l: cs[0].l, w: cs[0].w, h: cs[0].h }, { l: 10, w: 20, h: 30 }, 'B: dims must match the unrotated case');

  // C: upright + inverted upright (x=π) -> exactly one candidate. Proves P0-B consumes P0-C.
  cs = cand('upright', { x: Math.PI, y: 0, z: 0 });
  assert.equal(cs.length, 1, 'C: upright + an inverted-but-vertical lock must still yield exactly one candidate');
  assert.equal(cs[0].locked, true);
  assert.deepEqual(cs[0].rotation, { x: Math.PI, y: 0, z: 0 });
  assert.deepEqual({ l: cs[0].l, w: cs[0].w, h: cs[0].h }, { l: 10, w: 20, h: 30 },
    'C: a 180° inversion about X leaves l/w/h magnitudes unchanged');

  // D: onSide + upright -> no candidate.
  assert.deepEqual(cand('onSide', { x: 0, y: 0, z: 0 }), [],
    'D: onSide policy + an upright lock must yield no candidate');

  // E: onSide + genuine side -> exactly one candidate.
  cs = cand('onSide', { x: RIGHT_ANGLE, y: 0, z: 0 });
  assert.equal(cs.length, 1, 'E: onSide + a genuine tip must yield exactly one candidate');
  assert.equal(cs[0].locked, true);
  assert.deepEqual(cs[0].rotation, { x: RIGHT_ANGLE, y: 0, z: 0 });

  // F: onSide + inverted vertical (x=π) -> no candidate (still vertical, so still illegal under onSide).
  assert.deepEqual(cand('onSide', { x: Math.PI, y: 0, z: 0 }), [],
    'F: onSide policy + an inverted-but-still-vertical lock must yield no candidate');

  // G: any + tipped + canFlip:false -> exactly one candidate. canFlip does not gate an explicit exact lock.
  cs = cand('any', { x: RIGHT_ANGLE, y: 0, z: 0 }, false);
  assert.equal(cs.length, 1, 'G: any policy + a tipped lock must yield exactly one candidate regardless of canFlip:false');
  assert.equal(cs[0].locked, true);
  assert.deepEqual(cs[0].rotation, { x: RIGHT_ANGLE, y: 0, z: 0 });

  // H: any + tipped + canFlip:true -> exactly one candidate, same as G.
  cs = cand('any', { x: RIGHT_ANGLE, y: 0, z: 0 }, true);
  assert.equal(cs.length, 1, 'H: any policy + a tipped lock must yield exactly one candidate regardless of canFlip:true');
  assert.equal(cs[0].locked, true);
  assert.deepEqual(cs[0].rotation, { x: RIGHT_ANGLE, y: 0, z: 0 });
});

test('HANDLING-RULES-P0B solver integration: AutoPack must not place an item using a case-policy-illegal exact lock, and must place a legal one normally', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const truck = { length: 240, width: 96, height: 96 };
  const zones = PackLib.getTrailerUsableZones(truck);
  const dims = { l: 20, w: 10, h: 5 };

  // Before P0-B this illegal tipped lock would pack. It must now be treated as
  // having no legal orientation candidate — the existing unresolved/partial
  // result behavior applies, with no new rejection UI invented.
  const illegalItem = {
    instanceId: 'illegal-lock', caseId: 'c', dims,
    orientationLock: 'upright', canFlip: false,
    orientationLocked: true, lockedRotation: { x: RIGHT_ANGLE, y: 0, z: 0 },
  };
  const illegalResult = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [illegalItem] });
  assert.equal(illegalResult.placements.has('illegal-lock'), false,
    'AutoPack must not place an item using an illegal exact lock');
  assert.ok(illegalResult.unpacked.includes('illegal-lock'),
    'the item must follow the existing unpacked/partial-result behavior');
  assert.equal(illegalResult.solveStatus.complete, false, 'the solve must be reported incomplete, not silently successful');

  // Control: same geometry, a legal exact upright lock — must pack normally.
  const legalItem = {
    instanceId: 'legal-lock', caseId: 'c', dims,
    orientationLock: 'upright', canFlip: false,
    orientationLocked: true, lockedRotation: { x: 0, y: 0, z: 0 },
  };
  const legalResult = Solver.solveAutoPack({ truck, zones, loadFrontFirst: true, items: [legalItem] });
  assert.equal(legalResult.placements.has('legal-lock'), true,
    'AutoPack must place an item using a case-policy-legal exact lock, geometry otherwise allowing');
  assert.deepEqual(legalResult.orientedDims.get('legal-lock'), { length: 20, width: 10, height: 5 });
  assert.equal(legalResult.solveStatus.complete, true);
});

test('HANDLING-RULES-P0B manual validation and AutoPack now agree on the same stale-lock pose, and on its legal inverted-upright control', async () => {
  const Solver = await import(`${autoPackSolverPath.href}?t=${Date.now()}-${Math.random()}`);
  const PackLib = await import(`${packLibraryPath.href}?t=${Date.now()}-${Math.random()}`);
  const dims = { l: 10, w: 20, h: 30 };

  // The original confirmed disagreement: upright policy + a tipped rotation.
  const tippedRot = { x: RIGHT_ANGLE, y: 0, z: 0 };
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, tippedRot),
    false, 'manual policy: upright rejects a tipped rotation'
  );
  assert.deepEqual(
    Solver.buildOrientationCandidates(dims, { orientationLock: 'upright', orientationLocked: true, lockedRotation: tippedRot }),
    [], 'AutoPack: upright + the identical tipped exact lock must now also yield no candidate'
  );

  // Legal inverted-upright control: both paths must agree it is allowed.
  const invertedRot = { x: Math.PI, y: 0, z: 0 };
  assert.equal(
    PackLib.isOrientationAllowedByCasePolicy({ orientationLock: 'upright' }, invertedRot),
    true, 'manual policy: upright accepts an inverted-but-vertical rotation'
  );
  const invertedCands = Solver.buildOrientationCandidates(dims,
    { orientationLock: 'upright', orientationLocked: true, lockedRotation: invertedRot });
  assert.equal(invertedCands.length, 1, 'AutoPack: upright + the identical inverted-upright exact lock must yield one candidate');
  assert.equal(invertedCands[0].locked, true);
});

test('HANDLING-RULES-P0B canFlip is not part of the exact-lock policy gate, and unlocked candidate generation is untouched', async () => {
  const src = await fs.readFile(autoPackSolverPath, 'utf8');
  const start = src.indexOf('export function buildOrientationCandidates(');
  assert.ok(start >= 0, 'buildOrientationCandidates must be extractable');
  const lockedBranchEnd = src.indexOf('\n  const canFlip = item.canFlip === true;', start);
  assert.ok(lockedBranchEnd > start, 'the locked branch must be extractable');
  const lockedBranch = src.slice(start, lockedBranchEnd);

  assert.doesNotMatch(lockedBranch, /item\.canFlip/,
    'the exact-lock branch must not read item.canFlip — it only gates AutoPack-generated alternatives, not an explicit exact lock');
  assert.match(lockedBranch, /isHeightAxisVertical\(lockedRotation\)/,
    'the exact-lock branch must delegate to the shared P0-C geometric helper');
  assert.match(lockedBranch, /canonicalOrientationLock\(item\.orientationLock\)/,
    'the exact-lock branch must use the canonical policy-value authority');

  // The unlocked candidate-generation body (after the locked branch) must be
  // byte-identical to before P0-B — this diff only touches the locked branch.
  const unlockedBody = src.slice(lockedBranchEnd, src.indexOf('\n  return candidates;\n}', lockedBranchEnd));
  assert.match(unlockedBody, /if \(lock === 'upright' \|\| lock === 'any'\) \{\s*\n\s*add\(0, 0, 0\);\s*\n\s*add\(0, RIGHT_ANGLE_RAD, 0\);/,
    'unlocked upright/any candidate generation must be unchanged');
  assert.match(unlockedBody, /if \(lock === 'onSide'\) \{\s*\n\s*add\(0, 0, RIGHT_ANGLE_RAD\);\s*\n\s*add\(RIGHT_ANGLE_RAD, 0, RIGHT_ANGLE_RAD\);/,
    'unlocked onSide candidate generation must be unchanged');
  assert.match(unlockedBody, /if \(canFlip && lock === 'any'\) \{/,
    'canFlip-gated tipped-face generation for unlocked items must be unchanged');
});
