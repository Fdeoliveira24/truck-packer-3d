const STANDARD_TRUCK = Object.freeze({
  length: 120,
  width: 60,
  height: 60,
  shapeMode: 'rect',
});

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
