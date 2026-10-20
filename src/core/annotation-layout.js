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
