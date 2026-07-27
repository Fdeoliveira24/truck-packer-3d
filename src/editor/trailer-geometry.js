/**
 * @file trailer-geometry.js
 * @description Trailer usable/blocked zone geometry in inch space, plus world-space conversion helpers.
 * @module editor/trailer-geometry
 * @created 07/23/2026
 * @author Truck Packer 3D Team
 */

// Trailer geometry (extracted from src/app.js; behavior preserved).
// Side-effect-free factory: Utils, CorePackLibrary, and the late-bound
// SceneManager accessor are injected because SceneManager is constructed
// after this object exists and is only dereferenced at call time.

export function createTrailerGeometry({
  Utils,
  CorePackLibrary,
  getSceneManager,
}) {
  const TrailerGeometry = (() => {
    function getDims(truck) {
      const t = truck && typeof truck === 'object' ? truck : {};
      const length = Math.max(0, Number(t.length) || 0);
      const width = Math.max(0, Number(t.width) || 0);
      const height = Math.max(0, Number(t.height) || 0);
      return { length, width, height };
    }

    function getMode(truck) {
      const mode = truck && truck.shapeMode;
      if (mode === 'wheelWells' || mode === 'frontBonus' || mode === 'rect') return mode;
      return 'rect';
    }

    function getConfig(truck) {
      const cfg = truck && truck.shapeConfig;
      return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
    }

    function zone(min, max) {
      return { min: { ...min }, max: { ...max } };
    }

    function sanitizeZones(zones) {
      const EPS = 1e-9;
      return (zones || []).filter(z => {
        const dx = z.max.x - z.min.x;
        const dy = z.max.y - z.min.y;
        const dz = z.max.z - z.min.z;
        return dx > EPS && dy > EPS && dz > EPS;
      });
    }

    function getTrailerUsableZones(truck) {
      const { length: L, width: W, height: H } = getDims(truck);
      const mode = getMode(truck);
      const cfg = getConfig(truck);

      if (!L || !W || !H) return [];

      if (mode === 'frontBonus') {
        const bonusLengthRaw = Number(cfg.bonusLength);
        const bonusHeightRaw = Number(cfg.bonusHeight);

        const bonusLength = Math.max(0, Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0);
        const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : 0.45 * H, 0, H);

        // Raised over-cab deck: flush with the main box's ceiling, full
        // trailer width, starting at y = bonusHeight (the deck height /
        // cab clearance measured from the main floor). The "cab void"
        // below it (x > L, y < bonusHeight) is intentionally not part of
        // any usable zone - see getFrontBonusBlockedZones().
        const zones = [
          zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
          zone({ x: L, y: bonusHeight, z: -W / 2 }, { x: L + bonusLength, y: H, z: W / 2 }),
        ];
        return sanitizeZones(zones);
      }

      if (mode === 'wheelWells') {
        const wellHeightRaw = Number(cfg.wellHeight);
        const wellWidthRaw = Number(cfg.wellWidth);
        const wellLengthRaw = Number(cfg.wellLength);
        const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

        const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
        const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
        const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
        const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

        const wx0 = wellOffsetFromRear;
        const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
        const betweenHalfW = Math.max(0, W / 2 - wellWidth);

        const zones = [
          // 1) rear full-width
          zone({ x: 0, y: 0, z: -W / 2 }, { x: wx0, y: H, z: W / 2 }),

          // 2) center corridor between wells (full height)
          zone({ x: wx0, y: 0, z: -betweenHalfW }, { x: wx1, y: H, z: betweenHalfW }),

          // 3) left above-well
          zone({ x: wx0, y: wellHeight, z: -W / 2 }, { x: wx1, y: H, z: -betweenHalfW }),

          // 4) right above-well
          zone({ x: wx0, y: wellHeight, z: betweenHalfW }, { x: wx1, y: H, z: W / 2 }),

          // 5) front full-width
          zone({ x: wx1, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 }),
        ];
        return sanitizeZones(zones);
      }

      // rect (default)
      return [zone({ x: 0, y: 0, z: -W / 2 }, { x: L, y: H, z: W / 2 })];
    }

    function getTrailerCapacityInches3(truck) {
      const zones = getTrailerUsableZones(truck);
      return zones.reduce((sum, z) => {
        const dx = z.max.x - z.min.x;
        const dy = z.max.y - z.min.y;
        const dz = z.max.z - z.min.z;
        return sum + Math.max(0, dx) * Math.max(0, dy) * Math.max(0, dz);
      }, 0);
    }

    function isAabbContainedInAnyZone(aabb, zones) {
      // Inch-space containment only; callers must pass inch-space AABBs and zones.
      const EPS = CorePackLibrary.CONTAINMENT_EPS_INCHES;
      for (const z of zones || []) {
        if (
          aabb.min.x >= z.min.x - EPS &&
          aabb.max.x <= z.max.x + EPS &&
          aabb.min.y >= z.min.y - EPS &&
          aabb.max.y <= z.max.y + EPS &&
          aabb.min.z >= z.min.z - EPS &&
          aabb.max.z <= z.max.z + EPS
        ) {
          return true;
        }
      }
      return false;
    }

    function zonesInchesToWorld(zonesInches) {
      const SceneManager = getSceneManager();
      return (zonesInches || []).map(z => ({
        min: {
          x: SceneManager.toWorld(z.min.x),
          y: SceneManager.toWorld(z.min.y),
          z: SceneManager.toWorld(z.min.z),
        },
        max: {
          x: SceneManager.toWorld(z.max.x),
          y: SceneManager.toWorld(z.max.y),
          z: SceneManager.toWorld(z.max.z),
        },
      }));
    }

    function zonesToSpacesInches(zonesInches) {
      return (zonesInches || []).map(z => ({
        x: z.min.x,
        y: z.min.y,
        z: z.min.z,
        length: z.max.x - z.min.x,
        width: z.max.z - z.min.z,
        height: z.max.y - z.min.y,
      }));
    }

    function getWheelWellsBlockedZones(truck) {
      const { length: L, width: W, height: H } = getDims(truck);
      const mode = getMode(truck);
      const cfg = getConfig(truck);
      if (mode !== 'wheelWells') return [];
      if (!L || !W || !H) return [];

      const wellHeightRaw = Number(cfg.wellHeight);
      const wellWidthRaw = Number(cfg.wellWidth);
      const wellLengthRaw = Number(cfg.wellLength);
      const wellOffsetRaw = Number(cfg.wellOffsetFromRear);

      const wellHeight = Utils.clamp(Number.isFinite(wellHeightRaw) ? wellHeightRaw : 0.35 * H, 0, H);
      const wellWidth = Utils.clamp(Number.isFinite(wellWidthRaw) ? wellWidthRaw : 0.15 * W, 0, W / 2);
      const wellLength = Utils.clamp(Number.isFinite(wellLengthRaw) ? wellLengthRaw : 0.35 * L, 0, L);
      const wellOffsetFromRear = Utils.clamp(Number.isFinite(wellOffsetRaw) ? wellOffsetRaw : 0.25 * L, 0, L);

      const wx0 = wellOffsetFromRear;
      const wx1 = Utils.clamp(wx0 + wellLength, wx0, L);
      const betweenHalfW = Math.max(0, W / 2 - wellWidth);

      const zones = [
        // Left wheel well (blocked)
        zone({ x: wx0, y: 0, z: -W / 2 }, { x: wx1, y: wellHeight, z: -betweenHalfW }),

        // Right wheel well (blocked)
        zone({ x: wx0, y: 0, z: betweenHalfW }, { x: wx1, y: wellHeight, z: W / 2 }),
      ];
      return sanitizeZones(zones);
    }

    // G2.2: getFrontBonusZone() returns the raised over-cab deck zone
    // (x: truck.length..truck.length+bonusLength, y: bonusHeight..
    // truck.height, full trailer width), matching the
    // getTrailerUsableZones() overhang zone. bonusHeight is the deck
    // height / cab clearance measured from the main floor. This is a
    // visual-only helper: it is used by scene-runtime to render the
    // overhang as a real attached volume flush with the main box's
    // ceiling, not a floor-level carve-out of the main box.
    function getFrontBonusZone(truck) {
      const { length: L, width: W, height: H } = getDims(truck);
      const mode = getMode(truck);
      const cfg = getConfig(truck);
      if (mode !== 'frontBonus') return null;
      if (!L || !W || !H) return null;

      const bonusLengthRaw = Number(cfg.bonusLength);
      const bonusHeightRaw = Number(cfg.bonusHeight);

      const bonusLength = Math.max(0, Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0);
      const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : 0.45 * H, 0, H);

      const zones = [zone({ x: L, y: bonusHeight, z: -W / 2 }, { x: L + bonusLength, y: H, z: W / 2 })];
      return sanitizeZones(zones)[0] || null;
    }

    // G2.2: getFrontBonusBlockedZones() returns the "cab void" beneath the
    // raised over-cab deck (x: truck.length..truck.length+bonusLength,
    // y: 0..bonusHeight, full trailer width). This space is structurally
    // occupied by the cab and is never part of a usable zone - mirrors
    // getWheelWellsBlockedZones() so visuals/tests/warning logic can treat
    // it the same way as a blocked wheel-well volume.
    function getFrontBonusBlockedZones(truck) {
      const { length: L, width: W, height: H } = getDims(truck);
      const mode = getMode(truck);
      const cfg = getConfig(truck);
      if (mode !== 'frontBonus') return [];
      if (!L || !W || !H) return [];

      const bonusLengthRaw = Number(cfg.bonusLength);
      const bonusHeightRaw = Number(cfg.bonusHeight);

      const bonusLength = Math.max(0, Number.isFinite(bonusLengthRaw) ? bonusLengthRaw : 0);
      const bonusHeight = Utils.clamp(Number.isFinite(bonusHeightRaw) ? bonusHeightRaw : 0.45 * H, 0, H);

      const zones = [zone({ x: L, y: 0, z: -W / 2 }, { x: L + bonusLength, y: bonusHeight, z: W / 2 })];
      return sanitizeZones(zones);
    }

    return {
      getTrailerUsableZones,
      getTrailerCapacityInches3,
      isAabbContainedInAnyZone,
      zonesInchesToWorld,
      zonesToSpacesInches,
      getWheelWellsBlockedZones,
      getFrontBonusZone,
      getFrontBonusBlockedZones,
    };
  })();

  return TrailerGeometry;
}
