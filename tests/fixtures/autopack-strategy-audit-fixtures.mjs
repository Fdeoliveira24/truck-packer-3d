const STANDARD_TRUCK = Object.freeze({
  length: 120,
  width: 60,
  height: 60,
  shapeMode: 'rect',
});

// Isolated equivalent of the approved Test-01 diagnostic population. Only the
// eight physical Case definitions and quantities are retained; no user ids,
// workspace state or saved poses are needed for this whole-pack solve.
export function createC5MixedLoadFixture(shapeMode = 'rect') {
  const specifications = [
    ['priority', 83, 47, 26.13, 26.36, 52.91, 'upright', { loadPriority: 1 }],
    ['side-a', 47, 30, 20, 10, 25, 'onSide', {}],
    ['side-b', 37, 30, 20, 10, 25, 'onSide', {}],
    ['side-c', 32, 30, 20, 10, 25, 'onSide', {}],
    ['cube', 16, 20, 20, 20, 28, 'any', {}],
    ['lane', 4, 60, 20, 20, 90, 'onSide', { maxStackCount: 1, laneItem: true }],
    ['base', 7, 48, 40, 12, 120, 'any', { maxStackCount: 1 }],
    ['no-top', 8, 48, 24, 24, 20, 'any', { noStackOnTop: true }],
  ];
  const caseLibrary = specifications.map(([id, , length, width, height, weight, orientationLock, rules]) => ({
    id, name: id, dimensions: { length, width, height }, weight, orientationLock,
    shape: 'box', stackable: true, noStackOnTop: false, maxStackCount: 0,
    isPallet: false, maxPalletWeight: 0, laneItem: false, loadPriority: 0, ...rules,
  }));
  // Preserve source order and anonymous id ordering because both break solver
  // ties. Each pair is Case index : lexicographic instance rank in the snapshot.
  const population = `
0:193 0:57 0:86 0:136 0:81 0:180 0:21 1:64 1:79 1:182 1:65 1:150 1:50 1:59 1:223 1:229 1:206 2:123 2:20 2:129 2:2 2:112 2:107 2:49 2:99 2:106
3:117 3:201 3:197 3:196 3:200 3:203 3:188 3:93 4:174 4:158 4:41 4:147 0:194 5:228 6:66 6:177 0:0 7:9 7:90 1:209 0:121 0:22 0:143 0:134 0:8 0:101
0:145 0:166 0:156 0:185 0:124 0:102 0:155 0:46 0:183 0:104 0:165 1:181 1:75 1:116 1:103 1:160 1:184 1:97 1:215 1:192 1:114 2:141 2:210 2:48 2:211 2:140
2:225 2:216 2:96 2:205 3:109 3:74 3:33 3:149 3:218 3:122 3:189 3:231 4:153 4:119 4:98 4:39 0:170 5:82 6:12 0:89 7:38 7:27 1:37 0:219 0:148 0:187
0:232 0:17 0:71 0:15 0:152 0:131 0:135 0:26 0:23 0:227 0:125 0:54 0:63 0:91 0:190 0:95 1:108 1:162 1:51 1:154 1:31 1:168 1:217 1:10 1:221 1:224
2:76 2:110 2:68 2:113 2:178 2:157 2:94 2:13 2:24 3:36 3:195 3:73 3:142 3:144 3:199 3:3 3:100 4:226 4:19 4:84 4:55 0:32 5:176 6:69 6:133 0:173
7:146 7:212 1:171 0:208 0:58 0:138 0:4 0:130 0:11 0:161 0:175 0:111 0:118 0:87 0:35 0:45 0:85 0:179 0:47 0:213 0:77 0:202 1:6 1:61 1:137 1:25
1:214 1:14 1:164 1:60 1:70 1:172 2:1 2:151 2:52 2:42 2:7 2:169 2:220 2:34 2:62 3:230 3:105 3:67 3:18 3:72 3:83 3:186 3:163 4:44 4:127 4:28
4:115 0:132 5:198 6:43 6:126 0:80 7:233 7:88 1:5 0:16 0:56 0:207 0:167 0:29 0:222 0:191 0:120 0:139 0:204 0:78 1:53 0:40 0:30 1:159 2:128 1:92`;
  const cases = population.trim().split(/\s+/).map((pair, index) => {
    const [group, rank] = pair.split(':').map(Number);
    const lockedRotation = [43, 98, 156, 214].includes(index)
      ? { x: Math.PI * 1.5, y: Math.PI * 1.5, z: Math.PI }
      : index === 137 ? { x: Math.PI, y: Math.PI / 2, z: Math.PI / 2 } : null;
    return { id: `item-${String(rank).padStart(3, '0')}`, caseId: specifications[group][0], hidden: false, placement: 'staged',
      ...(lockedRotation && { orientationLocked: true, lockedRotation }),
      transform: { position: { x: -40 - index * 65, y: 30, z: group * 50 },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } };
  });
  return { caseLibrary, pack: { id: 'c5-mixed', name: 'Mixed load', lastEdited: 123,
    truck: { length: 636, width: 102, height: 98, shapeMode,
      shapeConfig: { wellHeight: 34.3, wellWidth: 15.299999999999999, wellLength: 222.6,
        wellOffsetFromRear: 159, bonusLength: 76, bonusWidth: 102, bonusHeight: 44 } }, cases } };
}

function caseSpec(id, name, dimensions, count, rules = {}) {
  return { id, name, dimensions, count, ...rules };
}

function expandCases(fixtureId, cases) {
  const items = [];
  const caseLibrary = [];
  for (const entry of cases) {
    const { count, dimensions, ...caseData } = entry;
    const normalizedCase = {
      ...caseData,
      dimensions: { ...dimensions },
      volume: dimensions.length * dimensions.width * dimensions.height,
    };
    caseLibrary.push(normalizedCase);
    for (let index = 0; index < count; index += 1) {
      items.push({
        instanceId: `${fixtureId}:${entry.id}:${String(index + 1).padStart(3, '0')}`,
        caseId: entry.id,
        dims: {
          l: dimensions.length,
          w: dimensions.width,
          h: dimensions.height,
        },
        shape: entry.shape || 'box',
        weight: Number(entry.weight) || 0,
        orientationLock: entry.orientationLock || 'any',
        canFlip: entry.canFlip === true,
        noStackOnTop: entry.noStackOnTop === true,
        stackable: entry.stackable !== false,
        maxStackCount: Number(entry.maxStackCount) || 0,
        isPallet: entry.isPallet === true,
        laneItem: entry.laneItem === true,
        loadPriority: Number(entry.loadPriority) || 0,
        orientationLocked: entry.orientationLocked === true,
        lockedRotation: entry.lockedRotation ? { ...entry.lockedRotation } : undefined,
      });
    }
  }
  return { items, caseLibrary };
}

function fixture(id, purpose, truck, cases, options = {}) {
  const expanded = expandCases(id, cases);
  return {
    id,
    purpose,
    truck: { ...truck, shapeConfig: truck.shapeConfig ? { ...truck.shapeConfig } : undefined },
    cases: cases.map(entry => ({
      ...entry,
      dimensions: { ...entry.dimensions },
      lockedRotation: entry.lockedRotation ? { ...entry.lockedRotation } : undefined,
    })),
    inputOptions: { loadFrontFirst: true, ...options },
    ...expanded,
  };
}

/**
 * Rebuilds every audit fixture from literals. No fixture is shared between runs,
 * and there is no random or clock-derived input.
 */
export function createAutoPackStrategyAuditFixtures() {
  return [
    fixture(
      'control-one-item',
      'Intentional convergence control: every strategy should return one identical placement.',
      STANDARD_TRUCK,
      [
        caseSpec('control-carton', 'Control carton', { length: 20, width: 20, height: 20 }, 1, {
          weight: 10,
          orientationLock: 'upright',
        }),
      ]
    ),
    fixture(
      'floor-fit-convergence',
      'All requested cartons fit on the floor; Floor first should not be penalized.',
      STANDARD_TRUCK,
      [
        caseSpec('floor-carton', 'Floor-fit carton', { length: 30, width: 20, height: 18 }, 10, {
          weight: 14,
          orientationLock: 'upright',
        }),
      ]
    ),
    fixture(
      'layout-quality-yaw-control',
      'Seven cartons stay below the repeated-grid threshold; Balanced should unify Wheel Wells floor yaw while Compact may mix orientations.',
      { length: 240, width: 96, height: 96, shapeMode: 'wheelWells' },
      [
        caseSpec('yaw-carton', 'Layout-quality carton', { length: 24, width: 18, height: 16 }, 7, {
          weight: 18,
          orientationLock: 'upright',
          maxStackCount: 2,
        }),
      ]
    ),
    fixture(
      'identical-over-demand',
      'Repeated identical cartons exceed one floor layer and exercise stacking and capacity limits.',
      STANDARD_TRUCK,
      [
        caseSpec('repeat-carton', 'Repeated carton', { length: 24, width: 20, height: 15 }, 80, {
          weight: 18,
          orientationLock: 'upright',
          maxStackCount: 3,
        }),
      ]
    ),
    fixture(
      'mixed-sku-fragmentation',
      'Realistic mixed cartons expose ordering, residual-space use, and orientation differences.',
      STANDARD_TRUCK,
      [
        caseSpec('large-crate', 'Large crate', { length: 40, width: 30, height: 24 }, 8, {
          weight: 80,
          orientationLock: 'upright',
          maxStackCount: 1,
        }),
        caseSpec('medium-carton', 'Medium carton', { length: 30, width: 20, height: 15 }, 18, {
          weight: 24,
          orientationLock: 'upright',
        }),
        caseSpec('small-carton', 'Small carton', { length: 15, width: 12, height: 10 }, 30, {
          weight: 8,
          orientationLock: 'any',
          canFlip: true,
        }),
      ]
    ),
    fixture(
      'compact-fill-pressure',
      'Residual widths make waste-first Compact fill compete with layout-quality row scoring.',
      { ...STANDARD_TRUCK, length: 114, width: 58 },
      [
        caseSpec('wide-carton', 'Wide carton', { length: 32, width: 23, height: 18 }, 14, {
          weight: 26,
          orientationLock: 'upright',
        }),
        caseSpec('gap-carton', 'Gap carton', { length: 19, width: 12, height: 14 }, 24, {
          weight: 11,
          orientationLock: 'upright',
        }),
      ]
    ),
    fixture(
      'stack-pressure',
      'A small floor and generous height make early safe stacking materially relevant.',
      { ...STANDARD_TRUCK, length: 84, width: 48, height: 72 },
      [
        caseSpec('stack-carton', 'Stackable carton', { length: 28, width: 24, height: 12 }, 54, {
          weight: 20,
          orientationLock: 'upright',
          maxStackCount: 4,
        }),
      ]
    ),
    fixture(
      'fragile-no-stack',
      'No-stack handling preferences should constrain normal strategies and distinguish Max Capacity.',
      { ...STANDARD_TRUCK, length: 96, width: 48, height: 60 },
      [
        caseSpec('fragile-carton', 'Fragile no-stack carton', { length: 24, width: 24, height: 15 }, 32, {
          weight: 16,
          orientationLock: 'upright',
          noStackOnTop: true,
          stackable: false,
        }),
      ]
    ),
    fixture(
      'orientation-locked-tight',
      'Locked tall poses do not fit while a tipped pose does; Max Capacity must remain isolated and explicit.',
      { ...STANDARD_TRUCK, length: 90, width: 48, height: 32 },
      [
        caseSpec('locked-cabinet', 'Locked upright cabinet', { length: 30, width: 18, height: 40 }, 12, {
          weight: 45,
          orientationLock: 'upright',
          orientationLocked: true,
          lockedRotation: { x: 0, y: 0, z: 0 },
        }),
      ]
    ),
    fixture(
      'heavy-on-light',
      'Mixed weights expose the normal child-versus-support rule and Max Capacity weight neutralization.',
      { ...STANDARD_TRUCK, length: 84, width: 48, height: 60 },
      [
        caseSpec('light-base', 'Light carton', { length: 28, width: 24, height: 15 }, 12, {
          weight: 10,
          orientationLock: 'upright',
        }),
        caseSpec('heavy-top', 'Heavy carton', { length: 28, width: 24, height: 15 }, 24, {
          weight: 70,
          orientationLock: 'upright',
          loadPriority: 5,
        }),
      ]
    ),
    fixture(
      'lane-priority-conflict',
      'Lane and load-priority preferences compete with deterministic physical density.',
      { ...STANDARD_TRUCK, length: 108, width: 54 },
      [
        caseSpec('lane-case', 'Lane cargo', { length: 36, width: 18, height: 18 }, 12, {
          weight: 35,
          laneItem: true,
          loadPriority: 10,
          orientationLock: 'upright',
        }),
        caseSpec('regular-case', 'Regular cargo', { length: 27, width: 18, height: 18 }, 24, {
          weight: 22,
          orientationLock: 'upright',
        }),
      ]
    ),
    fixture(
      'tall-narrow-mix',
      'Tall narrow pieces and short boxes exercise permitted face changes and support depth.',
      { ...STANDARD_TRUCK, length: 102, width: 54, height: 66 },
      [
        caseSpec('tall-piece', 'Tall narrow piece', { length: 18, width: 12, height: 42 }, 16, {
          weight: 28,
          orientationLock: 'any',
          canFlip: true,
        }),
        caseSpec('short-box', 'Short box', { length: 24, width: 18, height: 12 }, 24, {
          weight: 18,
          orientationLock: 'upright',
        }),
      ]
    ),
    fixture(
      'wheel-wells-channel-shelf',
      'Narrow center channel and raised shelves make Constrained space first semantically eligible.',
      {
        length: 120,
        width: 60,
        height: 60,
        shapeMode: 'wheelWells',
        shapeConfig: { wellHeight: 16, wellWidth: 12, wellLength: 48, wellOffsetFromRear: 36 },
      },
      [
        caseSpec('channel-carton', 'Channel carton', { length: 18, width: 12, height: 16 }, 28, {
          weight: 16,
          orientationLock: 'upright',
        }),
        caseSpec('shelf-carton', 'Shelf carton', { length: 24, width: 12, height: 16 }, 24, {
          weight: 20,
          orientationLock: 'upright',
        }),
        caseSpec('wide-carton', 'Wide carton', { length: 30, width: 24, height: 16 }, 16, {
          weight: 34,
          orientationLock: 'upright',
        }),
      ],
      { enableWheelWellBridge: true }
    ),
    fixture(
      'front-overhang-retention',
      'Raised overhang use is legal only after the rear-retention contract is satisfied.',
      {
        length: 96,
        width: 48,
        height: 60,
        shapeMode: 'frontBonus',
        shapeConfig: { bonusLength: 30, bonusHeight: 24 },
      },
      [
        caseSpec('retainer-carton', 'Retention-wall carton', { length: 12, width: 24, height: 24 }, 16, {
          weight: 28,
          orientationLock: 'upright',
        }),
        caseSpec('deck-carton', 'Overhang deck carton', { length: 15, width: 12, height: 12 }, 24, {
          weight: 12,
          orientationLock: 'upright',
        }),
        caseSpec('main-carton', 'Main floor carton', { length: 24, width: 24, height: 18 }, 16, {
          weight: 30,
          orientationLock: 'upright',
        }),
      ],
      { enableDeckRetentionWall: true }
    ),
    fixture(
      'zero-pack-oversize',
      'Intentional zero-result control: no strategy can fit the oversize case under physical hard rules.',
      { ...STANDARD_TRUCK, length: 72, width: 48, height: 48 },
      [
        caseSpec('oversize-machine', 'Oversize machine', { length: 90, width: 70, height: 60 }, 3, {
          weight: 500,
          orientationLock: 'any',
          canFlip: true,
        }),
      ]
    ),
  ];
}
