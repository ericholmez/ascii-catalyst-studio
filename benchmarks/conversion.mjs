import { convert } from '../src/engine/convert.js';
import { glyphOrientation, PATCH_SIZE, PATCH_W, PATCH_H } from '../src/engine/glyphs.js';

const cols = 160, rows = 72;
const width = cols * PATCH_W, height = rows * PATCH_H;
const source = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const tone = 127 + Math.sin(x * .031) * Math.cos(y * .044) * 127;
    source.set([tone, tone, tone, 255], (y * width + x) * 4);
  }
}
const atlas = {
  entries: [...' .:-+=*x#@'].map((glyph, order) => {
    const mask = Float32Array.from({ length: PATCH_SIZE }, (_, i) => Number((i * 13 + order * 7) % 32 < order * 3));
    return { glyph, mask, density: mask.reduce((a, b) => a + b) / PATCH_SIZE, orientation: glyphOrientation(mask) };
  }),
};
for (const mode of ['tonal', 'density', 'edges', 'structure', 'hybrid', 'braille']) {
  const runs = Array.from({ length: 5 }, () => convert(source, cols, rows, atlas, { mode }).duration)
    .sort((a, b) => a - b);
  console.log(mode.padEnd(10) + runs[2].toFixed(1).padStart(7) + ' ms median, ' + cols * rows + ' cells');
}
