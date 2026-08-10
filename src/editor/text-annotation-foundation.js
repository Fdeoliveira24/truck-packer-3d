const DPR_BUCKETS = Object.freeze([1, 1.5, 2]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function resolveTextDprBucket(effectiveDpr = 1) {
  const dpr = Number.isFinite(Number(effectiveDpr)) ? Math.max(1, Number(effectiveDpr)) : 1;
  if (dpr < 1.25) return DPR_BUCKETS[0];
  if (dpr < 1.75) return DPR_BUCKETS[1];
  return DPR_BUCKETS[2];
}

export function resolveLabelTextScale(labelFontSize = 12) {
  return clamp((Number(labelFontSize) || 12) / 12, 0.75, 1.5);
}

function measureText(ctx, value, fontSize) {
  if (ctx && typeof ctx.measureText === 'function') return ctx.measureText(value).width;
  return String(value).length * fontSize * 0.58;
}

function ellipsize(ctx, value, maxWidth, fontSize) {
  const text = String(value || '');
  if (measureText(ctx, text, fontSize) <= maxWidth) return text;
  const suffix = '…';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureText(ctx, `${text.slice(0, middle).trimEnd()}${suffix}`, fontSize) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}${suffix}`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {unknown} value
 * @param {{ maxWidth?: number, maxLines?: number, fontSize?: number }} options
 */
export function layoutBoundedText(ctx, value, { maxWidth = 0, maxLines = 2, fontSize = 24 } = {}) {
  const fallback = 'Unnamed case';
  const text = String(value || '').trim() || fallback;
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(ctx, candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').replace(/…$/, '');
  if (consumed !== text || lines.some(line => measureText(ctx, line, fontSize) > maxWidth)) {
    const prefix = lines.slice(0, maxLines - 1);
    const remainingWords = words.slice(prefix.join(' ').split(/\s+/).filter(Boolean).length).join(' ');
    lines.length = 0;
    lines.push(...prefix, ellipsize(ctx, remainingWords, maxWidth, fontSize));
  }
  return lines.slice(0, maxLines);
}

function stableKey(input) {
  return JSON.stringify([
    input.content,
    input.logicalWidth,
    input.logicalHeight,
    input.fontScale,
    input.maxLines,
    input.alignment,
    input.foreground,
    input.background,
    input.border,
    input.accent,
    input.dprBucket,
  ]);
}

function normalizedInput(options = {}) {
  return {
    content: {
      name: String(options.content && options.content.name || '').trim() || 'Unnamed case',
      weight: String(options.content && options.content.weight || '').trim(),
      handling: String(options.content && options.content.handling || '').trim(),
      warning: String(options.content && options.content.warning || '').trim(),
    },
    logicalWidth: Math.round(clamp(Number(options.logicalWidth) || 320, 160, 512)),
    logicalHeight: Math.round(clamp(Number(options.logicalHeight) || 160, 96, 320)),
    fontScale: clamp(Number(options.fontScale) || 1, 0.75, 1.5),
    maxLines: Math.round(clamp(Number(options.maxLines) || 2, 1, 2)),
    alignment: options.alignment === 'center' ? 'center' : 'left',
    foreground: String(options.foreground || '#20262d'),
    background: String(options.background || '#f5f2e8'),
    border: String(options.border || '#737b82'),
    accent: String(options.accent || '#b45309'),
    dprBucket: resolveTextDprBucket(options.effectiveDpr),
  };
}

function drawLabelTexture(THREE, documentRef, input) {
  const canvas = documentRef.createElement('canvas');
  canvas.width = Math.round(input.logicalWidth * input.dprBucket);
  canvas.height = Math.round(input.logicalHeight * input.dprBucket);
  const ctx = canvas.getContext('2d');
  const scale = input.dprBucket;
  if (ctx && typeof ctx.scale === 'function') ctx.scale(scale, scale);
  const width = input.logicalWidth;
  const height = input.logicalHeight;
  const padding = Math.max(12, width * 0.045);
  const alignX = input.alignment === 'center' ? width / 2 : padding;
  const baseNameSize = clamp(height * 0.19 * input.fontScale, 18, height * 0.27);
  const secondarySize = clamp(height * 0.115 * input.fontScale, 13, height * 0.17);

  ctx.fillStyle = input.background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = input.border;
  ctx.lineWidth = Math.max(1, width * 0.006);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
  ctx.textAlign = input.alignment;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = input.foreground;
  ctx.font = `600 ${baseNameSize}px Arial, sans-serif`;
  const nameLines = layoutBoundedText(ctx, input.content.name, {
    maxWidth: width - padding * 2,
    maxLines: input.maxLines,
    fontSize: baseNameSize,
  });
  let y = padding + baseNameSize;
  for (const line of nameLines) {
    ctx.fillText(line, alignX, y, width - padding * 2);
    y += baseNameSize * 1.05;
  }
  ctx.font = `500 ${secondarySize}px Arial, sans-serif`;
  y = Math.max(y + secondarySize * 0.3, height * 0.68);
  if (input.content.weight) ctx.fillText(input.content.weight, alignX, y, width - padding * 2);
  const optional = input.content.warning || input.content.handling;
  if (optional) {
    ctx.fillStyle = input.content.warning ? input.accent : input.foreground;
    ctx.font = `600 ${secondarySize * 0.88}px Arial, sans-serif`;
    ctx.fillText(ellipsize(ctx, optional, width - padding * 2, secondarySize * 0.88), alignX, height - padding, width - padding * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.textLayout = { ...input, nameLines, optional };
  return texture;
}

/**
 * @param {{ THREE: any, documentRef?: Document }} options
 */
export function createTextTextureCache({ THREE, documentRef = globalThis.document }) {
  const entries = new Map();
  return {
    acquire(options) {
      const input = normalizedInput(options);
      const key = stableKey(input);
      const cached = entries.get(key);
      if (cached) {
        cached.count += 1;
        return { key, texture: cached.texture, input };
      }
      const texture = drawLabelTexture(THREE, documentRef, input);
      entries.set(key, { texture, count: 1 });
      return { key, texture, input };
    },
    release(key) {
      const cached = entries.get(key);
      if (!cached) return;
      cached.count -= 1;
      if (cached.count <= 0) {
        cached.texture.dispose();
        entries.delete(key);
      }
    },
    clear() {
      for (const cached of entries.values()) cached.texture.dispose();
      entries.clear();
    },
    get size() { return entries.size; },
  };
}

export function markAnnotationNoPick(object) {
  object.userData.pickable = false;
  object.userData.annotation = true;
  object.raycast = () => {};
  return object;
}

/**
 * @param {{ THREE: any, textureCache: any, content: object, fontScale?: number,
 *   effectiveDpr?: number, scale?: number, style?: object }} options
 */
export function createCameraFacingAnnotation({
  THREE,
  textureCache,
  content,
  fontScale = 1,
  effectiveDpr = 1,
  scale = 1,
  style = {},
}) {
  const acquired = textureCache.acquire({ content, fontScale, effectiveDpr, ...style });
  const material = new THREE.SpriteMaterial({ map: acquired.texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
  const sprite = markAnnotationNoPick(new THREE.Sprite(material));
  const boundedScale = clamp(Number(scale) || 1, 0.25, 4);
  sprite.scale.set(boundedScale * 2, boundedScale, 1);
  sprite.userData.textTextureKey = acquired.key;
  sprite.userData.release = () => {
    if (sprite.userData.released) return;
    sprite.userData.released = true;
    material.dispose();
    textureCache.release(acquired.key);
  };
  return sprite;
}
