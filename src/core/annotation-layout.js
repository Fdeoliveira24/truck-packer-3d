/**
 * @file annotation-layout.js
 * @description Pure screen-space layout for Annotations V1 (no THREE, no DOM): where a callout card sits
 *   relative to its marker, viewport clamping, the stored-offset round trip, the automatic placement used
 *   until a card is dragged, the leader line, and the card budget. Directional arrows live at the end of the
 *   file: near-plane clipping in camera space and the bounded 2D shape (shaft and head) of one arrow.
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

/**
 * Where the desktop editor card sits. It keeps clear of the AutoPack Results card and the "Load plan needs review"
 * button (hard), and of its own marker and the Annotations panel where there is room (soft). The panel is drawn
 * above the card, so a card that overlaps it has its Title, Save and Cancel underneath: that is only ever accepted
 * with `coversPanel` true, and the caller then hides the panel for as long as the card is open. The marker is
 * relaxed before the panel, and the panel before the card gives up (`fit.clear` false: the caller shows the sheet).
 * Once the panel yields the card also keeps off the viewport control stack, so the end of Save is not left under it.
 * A card the owner placed keeps its spot and yields only to Results; where it meets the panel the panel yields.
 * Display only: neither the stored card position nor the panel's own position is touched.
 * @param {{ rect: {x:number,y:number,w:number,h:number}, viewport: {width:number,height:number},
 *   panel?: Array<{x:number,y:number,w:number,h:number}>, status?: Array<{x:number,y:number,w:number,h:number}>,
 *   results?: Array<{x:number,y:number,w:number,h:number}>, marker?: Array<{x:number,y:number,w:number,h:number}>,
 *   controls?: Array<{x:number,y:number,w:number,h:number}>, ownerPlaced?: boolean }} input
 * @returns {{ fit: ReturnType<typeof clearOfBlockers>, coversPanel: boolean }}
 */
export function fitEditorClear({ rect, viewport, panel = [], status = [], results = [], marker = [], controls = [], ownerPlaced = false }) {
  const solid = list => (Array.isArray(list) ? list : []).filter(isRect);
  const [panels, statuses, resultCards, markers, stack] = [panel, status, results, marker, controls].map(solid);
  const tiers = ownerPlaced
    ? [resultCards]
    : [
      [...panels, ...statuses, ...resultCards, ...markers],
      [...panels, ...statuses, ...resultCards],
      [...statuses, ...resultCards, ...stack, ...markers],
      [...statuses, ...resultCards, ...stack],
      [...statuses, ...resultCards],
    ];
  let fit = null;
  for (const blockers of tiers) {
    fit = clearOfBlockers(rect, blockers, viewport);
    if (fit.clear) break;
  }
  return { fit, coversPanel: fit.clear && panels.some(box => overlapArea(fit, box) > 0) };
}

/** Smallest height worth giving the desktop panel: its header, tool and view rows and part of one callout row. */
export const MIN_PANEL_HEIGHT = 200;
/**
 * Where a panel that cannot have MIN_PANEL_HEIGHT still gives up height rather than being left under Results: its header
 * and tool row with a little of what scrolls beneath them. Below this nothing useful fits and it stays where it is.
 */
export const PANEL_FLOOR_HEIGHT = 150;
/** Scrolling room that must remain beside the arrow look controls for them to stay pinned (else they scroll with the rows). */
export const PANEL_PIN_MIN_SCROLL = 150;
/**
 * Where the desktop panel may sit: below the viewport toolbar and left of the viewport controls (px from each edge).
 * The left and bottom insets are the margin the panel's own drag keeps from the viewport edge.
 */
export const PANEL_REGION_INSETS = Object.freeze({ left: 10, top: 64, right: 58, bottom: 10 });

/**
 * Keep the desktop Annotations panel off the AutoPack Results card (or its restore button), wherever the owner left
 * either of them. Like the editor card, the panel stays put when nothing is in the way. A card over its lower part
 * leaves it docked and limits its height (the list scrolls); otherwise it moves to the nearest clear spot inside its
 * region, and when no full-size spot exists it keeps its width and gives up height (its list scrolls, its header and
 * tools never move off the panel). Where not even `minHeight` is available it keeps giving up height down to `floorHeight`
 * (its whole body scrolls under the header), so a few pixels of room never leave it under the card. Display only: the
 * owner's dragged position is never touched, so the panel returns when Results moves away. `clear` is false only when even
 * a floor-height panel has nowhere to go; the caller then leaves it where it is.
 * @param {{ panel: {x:number,y:number,w:number,h:number}, blockers?: Array<{x:number,y:number,w:number,h:number}>,
 *   viewport: {width:number,height:number}, insets?: {left:number,top:number,right:number,bottom:number},
 *   gap?: number, minHeight?: number, floorHeight?: number }} input `panel` is where the panel would sit at its natural height.
 * @returns {{ dx: number, dy: number, maxHeight: number|null, clear: boolean }} the shift to apply and the height limit
 *   (null when the natural height fits).
 */
export function fitPanelClear({ panel, blockers = [], viewport, insets = PANEL_REGION_INSETS, gap = OBSTACLE_GAP, minHeight = MIN_PANEL_HEIGHT, floorHeight = PANEL_FLOOR_HEIGHT }) {
  const region = { x: insets.left, y: insets.top, w: viewport.width - insets.left - insets.right, h: viewport.height - insets.top - insets.bottom };
  const stay = clear => ({ dx: 0, dy: 0, maxHeight: null, clear });
  if (!isRect(panel) || !(region.w > 0) || !(region.h > 0)) return stay(false);
  const local = rect => ({ x: rect.x - region.x, y: rect.y - region.y, w: rect.w, h: rect.h });
  const solid = (Array.isArray(blockers) ? blockers : []).filter(isRect).map(local);
  const at = local(panel);
  const hits = rect => solid.some(blocker => overlapArea(rect, inflate(blocker, gap)) > 0);
  if (!hits(at)) return stay(true);
  // The tallest the panel can be, down to `floor`: docked where it is with its list scrolling above the card, or shifted
  // to the nearest clear spot (whole, or giving up height there). null when even `floor` has nowhere to go.
  const fitAbove = floor => {
    // A card over the panel's lower part: the panel stays where it is docked and its list scrolls above the card.
    let limit = Infinity;
    for (const blocker of solid) {
      if (blocker.y > at.y && blocker.x < at.x + at.w && blocker.x + blocker.w > at.x) limit = Math.min(limit, blocker.y - gap - at.y);
    }
    if (limit >= floor && limit < at.h && !hits({ ...at, h: limit })) return { dx: 0, dy: 0, maxHeight: Math.floor(limit), clear: true };
    // Anywhere else (over the header, beside it): the nearest clear spot, whole, or the tallest stretch there is.
    const fit = clearOfBlockers(at, solid, { width: region.w, height: region.h }, { margin: 0, gap, minHeight: floor });
    if (!fit.clear) return null;
    return {
      dx: Math.round(fit.x + region.x - panel.x),
      dy: Math.round(fit.y + region.y - panel.y),
      maxHeight: fit.shrunk ? Math.floor(fit.h) : null,
      clear: true,
    };
  };
  // The preferred minimum first (the layout V1A settled), then down to the floor: a few pixels short of the preferred
  // minimum must not leave the panel under the card, so there is no cliff where the room above Results runs out.
  return fitAbove(minHeight) || (floorHeight < minHeight ? fitAbove(floorHeight) : null) || stay(false);
}

/**
 * Whether the panel body scrolls as a whole (everything below the header, the arrow look controls included) instead of
 * keeping its rows fixed and scrolling only the list. A panel limited in height (beside Results, in a small window, as the
 * narrow sheet) must never lose its tool, Show or list rows to controls that stay put: where the pinned look controls would
 * leave less than `minScroll` of scrolling room, or the fixed rows would leave no list, everything scrolls together.
 * @param {{ panelHeight: number, contentHeight: number, headHeight: number, footerHeight?: number, minHeight?: number, minScroll?: number }} input
 *   `contentHeight` is the panel's height with nothing scrolling; `footerHeight` is the arrow look controls' (0 when hidden).
 * @returns {boolean}
 */
export function panelBodyFlows({ panelHeight, contentHeight, headHeight, footerHeight = 0, minHeight = MIN_PANEL_HEIGHT, minScroll = PANEL_PIN_MIN_SCROLL }) {
  if (![panelHeight, contentHeight, headHeight, footerHeight].every(finite)) return false;
  if (!(contentHeight > panelHeight + 1)) return false; // everything fits: there is nothing to scroll
  return footerHeight > 0 ? panelHeight - headHeight - footerHeight < minScroll : panelHeight < minHeight;
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

// ============================================================================
// Directional arrows (screen space only; no THREE, no DOM)
// ============================================================================
/** Stroke width (px) of the shaft per stored width name. Constant on screen: it never scales with zoom. */
export const ARROW_SHAFT_PX = Object.freeze({ thin: 2, regular: 3, bold: 5 });
/** Arrowhead length and full width (px) per stored width name. */
export const ARROW_HEAD_PX = Object.freeze({ thin: Object.freeze({ length: 12, width: 10 }), regular: Object.freeze({ length: 15, width: 12 }), bold: Object.freeze({ length: 21, width: 17 }) });
/** An arrow whose projected length (tail to head) is below this is not drawn: it would be little more than a head. */
export const ARROW_MIN_SCREEN_PX = 12;
/** A visible stretch shorter than this is not drawn either (the rest of the arrow is off screen). */
export const ARROW_MIN_VISIBLE_PX = 6;
/** How far past the viewport edge an arrow end may sit and still count as on screen (so a head half-outside is still drawn whole). */
export const ARROW_OFFSCREEN_MARGIN_PX = 30;
const ARROW_HEAD_SHAFT_OVERLAP = 0.85;
const ARROW_HEAD_MAX_FRACTION = 0.6;

/**
 * Clip a segment given in camera space (looking down -Z) to the near plane. A perspective camera cannot project a
 * point at or behind its near plane, so the part of the segment in front is kept and the end that was cut is flagged.
 * Linear interpolation is exact in camera space (the view transform is affine). Orthographic cameras need no clip.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @param {number} nearZ the largest (closest to zero) camera-space Z that may be projected, e.g. -(near + epsilon)
 * @returns {{ a: {x:number,y:number,z:number}, b: {x:number,y:number,z:number}, aClipped: boolean, bClipped: boolean } | null}
 *   null when no part of the segment is in front of the camera or a coordinate is not finite
 */
export function clipSegmentToNear(a, b, nearZ) {
  const ok = point => Boolean(point) && finite(point.x) && finite(point.y) && finite(point.z);
  if (!ok(a) || !ok(b) || !finite(nearZ)) return null;
  const aIn = a.z <= nearZ;
  const bIn = b.z <= nearZ;
  if (!aIn && !bIn) return null;
  if (aIn && bIn) return { a: { ...a }, b: { ...b }, aClipped: false, bClipped: false };
  // Exactly one end is in front: cut the other where the segment crosses the plane.
  const t = (nearZ - a.z) / (b.z - a.z);
  const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: nearZ };
  if (!ok(cut)) return null;
  return aIn
    ? { a: { ...a }, b: cut, aClipped: false, bClipped: true }
    : { a: cut, b: { ...b }, aClipped: true, bClipped: false };
}

/**
 * Liang-Barsky: the parameter range [t0, t1] of the segment that lies inside `rect`, or null when none does.
 */
function clipParams(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges = [[-dx, x1 - rect.x], [dx, rect.x + rect.w - x1], [-dy, y1 - rect.y], [dy, rect.y + rect.h - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 < t1 ? { t0, t1 } : null;
}

const round1 = value => Math.round(value * 10) / 10;

/**
 * The 2D shape of one arrow from its projected end points: a shaft from the tail to the base of a solid head
 * at the head end. Everything is bounded to the viewport (plus a margin), so a near-plane clip or a huge zoom
 * can never produce coordinates the SVG cannot render. Returns null (draw nothing) when:
 * - a coordinate is not finite;
 * - the full projected length is below ARROW_MIN_SCREEN_PX (too short to read as an arrow);
 * - no part of it is inside the viewport, or the visible stretch is below ARROW_MIN_VISIBLE_PX.
 * The head is drawn only when the head end is a real point (not cut by the near plane) inside the viewport margin
 * and the arrow is long enough to carry it; otherwise the arrow is shaft only. A head never exceeds 60% of the length.
 * @param {{ tail: {x:number,y:number}, head: {x:number,y:number}, width: 'thin'|'regular'|'bold', viewport: {width:number,height:number},
 *   headClipped?: boolean, margin?: number }} input
 * @returns {{ shaft: {x1:number,y1:number,x2:number,y2:number}, head: Array<{x:number,y:number}> | null,
 *   tip: {x:number,y:number} | null, length: number, shaftWidth: number } | null}
 */
export function arrowShape({ tail, head, width = 'regular', viewport, headClipped = false, margin = ARROW_OFFSCREEN_MARGIN_PX }) {
  if (!tail || !head || !viewport) return null;
  if (![tail.x, tail.y, head.x, head.y, viewport.width, viewport.height].every(finite)) return null;
  const length = Math.hypot(head.x - tail.x, head.y - tail.y);
  if (!(length >= ARROW_MIN_SCREEN_PX)) return null;
  const rect = { x: -margin, y: -margin, w: viewport.width + margin * 2, h: viewport.height + margin * 2 };
  const span = clipParams(tail.x, tail.y, head.x, head.y, rect);
  if (!span) return null;
  if ((span.t1 - span.t0) * length < ARROW_MIN_VISIBLE_PX) return null;
  const ux = (head.x - tail.x) / length;
  const uy = (head.y - tail.y) / length;
  const shaftWidth = ARROW_SHAFT_PX[width] || ARROW_SHAFT_PX.regular;
  const size = ARROW_HEAD_PX[width] || ARROW_HEAD_PX.regular;
  const headWhole = !headClipped && span.t1 === 1;
  const startX = tail.x + (head.x - tail.x) * span.t0;
  const startY = tail.y + (head.y - tail.y) * span.t0;
  if (!headWhole) {
    // Shaft only: the visible part of the line, the head end being off screen or cut by the near plane.
    const endX = tail.x + (head.x - tail.x) * span.t1;
    const endY = tail.y + (head.y - tail.y) * span.t1;
    if (![startX, startY, endX, endY].every(finite)) return null;
    return { shaft: { x1: round1(startX), y1: round1(startY), x2: round1(endX), y2: round1(endY) }, head: null, tip: null, length, shaftWidth };
  }
  // A short arrow carries a smaller head, never a head longer than most of itself.
  const scale = Math.min(1, (length * ARROW_HEAD_MAX_FRACTION) / size.length);
  const headLength = size.length * scale;
  const halfWidth = (size.width * scale) / 2;
  const baseX = head.x - ux * headLength;
  const baseY = head.y - uy * headLength;
  const polygon = [
    { x: head.x, y: head.y },
    { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth },
    { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth },
  ];
  // The shaft ends a little inside the head so the two never show a seam; a tail end that is off screen is cut at the edge.
  const shaftEndX = head.x - ux * headLength * ARROW_HEAD_SHAFT_OVERLAP;
  const shaftEndY = head.y - uy * headLength * ARROW_HEAD_SHAFT_OVERLAP;
  const coordinates = [startX, startY, shaftEndX, shaftEndY, ...polygon.flatMap(point => [point.x, point.y])];
  if (!coordinates.every(finite)) return null;
  return {
    shaft: { x1: round1(startX), y1: round1(startY), x2: round1(shaftEndX), y2: round1(shaftEndY) },
    head: polygon.map(point => ({ x: round1(point.x), y: round1(point.y) })),
    tip: { x: round1(head.x), y: round1(head.y) },
    length,
    shaftWidth,
  };
}

/** SVG path data for a shape returned by `arrowShape`: the shaft line and the head triangle as two separate paths. */
export function arrowPathData(shape) {
  if (!shape) return { shaft: '', head: '' };
  const { shaft, head } = shape;
  return {
    shaft: `M${shaft.x1} ${shaft.y1}L${shaft.x2} ${shaft.y2}`,
    head: head ? `M${head[0].x} ${head[0].y}L${head[1].x} ${head[1].y}L${head[2].x} ${head[2].y}Z` : '',
  };
}

/** Where along an arrow (0 = tail, 1 = head) occlusion is sampled: the two ends and the middle. */
export const ARROW_SAMPLE_FRACTIONS = Object.freeze([0, 0.5, 1]);
