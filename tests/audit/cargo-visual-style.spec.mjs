import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { defaultPreferences } from '../../src/core/defaults.js';
import { normalizePreferences } from '../../src/core/normalizer.js';
import {
  CARGO_BODY_STYLE_OPTIONS,
  CARGO_CATEGORY_MARKING_OPTIONS,
  getCargoEdgeColor,
  getCargoLabelInk,
  getCargoMaterialOptions,
  paintCargoFaceTexture,
  resolveCargoVisualPreferences,
} from '../../src/editor/cargo-visual-style.js';

function makeCanvasContext() {
  const operations = [];
  let composite = 'source-over';
  const context = {
    operations,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    beginPath() {
      operations.push(['beginPath']);
    },
    closePath() {
      operations.push(['closePath']);
    },
    moveTo(x, y) {
      operations.push(['moveTo', x, y]);
    },
    lineTo(x, y) {
      operations.push(['lineTo', x, y]);
    },
    arc(x, y, radius) {
      operations.push(['arc', x, y, radius]);
    },
    fill() {
      operations.push(['fill', this.fillStyle, this.globalAlpha]);
    },
    stroke() {
      operations.push(['stroke', this.strokeStyle, this.lineWidth]);
    },
    fillRect(x, y, width, height) {
      operations.push(['fillRect', this.fillStyle, this.globalAlpha, x, y, width, height]);
    },
    strokeRect(x, y, width, height) {
      operations.push(['strokeRect', this.strokeStyle, x, y, width, height]);
    },
    save() {
      operations.push(['save']);
    },
    restore() {
      operations.push(['restore']);
    },
    createLinearGradient(x0, y0, x1, y1) {
      const stops = [];
      const gradient = {
        stops,
        addColorStop(offset, color) {
          stops.push([offset, color]);
        },
      };
      operations.push(['gradient', x0, y0, x1, y1, gradient]);
      return gradient;
    },
  };
  Object.defineProperty(context, 'globalCompositeOperation', {
    get() {
      return composite;
    },
    set(value) {
      composite = value;
      operations.push(['composite', value]);
    },
  });
  return context;
}

test('CARGO-VISUAL-TRIAL-1 body style and category marking normalize as independent axes', () => {
  const bodyStyles = CARGO_BODY_STYLE_OPTIONS.map(option => option.value);
  const markings = CARGO_CATEGORY_MARKING_OPTIONS.map(option => option.value);
  assert.deepEqual(bodyStyles, ['cad', 'carton', 'ops', 'hifi']);
  assert.deepEqual(markings, ['minimal', 'edge', 'panel', 'operational', 'fullcolor']);

  for (const bodyStyle of bodyStyles) {
    for (const categoryMarking of markings) {
      assert.deepEqual(
        resolveCargoVisualPreferences({
          cargoBodyStyle: bodyStyle,
          cargoCategoryMarking: categoryMarking,
        }),
        {
          bodyStyle,
          categoryMarking,
        }
      );
    }
  }
  assert.deepEqual(resolveCargoVisualPreferences({ cargoBodyStyle: 'unknown', cargoCategoryMarking: 'stripe' }), {
    bodyStyle: 'cad',
    categoryMarking: 'edge',
  });
});

test('CARGO-VISUAL-TRIAL-1 legacy and invalid preference records receive safe CAD plus Edge defaults', () => {
  assert.equal(defaultPreferences.cargoBodyStyle, 'cad');
  assert.equal(defaultPreferences.cargoCategoryMarking, 'edge');
  assert.equal(normalizePreferences({}).cargoBodyStyle, 'cad');
  assert.equal(normalizePreferences({}).cargoCategoryMarking, 'edge');
  assert.equal(normalizePreferences({ cargoBodyStyle: 'OPS' }).cargoBodyStyle, 'ops');
  assert.equal(normalizePreferences({ cargoCategoryMarking: 'FULLCOLOR' }).cargoCategoryMarking, 'fullcolor');
  assert.equal(normalizePreferences({ cargoBodyStyle: 'plastic' }).cargoBodyStyle, 'cad');
  assert.equal(normalizePreferences({ cargoCategoryMarking: 'stripe' }).cargoCategoryMarking, 'edge');
});

test('CARGO-VISUAL-TRIAL-1 every body and marking combination paints through the canvas-only seam', () => {
  for (const { value: bodyStyle } of CARGO_BODY_STYLE_OPTIONS) {
    for (const { value: categoryMarking } of CARGO_CATEGORY_MARKING_OPTIONS) {
      const context = makeCanvasContext();
      paintCargoFaceTexture(context, {
        width: 160,
        height: 96,
        faceIndex: 4,
        bodyStyle,
        categoryMarking,
        categoryColor: '#3b82f6',
        seed: 'case-a',
      });
      assert.ok(
        context.operations.some(operation => operation[0] === 'fillRect'),
        `${bodyStyle} + ${categoryMarking} paints a body surface`
      );
      if (categoryMarking === 'fullcolor') {
        assert.ok(
          context.operations.some(operation => operation[0] === 'composite' && operation[1] === 'color'),
          `${bodyStyle} full color retains body luminance through a hue blend`
        );
      }
    }
  }
});

test('CARGO-VISUAL-TRIAL-1 material response and current-label contrast remain style-specific', () => {
  assert.deepEqual(getCargoMaterialOptions('cad'), {
    materialType: 'standard',
    roughness: 0.82,
    metalness: 0.06,
    envMapIntensity: 0.32,
  });
  assert.equal(getCargoMaterialOptions('carton').metalness, 0);
  assert.ok(getCargoMaterialOptions('carton').roughness > 0.9);
  assert.ok(getCargoMaterialOptions('ops').roughness > getCargoMaterialOptions('hifi').roughness);
  assert.equal(getCargoMaterialOptions('hifi').materialType, 'physical');
  assert.ok(
    getCargoMaterialOptions('hifi').clearcoat < 0.25,
    'Hi-Fi clearcoat stays restrained rather than reading as shiny plastic'
  );

  assert.equal(getCargoLabelInk('cad', 'edge', '#3b82f6'), '#111318');
  assert.equal(getCargoLabelInk('carton', 'operational', '#f59e0b'), '#111318');
  assert.equal(getCargoLabelInk('ops', 'edge', '#f59e0b'), '#f6f7f8');
  assert.equal(getCargoLabelInk('hifi', 'panel', '#f59e0b'), '#f6f7f8');
  assert.equal(getCargoLabelInk('cad', 'fullcolor', '#1d4ed8'), '#f6f7f8');
  assert.equal(getCargoLabelInk('cad', 'fullcolor', '#facc15'), '#111318');
  assert.equal(getCargoEdgeColor('cad', 'fullcolor', '#3b82f6'), '#1e417b');
});

test('CARGO-VISUAL-TRIAL-1 ports presentation logic without prototype scene ownership', async () => {
  const [styleSource, editorSource, settingsSource] = await Promise.all([
    readFile(new URL('../../src/editor/cargo-visual-style.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/screens/editor-screen.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/ui/overlays/settings-overlay.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(styleSource, /new\s+THREE\.(?:Scene|WebGLRenderer|PerspectiveCamera)/);
  assert.doesNotMatch(styleSource, /requestAnimationFrame|OrbitControls|localStorage/);
  assert.match(
    editorSource,
    /const textureCache = new Map\(\)/,
    'the existing CaseScene cache remains the texture owner'
  );
  assert.match(
    editorSource,
    /function getRaycastMeshes\(\)[\s\S]*group\.userData\.mesh/,
    'raycasting remains limited to the authoritative cargo mesh'
  );
  assert.match(settingsSource, /Cargo Visual Trial 1/);
  assert.match(settingsSource, /row\('Body Style', cargoBodyStyle\)/);
  assert.match(settingsSource, /row\('Category Marking', cargoCategoryMarking\)/);
});
