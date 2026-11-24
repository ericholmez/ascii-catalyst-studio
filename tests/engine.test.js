import test from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/engine/convert.js';
import { adjustImage, extractImagePalette } from '../src/engine/adjust.js';
import { DEFAULT_PALETTE, extractPalette, parsePalette } from '../src/engine/palette.js';
import { normalizeMaskStrokes, sampleMaskAlpha } from '../src/engine/paint-mask.js';
import { perspectiveMatrix, perspectiveSize, projectPoint, validPerspective, warpPerspective } from '../src/engine/perspective.js';
import { glyphOrientation, PATCH_W, PATCH_H } from '../src/engine/glyphs.js';
import { braille, cropRect, gridSize, linear, luminance, nearestPalette, randomAt } from '../src/engine/math.js';
import { artworkText, encodeCp437, escapeMarkup, exportArtwork } from '../src/engine/export.js';
import { cleanGlyphs, DEFAULTS, normalizeSettings, PRESETS, varySettings } from '../src/engine/settings.js';
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
  assert.equal(project.settings.contrastPivot, 50);
  assert.equal(project.settings.posterize, 0);
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

const adjusted = (source, w, h, patch = {}) => adjustImage(source, w, h,
  normalizeSettings({ ...DEFAULTS, contrast: 0, ...patch }));

test('contrast pivot and separate tonal ranges change the intended samples', () => {
  const ramp = Uint8ClampedArray.from([40, 127, 225].flatMap((value) => gray(value)));
  const redValues = (data) => [data[0], data[4], data[8]];
  const lift = redValues(adjusted(ramp, 3, 1, { shadows: 50 }).colors);
  const mids = redValues(adjusted(ramp, 3, 1, { midtones: 50 }).colors);
  const pull = redValues(adjusted(ramp, 3, 1, { highlights: -50 }).colors);
  assert.ok(lift[0] - 40 > lift[2] - 225);
  assert.ok(mids[1] - 127 > mids[0] - 40 && mids[1] - 127 > mids[2] - 225);
  assert.ok(225 - pull[2] > 40 - pull[0]);
  assert.ok(adjusted(ramp, 3, 1, { contrast: 70, contrastPivot: 20 }).colors[4] >
    adjusted(ramp, 3, 1, { contrast: 70, contrastPivot: 80 }).colors[4]);
  assert.deepEqual([...ramp], [40, 127, 225].flatMap((value) => gray(value)));
});

test('softening and detail move edge contrast opposite ways without bleeding into transparency', () => {
  const edge = Uint8ClampedArray.from([100, 100, 100, 100, 175, 175, 175, 175].flatMap((value) => gray(value)));
  const soft = adjusted(edge, 8, 1, { soften: 100 }).colors;
  const sharp = adjusted(edge, 8, 1, { detail: 50 }).colors;
  assert.ok(soft[12] > 100 && soft[16] < 175);
  assert.ok(sharp[12] < 100 && sharp[16] > 175);
  const alpha = Uint8ClampedArray.from([...gray(255, 0), ...gray(80), ...gray(255, 0)]);
  assert.deepEqual([...adjusted(alpha, 3, 1, { soften: 100 }).colors], [0, 0, 0, 0, 80, 80, 80, 255, 0, 0, 0, 0]);
});

test('grain repeats by seed, posterization limits levels, and threshold produces black and white', () => {
  const input = Uint8ClampedArray.from(Array.from({ length: 256 }, (_, n) => gray(n)).flat());
  const grain = (seed) => adjusted(input, 16, 16, { grain: 70, seed }).colors;
  assert.deepEqual(grain(25), grain(25));
  assert.notDeepEqual(grain(25), grain(26));
  const { colors } = adjusted(input, 16, 16, { posterize: 4 });
  assert.deepEqual([...new Set(colors.filter((_, i) => i % 4 === 0))], [0, 85, 170, 255]);
  const { histogram } = adjusted(input, 16, 16, { hardThreshold: true, cutoff: 60 });
  assert.equal(histogram[0] + histogram[255], 256);
  assert.ok(histogram[0] > histogram[255]);
});

test('white balance and duotone affect output and the adjusted image is provided on request', () => {
  const white = Uint8ClampedArray.from(gray(128));
  const warm = adjusted(white, 1, 1, { temperature: 50 }).colors;
  assert.ok(warm[0] > warm[2]);
  const source = pixels(1, 1, (_, y) => gray(y < 4 ? 0 : 255));
  const settings = { contrast: 0, mode: 'half', color: 'duotone', lowInk: '#223344', highInk: '#aaccee' };
  const art = convert(source, 1, 1, atlas, settings, { preview: true });
  assert.ok(art.processed instanceof Uint8ClampedArray);
  assert.deepEqual([...art.foreground], [34, 51, 68, 255]);
  assert.deepEqual([...art.background], [170, 204, 238, 255]);
  assert.equal(convert(source, 1, 1, atlas, settings).processed, null);
});

test('style variations repeat from the same state, advance the seed and preserve framing', () => {
  const original = { ...DEFAULTS, columns: 216, rotation: 90 };
  const first = varySettings(original);
  assert.deepEqual(first, varySettings(original));
  const next = normalizeSettings({ ...original, ...first });
  assert.equal(next.seed, original.seed + 1);
  assert.equal(next.columns, 216);
  assert.equal(next.rotation, 90);
  assert.notDeepEqual(first, varySettings(next));
  const names = PRESETS.map(([name]) => name);
  assert.equal(names.length, 18);
  assert.equal(new Set(names).size, names.length);
});

test('crops stay inside the original and control both upright and rotated grid proportions', () => {
  const s = normalizeSettings({ columns: 100, cropX: 75, cropY: 25, cropWidth: 90, cropHeight: 100 });
  assert.deepEqual(cropRect(800, 400, s), { x: 600, y: 100, width: 200, height: 300 });
  assert.deepEqual(gridSize(800, 400, 10, 20, s), { cols: 100, rows: 75 });
  assert.deepEqual(gridSize(800, 400, 10, 20, { ...s, rotation: 90 }), { cols: 100, rows: 33 });
  assert.deepEqual(cropRect(1, 1, { ...s, cropX: 99, cropY: 99 }), { x: 0, y: 0, width: 1, height: 1 });
});

test('tone curves interpolate between editable levels with a neutral default', () => {
  const source = Uint8ClampedArray.from([0, 32, 64, 128, 255].flatMap((n) => gray(n)));
  assert.deepEqual(adjusted(source, 5, 1).colors, source);
  const edited = adjusted(source, 5, 1, { curve25: 50 }).colors;
  assert.deepEqual([edited[0], edited[4], edited[8], edited[12], edited[16]], [0, 64, 128, 128, 255]);
});

test('luminance masks feather and invert without replacing original alpha', () => {
  const source = Uint8ClampedArray.from([...gray(10), ...gray(128, 180), ...gray(250)]);
  const keep = { maskMode: 'highlights', maskThreshold: 50, maskFeather: 20 };
  const mask = adjusted(source, 3, 1, keep);
  assert.deepEqual([mask.colors[3], mask.colors[7], mask.colors[11]], [0, 93, 255]);
  const invert = adjusted(source, 3, 1, { ...keep, maskInvert: true });
  assert.deepEqual([invert.colors[3], invert.colors[7], invert.colors[11]], [255, 87, 0]);
  assert.equal(mask.light[0], 0);
  assert.equal(mask.histogram[10], 0);
});

test('a colour key measures ungraded RGB and removes exact matches at zero tolerance', () => {
  const source = Uint8ClampedArray.from([255, 0, 0, 255, 250, 0, 0, 255, 0, 0, 255, 255]);
  const key = { maskMode: 'colour', maskColor: '#ff0000', maskTolerance: 0, maskFeather: 0, invert: true };
  assert.deepEqual([3, 7, 11].map((p) => adjusted(source, 3, 1, key).colors[p]), [0, 255, 255]);
  const feathered = adjusted(source, 3, 1, { ...key, maskFeather: 5 });
  assert.ok(feathered.colors[7] > 0 && feathered.colors[7] < 255);
  assert.equal(feathered.colors[11], 255);
});

test('perspective validates clockwise convex corners and maps the four rectangle corners', () => {
  const points = [.2, .1, .75, .25, .9, .85, .1, .7];
  assert.ok(validPerspective(points));
  assert.equal(validPerspective([.2, .1, .9, .85, .75, .25, .1, .7]), false);
  assert.equal(validPerspective([0, 0, 1, 0, 1, 0, 0, 1]), false);
  const matrix = perspectiveMatrix(points);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], corner) => {
    const [u, v] = projectPoint(matrix, x, y);
    assert.ok(Math.abs(u - points[corner * 2]) < 1e-9);
    assert.ok(Math.abs(v - points[corner * 2 + 1]) < 1e-9);
  });
  assert.equal(normalizeSettings({ perspective: [0, 0, 1, 1, 1, 0, 0, 1] }).perspective, null);
  assert.deepEqual(normalizeSettings({ perspective: points }).perspective, points);
});

test('rectification respects sampled alpha and feeds crop proportions into the grid', () => {
  const identity = [0, 0, 1, 0, 1, 1, 0, 1];
  const source = Uint8ClampedArray.from([255, 0, 0, 0, 0, 0, 255, 255]);
  assert.deepEqual([...warpPerspective(source, 2, 1, 1, 1, identity)], [0, 0, 255, 128]);
  assert.deepEqual([...warpPerspective(source, 2, 1, 2, 1, identity)], [0, 0, 0, 0, 0, 0, 255, 255]);
  const perspective = [.25, .25, .75, .25, .75, .75, .25, .75];
  assert.deepEqual(perspectiveSize(800, 400, perspective), { width: 400, height: 200 });
  const settings = normalizeSettings({ columns: 100, perspective, cropWidth: 50 });
  assert.deepEqual(gridSize(800, 400, 10, 20, settings), { cols: 100, rows: 50 });
});

test('median cleanup removes an isolated speckle and preserves source alpha', () => {
  const source = Uint8ClampedArray.from([30, 30, 30, 30, 240, 30, 30, 30, 30]
    .flatMap((value, i) => gray(value, i === 4 ? 128 : 255)));
  const result = adjusted(source, 3, 3, { denoise: 100 }).colors;
  assert.deepEqual([...result.subarray(16, 20)], [30, 30, 30, 128]);
  assert.equal(source[16], 240);
});

test('pixelation alpha-weights block colour and keeps partial and transparent pixels', () => {
  const source = Uint8ClampedArray.from([230, 0, 0, 0, 100, 50, 0, 255, 0, 150, 200, 128]);
  const result = adjusted(source, 3, 1, { pixelSize: 3 }).colors;
  assert.deepEqual([...result], [0, 0, 0, 0, 67, 83, 67, 255, 67, 83, 67, 128]);
});

test('painted mask coordinates follow crop, rotation, flip and perspective', () => {
  const source = Uint8ClampedArray.from([0, 80, 160, 255].flatMap((alpha) => gray(255, alpha)));
  const sample = (w, h, settings) => [...sampleMaskAlpha(source, 2, 2, w, h, 2, 2, normalizeSettings(settings))];
  assert.deepEqual(sample(2, 2, {}), [0, 80, 160, 255]);
  assert.deepEqual(sample(2, 2, { rotation: 90 }), [160, 0, 255, 80]);
  assert.deepEqual(sample(2, 2, { flipX: true }), [80, 0, 255, 160]);
  assert.deepEqual(sample(1, 2, { cropX: 50, cropWidth: 50 }), [80, 255]);
  assert.deepEqual(sample(1, 2, { perspective: [.5, 0, 1, 0, 1, 1, .5, 1] }), [80, 255]);
});

test('painted coverage combines with automatic masks and source alpha', () => {
  const source = Uint8ClampedArray.from([...gray(20), ...gray(180, 128), ...gray(200, 255)]);
  const mask = Uint8ClampedArray.from([255, 128, 0]);
  const settings = normalizeSettings({ contrast: 0, maskMode: 'highlights', maskThreshold: 50, maskFeather: 0 });
  const { colors, histogram } = adjustImage(source, 3, 1, settings, mask);
  assert.deepEqual([colors[3], colors[7], colors[11]], [0, 64, 0]);
  assert.equal(histogram[180], 1);
  assert.equal(histogram[200], 0);
  const art = convert(pixels(1, 1, () => gray(255)), 1, 1, atlas, { mode: 'tonal' },
    { paintedMask: new Uint8ClampedArray(PATCH_W * PATCH_H), preview: true });
  assert.equal(artworkText(art), ' ');
  assert.equal(art.processed[3], 0);
});

test('project files validate painted masks and preserve the bypass switch', () => {
  const stroke = { mode: 'hide', size: 85, hardness: -10, points: [-.2, .35, 1.2, .9] };
  assert.deepEqual(normalizeMaskStrokes([stroke, { mode: 'restore', points: [0] }]),
    [{ mode: 'hide', size: 60, hardness: 0, points: [0, .35, 1, .9] }]);
  const old = validateProject({ format: 'ASCII-CATALYST', version: 1 });
  assert.deepEqual(old.maskStrokes, []);
  assert.equal(old.paintMaskEnabled, true);
  const restored = validateProject({ format: 'ASCII-CATALYST', version: 1, maskStrokes: [stroke], paintMaskEnabled: false });
  assert.equal(restored.maskStrokes.length, 1);
  assert.equal(restored.paintMaskEnabled, false);
});

test('palette extraction is deterministic and alpha weighted', () => {
  const pixels = Uint8ClampedArray.from([255, 0, 0, 0, 16, 24, 32, 255, 23, 31, 39, 1, 210, 180, 120, 255]);
  assert.deepEqual(extractPalette(pixels, 4), ['#101820', '#d2b478']);
  assert.deepEqual(extractPalette(pixels, 1), ['#71664c']);
  assert.deepEqual(extractPalette(new Uint8ClampedArray(4), 6), []);
  assert.deepEqual(extractPalette(pixels, 4), extractPalette(pixels, 4));
});

test('source palette extraction only includes pixels visible after preparation', () => {
  const pixels = Uint8ClampedArray.from([20, 40, 70, 255, 160, 100, 50, 255]);
  const settings = normalizeSettings({ contrast: 0, invert: true });
  const mask = Uint8ClampedArray.from([255, 0]);
  assert.deepEqual(extractImagePalette(pixels, 2, 1, settings, mask, 6), ['#ebd7b9']);
});

test('custom palette restricts both half-block colours to exact swatches', () => {
  const source = pixels(1, 1, (_, y) => y < 4 ? [20, 30, 70, 255] : [240, 210, 130, 255]);
  const art = convert(source, 1, 1, atlas,
    { contrast: 0, mode: 'half', color: 'palette', palette: ['#121d45', '#eacf80'] });
  assert.deepEqual([...art.foreground], [18, 29, 69, 255]);
  assert.deepEqual([...art.background], [234, 207, 128, 255]);
});

test('HEX lists validate their length and round-trip through projects', async () => {
  const palette = parsePalette('ABC, #102030\n#fEd');
  assert.deepEqual(palette, ['#aabbcc', '#102030', '#ffeedd']);
  assert.throws(() => parsePalette('#123 red'), /HEX colours/);
  assert.throws(() => parsePalette(Array(17).fill('#fff').join(' ')), /1 to 16/);
  const old = validateProject({ format: 'ASCII-CATALYST', version: 1 });
  assert.deepEqual(old.settings.palette, DEFAULT_PALETTE);
  const project = { format: 'ASCII-CATALYST', version: 1, settings: { color: 'palette', palette } };
  const restored = validateProject(JSON.parse(await serializeProject(project)));
  assert.deepEqual(restored.settings.palette, palette);
});
