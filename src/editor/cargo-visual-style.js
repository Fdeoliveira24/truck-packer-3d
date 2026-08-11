/**
 * @file cargo-visual-style.js
 * @description Canvas-only cargo body and category-marking presentation for the existing CaseScene.
 * @module editor/cargo-visual-style
 */

export const CARGO_BODY_STYLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'cad', label: 'CAD' }),
  Object.freeze({ value: 'carton', label: 'Carton' }),
  Object.freeze({ value: 'ops', label: 'Ops' }),
  Object.freeze({ value: 'hifi', label: 'Hi-Fi' }),
]);

export const CARGO_CATEGORY_MARKING_OPTIONS = Object.freeze([
  Object.freeze({ value: 'minimal', label: 'Minimal' }),
  Object.freeze({ value: 'edge', label: 'Edge' }),
  Object.freeze({ value: 'panel', label: 'Panel' }),
  Object.freeze({ value: 'operational', label: 'Operational' }),
  Object.freeze({ value: 'fullcolor', label: 'Full Category Color' }),
]);

/** @type {Set<string>} */
const BODY_STYLES = new Set(CARGO_BODY_STYLE_OPTIONS.map(option => option.value));
/** @type {Set<string>} */
const CATEGORY_MARKINGS = new Set(CARGO_CATEGORY_MARKING_OPTIONS.map(option => option.value));

/** @param {unknown} value */
export function normalizeCargoBodyStyle(value) {
  const normalized = String(value || '').toLowerCase();
  return BODY_STYLES.has(normalized) ? normalized : 'cad';
}

/** @param {unknown} value */
export function normalizeCargoCategoryMarking(value) {
  const normalized = String(value || '').toLowerCase();
  return CATEGORY_MARKINGS.has(normalized) ? normalized : 'edge';
}

/**
 * @param {Record<string, any> | null | undefined} preferences
 */
export function resolveCargoVisualPreferences(preferences) {
  const prefs = preferences && typeof preferences === 'object' ? preferences : {};
  return {
    bodyStyle: normalizeCargoBodyStyle(prefs.cargoBodyStyle),
    categoryMarking: normalizeCargoCategoryMarking(prefs.cargoCategoryMarking),
  };
}

/**
 * Material values are consumed by CaseScene's existing per-instance material creation.
 * They intentionally contain no renderer, scene, geometry, or resource ownership.
 * @param {unknown} bodyStyle
 */
export function getCargoMaterialOptions(bodyStyle) {
  const style = normalizeCargoBodyStyle(bodyStyle);
  const options = {
    cad: { materialType: 'standard', roughness: 0.82, metalness: 0.06, envMapIntensity: 0.32 },
    carton: { materialType: 'standard', roughness: 0.96, metalness: 0, envMapIntensity: 0.16 },
    ops: { materialType: 'standard', roughness: 0.74, metalness: 0.12, envMapIntensity: 0.28 },
    hifi: {
      materialType: 'physical',
      roughness: 0.52,
      metalness: 0.38,
      envMapIntensity: 0.48,
      clearcoat: 0.16,
      clearcoatRoughness: 0.48,
    },
  };
  return { ...options[style] };
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {unknown} value */
function parseHexColor(value) {
  let hex = String(value || '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    hex = hex
      .split('')
      .map(char => char + char)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) hex = '9ca3af';
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** @param {number[]} rgb */
function rgbToHex(rgb) {
  return `#${rgb.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** @param {unknown} color @param {number[]} target @param {number} amount */
function mixColor(color, target, amount) {
  const source = parseHexColor(color);
  return rgbToHex(source.map((value, index) => value + (target[index] - value) * amount));
}

/** @param {unknown} color */
function relativeLuminance(color) {
  const channels = parseHexColor(color).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** @param {string} seed */
function seededRandom(seed) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {Array<[number, string]>} stops
 * @param {string} fallback
 */
function linearFill(ctx, x0, y0, x1, y1, stops, fallback) {
  if (typeof ctx.createLinearGradient !== 'function') return fallback;
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}

/** @param {CanvasRenderingContext2D} ctx @param {number} width @param {number} height */
function paintCadBody(ctx, width, height) {
  ctx.fillStyle = linearFill(
    ctx,
    0,
    0,
    width,
    height,
    [
      [0, '#e0e2e5'],
      [0.55, '#d3d6da'],
      [1, '#c5c8cd'],
    ],
    '#d4d7db'
  );
  ctx.fillRect(0, 0, width, height);
  const inset = clamp(Math.min(width, height) * 0.04, 3, 12);
  ctx.strokeStyle = 'rgba(25,28,32,0.24)';
  ctx.lineWidth = clamp(Math.min(width, height) * 0.007, 1, 2.5);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  const rivetRadius = clamp(Math.min(width, height) * 0.012, 1.25, 3.5);
  const rivetInset = inset * 1.65;
  const corners = [
    [rivetInset, rivetInset],
    [width - rivetInset, rivetInset],
    [rivetInset, height - rivetInset],
    [width - rivetInset, height - rivetInset],
  ];
  corners.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, rivetRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(33,36,41,0.32)';
    ctx.fill();
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} faceIndex
 * @param {string} seed
 */
function paintCartonBody(ctx, width, height, faceIndex, seed) {
  ctx.fillStyle = linearFill(
    ctx,
    0,
    0,
    width,
    height,
    [
      [0, '#c39a68'],
      [0.5, '#b98e5c'],
      [1, '#aa7f50'],
    ],
    '#b98e5c'
  );
  ctx.fillRect(0, 0, width, height);

  const random = seededRandom(`${seed}:carton:${faceIndex}:${width}x${height}`);
  const fibers = clamp(Math.floor((width * height) / 1800), 12, 150);
  ctx.lineWidth = 1;
  for (let index = 0; index < fibers; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 1 + random() * clamp(Math.min(width, height) * 0.035, 2, 7);
    ctx.strokeStyle = `rgba(73,48,25,${(0.035 + random() * 0.055).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (random() - 0.5) * 1.5);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(67,43,22,0.055)';
  ctx.lineWidth = 1;
  const corrugationGap = clamp(height / 14, 5, 22);
  for (let y = corrugationGap; y < height; y += corrugationGap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const tapeColor = 'rgba(211,190,143,0.64)';
  const tapeEdge = 'rgba(91,68,40,0.2)';
  if (faceIndex === 2 || faceIndex === 3) {
    const tapeHeight = clamp(height * 0.13, 5, 26);
    const y = height / 2 - tapeHeight / 2;
    ctx.fillStyle = tapeColor;
    ctx.fillRect(0, y, width, tapeHeight);
    ctx.strokeStyle = tapeEdge;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.moveTo(0, y + tapeHeight);
    ctx.lineTo(width, y + tapeHeight);
    ctx.stroke();
  } else {
    const tapeWidth = clamp(width * 0.115, 5, 26);
    const x = width / 2 - tapeWidth / 2;
    ctx.fillStyle = tapeColor;
    ctx.fillRect(x, 0, tapeWidth, height);
    ctx.strokeStyle = tapeEdge;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.moveTo(x + tapeWidth, 0);
    ctx.lineTo(x + tapeWidth, height);
    ctx.stroke();
  }

  ctx.fillStyle = linearFill(
    ctx,
    0,
    0,
    0,
    height,
    [
      [0, 'rgba(255,255,255,0.035)'],
      [0.7, 'rgba(0,0,0,0)'],
      [1, 'rgba(38,22,10,0.12)'],
    ],
    'rgba(38,22,10,0.045)'
  );
  ctx.fillRect(0, 0, width, height);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} width @param {number} height */
function paintOpsBody(ctx, width, height) {
  ctx.fillStyle = linearFill(
    ctx,
    0,
    0,
    width,
    height,
    [
      [0, '#34383d'],
      [0.55, '#292d32'],
      [1, '#202328'],
    ],
    '#292d32'
  );
  ctx.fillRect(0, 0, width, height);
  const inset = clamp(Math.min(width, height) * 0.035, 2, 9);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  const ribGap = clamp(height * 0.11, 6, 24);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  for (let y = inset + ribGap; y < height - inset; y += ribGap) {
    ctx.beginPath();
    ctx.moveTo(inset * 1.6, y);
    ctx.lineTo(width - inset * 1.6, y);
    ctx.stroke();
  }
  const latchWidth = clamp(Math.min(width, height) * 0.055, 3, 11);
  const latchHeight = latchWidth * 2.5;
  [width * 0.07, width * 0.93].forEach(x => {
    ctx.fillStyle = 'rgba(5,6,8,0.38)';
    ctx.fillRect(x - latchWidth / 2, height / 2 - latchHeight / 2, latchWidth, latchHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.strokeRect(x - latchWidth / 2, height / 2 - latchHeight / 2, latchWidth, latchHeight);
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} faceIndex
 * @param {string} seed
 */
function paintHifiBody(ctx, width, height, faceIndex, seed) {
  ctx.fillStyle = linearFill(
    ctx,
    0,
    0,
    width,
    height,
    [
      [0, '#555a61'],
      [0.42, '#3c4148'],
      [1, '#292d33'],
    ],
    '#3c4148'
  );
  ctx.fillRect(0, 0, width, height);
  const random = seededRandom(`${seed}:hifi:${faceIndex}:${width}x${height}`);
  const strokes = clamp(Math.floor((width + height) / 14), 8, 40);
  ctx.lineWidth = 0.75;
  for (let index = 0; index < strokes; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 4 + random() * clamp(width * 0.08, 5, 22);
    ctx.strokeStyle = `rgba(255,255,255,${(0.018 + random() * 0.025).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(Math.min(width, x + length), y + length * 0.08);
    ctx.stroke();
  }

  const inset = clamp(Math.min(width, height) * 0.075, 4, 18);
  ctx.fillStyle = linearFill(
    ctx,
    inset,
    inset,
    inset,
    height - inset,
    [
      [0, 'rgba(255,255,255,0.08)'],
      [0.2, 'rgba(255,255,255,0.015)'],
      [1, 'rgba(0,0,0,0.2)'],
    ],
    'rgba(0,0,0,0.08)'
  );
  ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.strokeStyle = 'rgba(8,10,13,0.42)';
  ctx.lineWidth = clamp(Math.min(width, height) * 0.008, 1, 3);
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const corner = clamp(Math.min(width, height) * 0.14, 6, 26);
  const cornerFill = linearFill(
    ctx,
    0,
    0,
    corner,
    corner,
    [
      [0, '#777c83'],
      [0.5, '#555a61'],
      [1, '#3f444b'],
    ],
    '#5a5f66'
  );
  ctx.fillStyle = cornerFill;
  [
    [0, 0],
    [width - corner, 0],
    [0, height - corner],
    [width - corner, height - corner],
  ].forEach(([x, y]) => {
    ctx.fillRect(x, y, corner, corner);
    ctx.strokeStyle = 'rgba(8,10,13,0.34)';
    ctx.strokeRect(x + 0.5, y + 0.5, corner - 1, corner - 1);
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} color
 */
function applyFullCategoryTint(ctx, width, height, color) {
  ctx.save();
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {boolean} flipX
 * @param {boolean} flipY
 * @param {string} color
 */
function drawCornerTriangle(ctx, x, y, size, flipX, flipY, color) {
  const dx = flipX ? -size : size;
  const dy = flipY ? -size : size;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y);
  ctx.lineTo(x, y + dy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.24)';
  ctx.lineWidth = clamp(size * 0.05, 0.75, 1.5);
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} marking
 * @param {string} color
 */
function paintCategoryMarking(ctx, width, height, marking, color) {
  if (marking === 'fullcolor') {
    applyFullCategoryTint(ctx, width, height, color);
    return;
  }
  const minimum = Math.min(width, height);
  if (marking === 'minimal') {
    const radius = clamp(minimum * 0.042, 2, 7);
    ctx.beginPath();
    ctx.arc(width - radius * 2.2, radius * 2.2, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.86;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  if (marking === 'edge') {
    const size = clamp(minimum * 0.085, 4, 18);
    const margin = clamp(minimum * 0.018, 1, 4);
    drawCornerTriangle(ctx, margin, margin, size, false, false, color);
    drawCornerTriangle(ctx, width - margin, margin, size, true, false, color);
    drawCornerTriangle(ctx, margin, height - margin, size, false, true, color);
    drawCornerTriangle(ctx, width - margin, height - margin, size, true, true, color);
    return;
  }
  if (marking === 'panel') {
    const panelWidth = clamp(width * 0.09, 4, Math.min(30, width * 0.18));
    const fill = linearFill(
      ctx,
      0,
      0,
      0,
      height,
      [
        [0, mixColor(color, [255, 255, 255], 0.12)],
        [0.5, color],
        [1, mixColor(color, [0, 0, 0], 0.22)],
      ],
      color
    );
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, panelWidth, height);
    ctx.fillRect(width - panelWidth, 0, panelWidth, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelWidth, 0);
    ctx.lineTo(panelWidth, height);
    ctx.moveTo(width - panelWidth, 0);
    ctx.lineTo(width - panelWidth, height);
    ctx.stroke();
    return;
  }
  if (marking === 'operational') {
    const bandHeight = clamp(height * 0.13, 5, 30);
    ctx.fillStyle = linearFill(
      ctx,
      0,
      0,
      0,
      bandHeight,
      [
        [0, mixColor(color, [255, 255, 255], 0.12)],
        [1, mixColor(color, [0, 0, 0], 0.08)],
      ],
      color
    );
    ctx.fillRect(0, 0, width, bandHeight);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, Math.max(0, bandHeight - 1.5), width, 1.5);
    const flagWidth = clamp(minimum * 0.13, 5, 20);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(flagWidth, 0);
    ctx.lineTo(0, Math.min(height, bandHeight * 1.55));
    ctx.closePath();
    ctx.fillStyle = mixColor(color, [0, 0, 0], 0.28);
    ctx.fill();
  }
}

/**
 * Paints only presentation pixels into an existing cache-owned face canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ width: number, height: number, faceIndex: number, bodyStyle: unknown, categoryMarking: unknown, categoryColor: unknown, seed?: unknown }} input
 */
export function paintCargoFaceTexture(ctx, input) {
  const width = Math.max(1, Number(input.width) || 1);
  const height = Math.max(1, Number(input.height) || 1);
  const faceIndex = Number(input.faceIndex) || 0;
  const bodyStyle = normalizeCargoBodyStyle(input.bodyStyle);
  const categoryMarking = normalizeCargoCategoryMarking(input.categoryMarking);
  const categoryColor = rgbToHex(parseHexColor(input.categoryColor));
  const seed = String(input.seed || 'cargo');

  if (bodyStyle === 'carton') paintCartonBody(ctx, width, height, faceIndex, seed);
  else if (bodyStyle === 'ops') paintOpsBody(ctx, width, height);
  else if (bodyStyle === 'hifi') paintHifiBody(ctx, width, height, faceIndex, seed);
  else paintCadBody(ctx, width, height);
  paintCategoryMarking(ctx, width, height, categoryMarking, categoryColor);
}

/**
 * Current baked labels keep their existing content/placement and only adapt ink contrast.
 * @param {unknown} bodyStyle
 * @param {unknown} categoryMarking
 * @param {unknown} categoryColor
 */
export function getCargoLabelInk(bodyStyle, categoryMarking, categoryColor) {
  const style = normalizeCargoBodyStyle(bodyStyle);
  const marking = normalizeCargoCategoryMarking(categoryMarking);
  if (marking === 'fullcolor') return relativeLuminance(categoryColor) < 0.34 ? '#f6f7f8' : '#111318';
  return style === 'ops' || style === 'hifi' ? '#f6f7f8' : '#111318';
}

/**
 * @param {unknown} bodyStyle
 * @param {unknown} categoryMarking
 * @param {unknown} categoryColor
 */
export function getCargoEdgeColor(bodyStyle, categoryMarking, categoryColor) {
  const style = normalizeCargoBodyStyle(bodyStyle);
  const marking = normalizeCargoCategoryMarking(categoryMarking);
  if (marking === 'fullcolor') return mixColor(categoryColor, [0, 0, 0], 0.5);
  const colors = { cad: '#4d5259', carton: '#664a2f', ops: '#111418', hifi: '#20242a' };
  return colors[style];
}
