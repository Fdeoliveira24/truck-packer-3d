/**
 * @file repair.js
 * @description Local re-settle of dependent placements after a destructive edit.
 *
 * When deleting one case invalidates nearby dependents (their support changed,
 * or their pose is no longer legal), the product contract is: try to keep them
 * INSIDE the truck with a small local repair before ever staging them —
 * removing one box must not eject half the load. This module owns that repair
 * algorithm; it never touches state and never rearranges valid placements.
 *
 * Repair order per affected case (bottom-up, deterministic):
 *   1. Same X/Z, dropped to the nearest valid resting level (floor, supporter
 *      top, or rigid wheel-well top — the caller's bottomsFor provides them).
 *   2. Nearby lateral anchors: flush against neighboring cargo faces or clamped
 *      into nearby zone footprints, closest to the original position first,
 *      again dropped to the nearest valid resting level.
 *   3. Still invalid → left for the caller to stage (truly unplaceable).
 *
 * Validity is INJECTED by the caller (pack-library supplies its full hard-rule
 * check: containment incl. the wheel-well union model, blocked bodies,
 * collision, support incl. rigid well tops, Front Overhang retention). This
 * module therefore cannot weaken a rule — it can only propose positions.
 * @module packing-core/repair
 */

const REPAIR_EPS = 0.05;

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dedupeSorted(anchors) {
  const seen = new Set();
  const out = [];
  for (const anchor of anchors) {
    const key = `${Math.round(anchor.x * 1000)}|${Math.round(anchor.z * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
}

/**
 * Candidate lateral anchor centers (x,z) near the node's original position:
 * flush placements against neighbor faces plus the original footprint clamped
 * into each zone that can hold it. Sorted by squared distance from the
 * original center, capped. Pure and deterministic.
 */
export function buildRepairAnchors(node, zones, neighborAabbs, options = {}) {
  const L = finiteNumber(node.dims.length);
  const W = finiteNumber(node.dims.width);
  const ox = finiteNumber(node.position.x);
  const oz = finiteNumber(node.position.z);
  const radius = finiteNumber(options.radius, Math.max(48, 2 * Math.max(L, W)));
  const maxAnchors = Math.max(1, Math.floor(finiteNumber(options.maxAnchors, 36)));

  const raw = [];
  for (const n of neighborAabbs || []) {
    if (!n) continue;
    const cx = (n.min.x + n.max.x) / 2;
    const cz = (n.min.z + n.max.z) / 2;
    if (Math.abs(cx - ox) > radius && Math.abs(cz - oz) > radius) continue;
    raw.push(
      { x: n.max.x + L / 2, z: oz },
      { x: n.min.x - L / 2, z: oz },
      { x: ox, z: n.max.z + W / 2 },
      { x: ox, z: n.min.z - W / 2 }
    );
  }
  for (const zone of zones || []) {
    const zoneL = zone.max.x - zone.min.x;
    const zoneW = zone.max.z - zone.min.z;
    if (L > zoneL + REPAIR_EPS || W > zoneW + REPAIR_EPS) continue;
    raw.push({
      x: Math.min(Math.max(ox, zone.min.x + L / 2), zone.max.x - L / 2),
      z: Math.min(Math.max(oz, zone.min.z + W / 2), zone.max.z - W / 2),
    });
  }

  return dedupeSorted(
    raw
      .filter(a => Number.isFinite(a.x) && Number.isFinite(a.z))
      .filter(a => Math.abs(a.x - ox) <= radius && Math.abs(a.z - oz) <= radius)
      .sort((a, b) =>
        ((a.x - ox) ** 2 + (a.z - oz) ** 2) - ((b.x - ox) ** 2 + (b.z - oz) ** 2) ||
        a.x - b.x || a.z - b.z
      )
  ).slice(0, maxAnchors);
}

/**
 * Try to re-settle each affected node inside the truck. Nodes must be provided
 * bottom-up (lowest original Y first) so lower dependents become support for
 * the ones above them.
 *
 * @param {Array<{ id: string, dims: {length,width,height}, position: {x,y,z} }>} nodes
 * @param {object} helpers
 * @param {(node, position) => boolean} helpers.validate - full hard-rule check
 *   against accepted + already-repaired placements (injected by the caller).
 * @param {(node, x, z) => number[]} helpers.bottomsFor - ascending candidate
 *   bottom-Y levels under the footprint centered at (x, z).
 * @param {(node, position) => void} helpers.onRepaired - caller records the
 *   repaired placement so later validations see it.
 * @param {Array} [helpers.zones] - usable zones for anchor generation.
 * @param {() => Array} [helpers.neighborAabbs] - current accepted AABBs
 *   (re-read per node so freshly repaired cases become anchor neighbors).
 * @returns {{ repaired: Array<{id, position}>, failed: Array }}
 */
export function repairDependentPlacements(nodes, helpers) {
  const repaired = [];
  const failed = [];
  const validate = helpers.validate;
  const bottomsFor = helpers.bottomsFor;

  for (const node of nodes || []) {
    const height = finiteNumber(node.dims.height);
    const anchors = [
      { x: finiteNumber(node.position.x), z: finiteNumber(node.position.z) },
      ...buildRepairAnchors(
        node,
        helpers.zones || [],
        typeof helpers.neighborAabbs === 'function' ? helpers.neighborAabbs() : [],
        helpers.anchorOptions || {}
      ),
    ];

    let placedAt = null;
    for (const anchor of anchors) {
      for (const bottom of bottomsFor(node, anchor.x, anchor.z)) {
        const position = { x: anchor.x, y: bottom + height / 2, z: anchor.z };
        if (!validate(node, position)) continue;
        placedAt = position;
        break;
      }
      if (placedAt) break;
    }

    if (placedAt) {
      repaired.push({ id: node.id, position: placedAt });
      if (typeof helpers.onRepaired === 'function') helpers.onRepaired(node, placedAt);
    } else {
      failed.push(node);
    }
  }

  return { repaired, failed };
}
