import { cleanGlyphs, FONT_FAMILIES } from './settings.js';

export const PATCH_W = 4;
export const PATCH_H = 8;
export const PATCH_SIZE = PATCH_W * PATCH_H;
const cache = new Map();

export function orientation(xx, yy, xy) {
  const energy = xx + yy;
  if (energy < 1e-8) return [0, 0];
  return [(xx - yy) / energy, 2 * xy / energy];
}

export function glyphOrientation(mask) {
  let xx = 0, yy = 0, xy = 0;
  for (let y = 0; y < PATCH_H - 1; y++) {
    for (let x = 0; x < PATCH_W - 1; x++) {
      const i = y * PATCH_W + x;
      const gx = mask[i + 1] - mask[i];
      const gy = mask[i + PATCH_W] - mask[i];
      xx += gx * gx;
      yy += gy * gy;
      xy += gx * gy;
    }
  }
  return orientation(xx, yy, xy);
}

export function fontMetrics(settings) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family = FONT_FAMILIES[settings.font];
  const size = 16;
  ctx.font = settings.weight + ' ' + size + 'px ' + family;
  const advance = ctx.measureText('M').width;
  return {
    cellWidth: Math.max(4, advance + settings.spacing),
    cellHeight: size * settings.lineHeight,
    family, size, weight: settings.weight, advance,
  };
}

export function glyphAtlas(settings, metrics = fontMetrics(settings)) {
  const key = JSON.stringify([settings.ramp, metrics]);
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  const factor = 4;
  canvas.width = Math.ceil(metrics.cellWidth * factor);
  canvas.height = Math.ceil(metrics.cellHeight * factor);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.font = metrics.weight + ' ' + metrics.size * factor + 'px ' + metrics.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  const glyphs = [...new Set(cleanGlyphs(settings.ramp))].slice(0, 192);
  const entries = [];
  const rejected = [];
  for (const glyph of glyphs) {
    const m = ctx.measureText(glyph);
    if (glyph !== ' ' && Math.abs(m.width / factor - metrics.advance) > metrics.advance * .23) {
      rejected.push(glyph);
      continue;
    }
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillText(glyph, width / 2, height / 2);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const mask = new Float32Array(PATCH_SIZE);
    const counts = new Uint16Array(PATCH_SIZE);
    let sum = 0, minX = width, minY = height, maxX = -1, maxY = -1, mx = 0, my = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = pixels[(y * width + x) * 4 + 3] / 255;
        const cell = Math.floor(y * PATCH_H / height) * PATCH_W + Math.floor(x * PATCH_W / width);
        mask[cell] += alpha;
        counts[cell]++;
        sum += alpha;
        if (!alpha) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        mx += x * alpha;
        my += y * alpha;
      }
    }
    if (!sum && glyph !== ' ' && glyph !== '⠀') {
      rejected.push(glyph);
      continue;
    }
    for (let i = 0; i < mask.length; i++) mask[i] /= counts[i];
    entries.push({
      glyph, mask, density: sum / (width * height), orientation: glyphOrientation(mask),
      bounds: sum ? [(maxX - minX + 1) / factor, (maxY - minY + 1) / factor] : [0, 0],
      center: sum ? [mx / sum / width, my / sum / height] : [.5, .5],
    });
  }
  if (!entries.length) throw new Error('The character set needs at least one visible, fixed-width glyph or a space.');
  const result = { entries, rejected };
  if (cache.size >= 12) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
