import test from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/engine/convert.js';
import { glyphOrientation, PATCH_W, PATCH_H } from '../src/engine/glyphs.js';
import { braille, gridSize, linear, luminance, nearestPalette, randomAt } from '../src/engine/math.js';
import { artworkText, encodeCp437, escapeMarkup, exportArtwork } from '../src/engine/export.js';
import { cleanGlyphs, DEFAULTS, normalizeSettings } from '../src/engine/settings.js';
import { normalizeEdits, serializeProject, validateProject } from '../src/project.js';

const shape = (predicate) => Float32Array.from({ length: PATCH_W * PATCH_H }, (_, i) =>
  Number(predicate(i % PATCH_W, Math.floor(i / PATCH_W))));
const entry = (glyph, mask) => ({
  glyph, mask, density: mask.reduce((sum, value) => sum + value, 0) / mask.length, orientation: glyphOrientation(mask),
});
const atlas = {
  entries: [entry(' ', shape(() => false)), entry('|', shape((x) => x === 1)),
    entry('-', shape((_, y) => y === 3)), entry('#', shape(() => true))],
};
const pixels = (cols, rows, fn) => {
  const width = cols * PATCH_W;
  const height = rows * PATCH_H;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fn(x, y, width, height), (y * width + x) * 4);
  }
  return data;
};
const gray = (n, a = 255) => [n, n, n, a];
const conversion = (source, cols, rows, settings, inspect) =>
  convert(source, cols, rows, atlas, { ...DEFAULTS, contrast: 0, ...settings }, { inspect });

test('linear light and weighted luminance retain reference values', () => {
  assert.equal(linear(1), 1);
  assert.ok(Math.abs(linear(.5) - .21404114048223255) < 1e-12);
  assert.equal(luminance(1, 0, 0, 'linear'), .2126);
  assert.equal(luminance(0, 1, 0), .7152);
  assert.equal(luminance(1, 0, 0, 'average'), 1 / 3);
});

test('grid dimensions preserve aspect ratio and respect portrait memory limits', () => {
  const s = { ...DEFAULTS, columns: 100 };
  assert.deepEqual(gridSize(800, 400, 10, 20, s), { cols: 100, rows: 25 });
  assert.deepEqual(gridSize(800, 400, 10, 20, { ...s, rotation: 90 }), { cols: 100, rows: 100 });
  assert.deepEqual(gridSize(800, 400, 10, 20, { ...s, lockAspect: false, rows: 70 }), { cols: 100, rows: 70 });
  assert.deepEqual(gridSize(800, 400, 10, 20, { ...s, quality: 'draft' }), { cols: 84, rows: 21 });
  const grid = gridSize(2, 18000, 11, 16, { ...s, columns: 480 });
  assert.equal(grid.cols * grid.rows, 115200);
});

test('tonal conversion follows polarity, ordering and alpha', () => {
  const source = pixels(3, 1, (x) => x < 4 ? gray(0) : x < 8 ? gray(255) : gray(255, 0));
  const light = conversion(source, 3, 1, { mode: 'tonal' });
  const dark = conversion(source, 3, 1, { mode: 'tonal', polarity: 'dark' });
  assert.equal(artworkText(light), ' # ');
  assert.equal(artworkText(dark), '#  ');
  assert.equal(light.occupied, 1);
  assert.deepEqual([...light.opacity], [255, 255, 0]);
});

test('font-aware selection sorts by actual measured coverage', () => {
  const mid = pixels(1, 1, () => gray(35));
  assert.equal(artworkText(conversion(mid, 1, 1, { mode: 'tonal' })), ' ');
  assert.equal(artworkText(conversion(mid, 1, 1, { mode: 'density' })), '-');
});

test('shape matcher distinguishes lines with different spatial structure', () => {
  const source = pixels(2, 1, (x, y) => gray((x < 4 ? x === 1 : y === 3) ? 255 : 0));
  const art = conversion(source, 2, 1, { mode: 'structure', shape: 100, edge: 50 }, 0);
  assert.equal(artworkText(art), '|-');
  assert.equal(art.diagnostic.glyph, '|');
  assert.equal(art.diagnostic.candidates[0].spatialError, 0);
  assert.ok(art.diagnostic.edgeStrength > 0);
});

test('all eight Braille positions map to the correct Unicode bit', () => {
  const bits = [1, 8, 2, 16, 4, 32, 64, 128];
  bits.forEach((bit, i) => {
    const dots = bits.map((_, j) => i === j);
    assert.equal(braille(dots).codePointAt(0), 0x2800 + bit);
  });
  const diagonal = pixels(1, 1, (x, y) => gray((x < 2 && y < 2) || (x >= 2 && y >= 6) ? 255 : 0));
  assert.equal(artworkText(conversion(diagonal, 1, 1, { mode: 'braille' })), '\u2881');
});

test('half blocks retain independent upper and lower colour samples', () => {
  const source = pixels(1, 1, (_, y) => y < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  const art = conversion(source, 1, 1, { mode: 'half', color: 'source' });
  assert.equal(artworkText(art), '▀');
  assert.deepEqual([...art.foreground], [255, 0, 0, 255]);
  assert.deepEqual([...art.background], [0, 0, 255, 255]);
});

test('dithering and dropout are deterministic and preserve flat levels over a grid', () => {
  const source = pixels(16, 16, () => gray(106));
  const diffuse = conversion(source, 16, 16, { mode: 'density', dither: 'floyd', intensity: 100 });
  const flat = conversion(source, 16, 16, { mode: 'density' });
  assert.notDeepEqual(diffuse.cells, flat.cells);
  const a = conversion(source, 16, 16, { mode: 'density', dither: 'random', seed: 564, dropout: 30 });
  const b = conversion(source, 16, 16, { mode: 'density', dither: 'random', seed: 564, dropout: 30 });
  assert.deepEqual(a.cells, b.cells);
  assert.notEqual(randomAt(50, 2), randomAt(50, 3));
});

test('ANSI palette matching and CP437 encodings identify the intended values', () => {
  assert.equal(nearestPalette(253, 0, 2), 9);
  assert.deepEqual([...encodeCp437('A░▓█▀\n╬')], [65, 176, 178, 219, 223, 13, 10, 206]);
  assert.throws(() => encodeCp437('⠀'), /cannot encode/);
});

test('text export preserves spaces, applies edits and rejects Unicode in strict mode', () => {
  const source = pixels(2, 2, (x, y) => gray(x < 4 && y < 8 ? 255 : 0));
  const art = conversion(source, 2, 2, { mode: 'tonal' });
  assert.equal(artworkText(art), '# \n  ');
  assert.equal(artworkText(art, { edits: { 3: 'A' } }), '# \n A');
  assert.equal(artworkText(art, { trim: true }), '#\n');
  assert.throws(() => artworkText(art, { edits: { 3: '▌' }, strict: true }), /non-ASCII/);
  assert.equal(escapeMarkup('<&"'), '&lt;&amp;&quot;');
});

test('exported SVG escapes artwork and JSON retains typed grid contents', async () => {
  const source = pixels(1, 1, () => gray(255));
  const art = conversion(source, 1, 1, { mode: 'tonal' });
  const metrics = { cellWidth: 8, cellHeight: 16, size: 14, weight: 400, family: 'monospace' };
  const opt = { edits: { 0: '<' }, margin: 0, scale: 2 };
  const svg = await exportArtwork(art, metrics, DEFAULTS, { ...opt, format: 'svg' });
  assert.match(await svg.text(), /width="16" height="32".*&lt;<\/text>/);
  const json = await exportArtwork(art, metrics, DEFAULTS, { ...opt, format: 'json' });
  assert.deepEqual(JSON.parse(await json.text()).cells, [...art.cells]);
});

test('project parsing validates format, ranges, glyphs and layers', async () => {
  const raw = {
    format: 'ASCII-CATALYST', version: 1, name: 'Fixture', settings: { columns: 1000, foreground: 'invalid' },
    edits: { 1: 'X', 2: '\r', 3: 'abc' }, layers: [{ blend: 'invalid', opacity: 900 }],
    source: { sample: 'Concrete Study' }, exportOptions: { margin: 20, trim: true },
  };
  const project = validateProject(JSON.parse(await serializeProject(raw)));
  assert.equal(project.settings.columns, 480);
  assert.equal(project.settings.foreground, DEFAULTS.foreground);
  assert.deepEqual(project.edits, { 1: 'X' });
  assert.deepEqual(project.source, raw.source);
  assert.equal(project.layers[0].opacity, 100);
  assert.equal(project.layers[0].blend, 'source-over');
  assert.equal(project.exportOptions.margin, 20);
  assert.throws(() => validateProject({ ...raw, version: 2 }), /version 1/);
  assert.deepEqual(cleanGlyphs('A\u200b\u0301\nB'), ['A', 'B']);
  assert.deepEqual(normalizeEdits({ 9999999: '@' }), {});
  assert.equal(normalizeSettings({ columns: NaN }).columns, DEFAULTS.columns);
});
