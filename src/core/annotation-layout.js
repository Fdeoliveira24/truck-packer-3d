/**
 * @file annotation-layout.js
 * @description Pure screen-space layout for Annotations V1 (no THREE, no DOM): where a callout card sits
 *   relative to its marker, viewport clamping, the stored-offset round trip, the automatic placement used
 *   until a card is dragged, the leader line, and the card budget.
 *
 *   Everything here works in CSS pixels inside the viewport overlay. The card's position is
 *   `marker + offset`, so it follows the marker through orbit, zoom and pan; a stored offset is never
 *   rewritten by clamping (the clamp is applied for display only), so a card pushed in by a small window
 *   returns to where it was left when there is room again.
 * @module core/annotation-layout
 */

export const CARD_WIDTH = 208;
export const CARD_WIDTH_COMPACT = 176;
export const COMPACT_VIEWPORT_WIDTH = 500;
export const VIEWPORT_MARGIN = 8;
/** Gap between the marker centre and where its leader line starts, so the line never crosses the marker. */
export const LEADER_START_GAP = 10;
const LEADER_MIN_LENGTH = 12;
const AREA_FOR_CARD_DESKTOP = 70000;
const AREA_FOR_CARD_COMPACT = 110000;
const MIN_CARDS = 2;
const MAX_CARDS = 9;
const SLOT_RADII = Object.freeze([30, 66, 110]);
// Preference order: up-right, down-right, up-left, down-left, above, below, right, left.
const SLOT_DIRECTIONS = Object.freeze([[1, -1], [1, 1], [-1, -1], [-1, 1], [0, -1], [0, 1], [1, 0], [-1, 0]]);
export const SLOT_COUNT = SLOT_RADII.length * SLOT_DIRECTIONS.length;

const finite = value => typeof value === 'number' && Number.isFinite(value);

export function isCompactViewport(width) {
  return finite(width) && width < COMPACT_VIEWPORT_WIDTH;
}

export function cardWidth(viewportWidth) {
  return isCompactViewport(viewportWidth) ? CARD_WIDTH_COMPACT : CARD_WIDTH;
}

/**
 * How many cards may be expanded at once: a budget from the viewport area (about 9 on a desktop
 * viewport, 2 on a phone). Selected and kept-expanded callouts take it first; the rest stay labels.
 */
export function cardBudget(width, height) {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) return MIN_CARDS;
  const area = isCompactViewport(width) ? AREA_FOR_CARD_COMPACT : AREA_FOR_CARD_DESKTOP;
  return Math.max(MIN_CARDS, Math.min(MAX_CARDS, Math.floor((width * height) / area)));
}

/**
 * Card height before it has been measured: header, an optional description and the "attached to" line.
 * The Editor measures the real element once per content change; this is only the first guess.
 */
export function estimateCardHeight(description, width = CARD_WIDTH) {
  if (!description) return 58;
  const charsPerLine = width < 190 ? 25 : 30;
  return 58 + 6 + Math.ceil(description.length / charsPerLine) * 16;
}

/** `rect` kept inside the viewport. A rect larger than the viewport is pinned to the top-left margin. */
export function clampRect(rect, viewport, margin = VIEWPORT_MARGIN) {
  const maxX = Math.max(margin, viewport.width - rect.w - margin);
  const maxY = Math.max(margin, viewport.height - rect.h - margin);
  return { x: Math.min(Math.max(rect.x, margin), maxX), y: Math.min(Math.max(rect.y, margin), maxY), w: rect.w, h: rect.h };
}

/** Where a card sits for a stored offset: marker + offset, kept inside the viewport (display only). */
export function rectFromOffset(marker, offset, size, viewport, margin = VIEWPORT_MARGIN) {
  return clampRect({ x: marker.x + offset.dx, y: marker.y + offset.dy, w: size.w, h: size.h }, viewport, margin);
}

/** The offset that puts a card at `rect` for a marker at `marker` (rounded like a stored offset). */
export function offsetFromRect(marker, rect) {
  return { dx: Math.round((rect.x - marker.x) * 10) / 10, dy: Math.round((rect.y - marker.y) * 10) / 10 };
}

export function overlapArea(a, b) {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function slotRect(marker, size, viewport, slot, margin) {
  const radius = SLOT_RADII[Math.floor(slot / SLOT_DIRECTIONS.length)];
  const [dx, dy] = SLOT_DIRECTIONS[slot % SLOT_DIRECTIONS.length];
  const x = dx > 0 ? marker.x + radius : dx < 0 ? marker.x - radius - size.w : marker.x - size.w / 2;
  const y = dy < 0 ? marker.y - radius - size.h : dy > 0 ? marker.y + radius : marker.y - size.h / 2;
  return { rect: clampRect({ x, y, w: size.w, h: size.h }, viewport, margin), radius };
}

function slotPenalty(marker, placed, occupied, radius) {
  let penalty = radius * 3;
  for (const other of occupied) penalty += overlapArea(placed, other);
  // A card sitting on its own marker hides it.
  if (marker.x > placed.x - 4 && marker.x < placed.x + placed.w + 4 && marker.y > placed.y - 4 && marker.y < placed.y + placed.h + 4) penalty += 1e6;
  return { penalty, clean: penalty <= radius * 3 };
}

/**
 * Automatic placement until the owner drags a card: the first slot around the marker that overlaps no
 * other card or marker and stays inside the viewport, else the least bad one. `previousSlot` is tried
 * first, so a card does not hop between sides while the camera orbits unless it would collide.
 * @param {{ marker: {x:number,y:number}, size: {w:number,h:number}, viewport: {width:number,height:number},
 *   occupied?: Array<{x:number,y:number,w:number,h:number}>, previousSlot?: number | null, margin?: number }} input
 * @returns {{ x: number, y: number, w: number, h: number, slot: number }}
 */
export function autoPlace({ marker, size, viewport, occupied = [], previousSlot = null, margin = VIEWPORT_MARGIN }) {
  if (Number.isInteger(previousSlot) && previousSlot >= 0 && previousSlot < SLOT_COUNT) {
    const { rect, radius } = slotRect(marker, size, viewport, previousSlot, margin);
    if (slotPenalty(marker, rect, occupied, radius).clean) return { ...rect, slot: previousSlot };
  }
  let best = null;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const { rect, radius } = slotRect(marker, size, viewport, slot, margin);
    const { penalty, clean } = slotPenalty(marker, rect, occupied, radius);
    if (clean) return { ...rect, slot };
    if (!best || penalty < best.penalty) best = { ...rect, slot, penalty };
  }
  const { penalty: _penalty, ...placed } = best;
  return placed;
}

/** Smallest card height worth showing: the title bar, one field and the buttons. Below this a card is not usable. */
export const MIN_EDITOR_HEIGHT = 220;
/** Breathing room kept between the editor and an obstacle it must not cover. */
export const OBSTACLE_GAP = 6;
/** Where the narrow-viewport sheet sits by default (px from the viewport's left, right and bottom edges). */
export const SHEET_INSETS = Object.freeze({ left: 8, right: 58, bottom: 54 });
const SHEET_MAX_FRACTION = 0.84;

const isRect = value => Boolean(value) && finite(value.x) && finite(value.y) && finite(value.w) && finite(value.h) && value.w > 0 && value.h > 0;
const inflate = (rect, gap) => ({ x: rect.x - gap, y: rect.y - gap, w: rect.w + gap * 2, h: rect.h + gap * 2 });

/**
 * Keep the editor card off the rectangles it must never cover (the AutoPack Results panel and its restore
 * button, wherever the owner left them). The card stays where it was when nothing is in the way; otherwise it
 * moves to the nearest spot that is clear, and when no full-size spot exists it keeps its width and gives up
 * height (its body scrolls, its buttons never move off the card). The stored position is never touched:
 * this is display only, so the card returns when the obstacle moves away.
 * @param {{x:number,y:number,w:number,h:number}} rect where the card would sit
 * @param {Array<{x:number,y:number,w:number,h:number}>} blockers
 * @param {{width:number,height:number}} viewport
 * @returns {{x:number,y:number,w:number,h:number,shrunk:boolean,clear:boolean}} `clear` is false only when
 *   even a minimum-height card has nowhere to go (the caller then falls back to a sheet).
 */
export function clearOfBlockers(rect, blockers, viewport, { margin = VIEWPORT_MARGIN, gap = OBSTACLE_GAP, minHeight = MIN_EDITOR_HEIGHT } = {}) {
  const solid = (Array.isArray(blockers) ? blockers : []).filter(isRect).map(blocker => inflate(blocker, gap));
  const hits = candidate => solid.some(blocker => overlapArea(candidate, blocker) > 0);
  if (!solid.length || !hits(rect)) return { ...rect, shrunk: false, clear: true };

  const xs = [...new Set([rect.x, margin, viewport.width - margin - rect.w, ...solid.flatMap(b => [b.x - rect.w, b.x + b.w])])];
  const ys = [...new Set([rect.y, margin, viewport.height - margin - rect.h, ...solid.flatMap(b => [b.y - rect.h, b.y + b.h])])];
  let best = null;
  for (const cx of xs) {
    for (const cy of ys) {
      const placed = clampRect({ x: cx, y: cy, w: rect.w, h: rect.h }, viewport, margin);
      if (hits(placed)) continue;
      const cost = (placed.x - rect.x) ** 2 + (placed.y - rect.y) ** 2;
      if (!best || cost < best.cost) best = { ...placed, cost };
    }
  }
  if (best) return { x: best.x, y: best.y, w: best.w, h: best.h, shrunk: false, clear: true };

  // No full-size spot: the card keeps its width and gives up height. Prefer a taller card over a short move.
  const floor = Math.min(minHeight, rect.h);
  const clampX = x => Math.min(Math.max(x, margin), Math.max(margin, viewport.width - rect.w - margin));
  const shortXs = [...new Set(xs.map(clampX))];
  const shortYs = [...new Set([margin, ...solid.map(b => b.y + b.h)])].filter(y => y >= margin && y <= viewport.height - margin - floor);
  for (const cx of shortXs) {
    for (const cy of shortYs) {
      const span = { x: cx, y: cy, w: rect.w, h: floor };
      if (hits(span)) continue;
      // Grow downward until the next obstacle over this column (or the viewport edge).
      const limit = solid
        .filter(b => b.y >= cy && overlapArea({ x: cx, y: 0, w: rect.w, h: viewport.height }, b) > 0)
        .reduce((lowest, b) => Math.min(lowest, b.y), viewport.height - margin);
      const h = Math.min(rect.h, limit - cy);
      if (h < floor) continue;
      const cost = (cx - rect.x) ** 2 + (cy - rect.y) ** 2 + (rect.h - h) ** 2 * 4;
      if (!best || cost < best.cost) best = { x: cx, y: cy, w: rect.w, h, cost };
    }
  }
  if (best) return { x: best.x, y: best.y, w: best.w, h: best.h, shrunk: best.h < rect.h, clear: true };
  return { ...clampRect(rect, viewport, margin), shrunk: false, clear: false };
}

/**
 * The narrow-viewport editor is a sheet along the bottom of the view. Where `blockers` cover part of the band
 * it occupies, the sheet moves to the largest clear stretch of that band (usually straight above the AutoPack
 * Results panel) and gives up height before any of its buttons would be hidden.
 * @param {{ viewport: {width:number,height:number}, blockers?: Array<{x:number,y:number,w:number,h:number}>,
 *   height: number, insets?: {left:number,right:number,bottom:number}, margin?: number, gap?: number,
 *   minHeight?: number }} input `height` is the sheet's natural height.
 * @returns {{ moved: boolean, bottom: number, maxHeight: number }} `moved` false means the stylesheet's own
 *   placement is already clear and needs no override.
 */
export function fitSheet({ viewport, blockers = [], height, insets = SHEET_INSETS, margin = VIEWPORT_MARGIN, gap = OBSTACLE_GAP, minHeight = MIN_EDITOR_HEIGHT }) {
  const cap = Math.floor(viewport.height * SHEET_MAX_FRACTION);
  const fallback = { moved: false, bottom: insets.bottom, maxHeight: cap };
  const band = { x: insets.left, w: Math.max(1, viewport.width - insets.left - insets.right) };
  const solid = (Array.isArray(blockers) ? blockers : []).filter(isRect).map(blocker => inflate(blocker, gap))
    .filter(blocker => overlapArea({ x: band.x, y: 0, w: band.w, h: viewport.height }, blocker) > 0);
  const natural = Math.min(Math.max(height, 0) || minHeight, cap);
  const defaultTop = viewport.height - insets.bottom - natural;
  const defaultRect = { x: band.x, y: defaultTop, w: band.w, h: natural };
  if (!solid.length || !solid.some(blocker => overlapArea(defaultRect, blocker) > 0)) return fallback;

  // Free stretches of the band, from the top margin to the sheet's lowest allowed edge.
  const floorY = viewport.height - insets.bottom;
  const within = y => Math.min(Math.max(y, margin), floorY);
  const cuts = solid.map(b => [within(b.y), within(b.y + b.h)]).sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = margin;
  for (const [start, end] of cuts) {
    if (start > cursor) free.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < floorY) free.push([cursor, floorY]);
  let best = null;
  for (const [start, end] of free) {
    const room = end - start;
    if (room < Math.min(minHeight, natural)) continue;
    const usable = Math.min(natural, room);
    // Taller first, then the stretch lowest on the screen (closest to where the sheet normally sits).
    if (!best || usable > best.usable + 0.5 || (Math.abs(usable - best.usable) <= 0.5 && end > best.end)) best = { start, end, usable };
  }
  if (!best) {
    // Nowhere with room: the tallest stretch there is, never overlapping a blocker.
    const widest = free.reduce((top, stretch) => (!top || stretch[1] - stretch[0] > top[1] - top[0] ? stretch : top), null);
    if (!widest) return fallback;
    return { moved: true, bottom: Math.round(viewport.height - widest[1]), maxHeight: Math.max(1, Math.floor(widest[1] - widest[0])) };
  }
  return { moved: true, bottom: Math.round(viewport.height - best.end), maxHeight: Math.max(1, Math.floor(Math.min(cap, best.end - best.start))) };
}

/** Smallest height worth giving the desktop panel: its header, tool and view rows and part of one callout row. */
export const MIN_PANEL_HEIGHT = 200;

/**
 * The desktop Annotations panel hangs from its top edge. Where a blocker (the AutoPack Results card) sits below that
 * edge over the panel's columns, the panel is limited to the stretch above it, so its list scrolls instead of running
 * under the card. A blocker that starts at or above the panel's top, or that leaves less than `minHeight`, is not
 * something a height limit can fix: the panel is left alone.
 * @param {{ panel: {x:number,y:number,w:number,h:number}, blockers?: Array<{x:number,y:number,w:number,h:number}>,
 *   natural: number, gap?: number, minHeight?: number }} input `natural` is the height the panel would take unlimited.
 * @returns {number|null} The height limit in px, or null when the panel needs none.
 */
export function fitHangingPanel({ panel, blockers = [], natural, gap = OBSTACLE_GAP, minHeight = MIN_PANEL_HEIGHT }) {
  let limit = Infinity;
  for (const blocker of Array.isArray(blockers) ? blockers : []) {
    if (!isRect(blocker) || blocker.y <= panel.y) continue;
    if (blocker.x >= panel.x + panel.w || blocker.x + blocker.w <= panel.x) continue;
    limit = Math.min(limit, blocker.y - gap - panel.y);
  }
  if (!(limit < natural) || limit < minHeight) return null;
  return Math.floor(limit);
}

const LABEL_HEIGHT = 20;
const LABEL_MAX_WIDTH = 150;
const LABEL_GAP = 15;
const LABEL_CHAR_WIDTH = 6.4;
const LABEL_PADDING = 16;
/** A marker this close to the right edge draws its label on its left (the same rule the stylesheet applies). */
export const LABEL_FLIP_MARGIN = 190;

/** Estimated on-screen rect of a marker's label: beside the marker, on its left near the right-hand edge. */
export function labelRect(marker, text, viewportWidth) {
  const w = Math.min(LABEL_MAX_WIDTH, LABEL_PADDING + String(text || '').length * LABEL_CHAR_WIDTH);
  const left = marker.x > viewportWidth - LABEL_FLIP_MARGIN;
  return { x: left ? marker.x - LABEL_GAP - w : marker.x + LABEL_GAP, y: marker.y - LABEL_HEIGHT / 2, w, h: LABEL_HEIGHT };
}

/**
 * Which labels are drawn in a crowded view: in priority order, a label is kept unless it would cover a kept
 * label or another marker. The marker itself is always drawn; its title stays in the panel and the tooltip.
 * @param {Array<{ id: string, marker: {x:number,y:number}, text: string }>} labels in priority order
 * @param {Array<{ id: string, x: number, y: number, w: number, h: number }>} pins every marker's rect
 * @param {number} viewportWidth
 * @returns {Set<string>}
 */
export function fitLabels(labels, pins, viewportWidth) {
  const kept = new Set();
  const placed = [];
  for (const label of labels) {
    const rect = labelRect(label.marker, label.text, viewportWidth);
    const blocked = placed.some(other => overlapArea(rect, other) > 0) ||
      pins.some(pin => pin.id !== label.id && overlapArea(rect, pin) > 0);
    if (blocked) continue;
    kept.add(label.id);
    placed.push(rect);
  }
  return kept;
}

/**
 * The leader line from a marker to its card: starts `LEADER_START_GAP` px from the marker centre, ends on
 * the nearest point of the card, and is omitted (null) when the card is already next to the marker.
 */
export function leaderLine(marker, rect) {
  const x2 = Math.max(rect.x, Math.min(rect.x + rect.w, marker.x));
  const y2 = Math.max(rect.y, Math.min(rect.y + rect.h, marker.y));
  const distance = Math.hypot(x2 - marker.x, y2 - marker.y);
  if (distance < LEADER_MIN_LENGTH) return null;
  return {
    x1: marker.x + ((x2 - marker.x) / distance) * LEADER_START_GAP,
    y1: marker.y + ((y2 - marker.y) / distance) * LEADER_START_GAP,
    x2,
    y2,
  };
}
