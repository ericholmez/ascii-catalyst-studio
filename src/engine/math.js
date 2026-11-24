import { perspectiveLimit, perspectiveSize } from './perspective.js';

export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const linear = (n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;

export function luminance(r, g, b, method = 'perceptual') {
  if (method === 'average') return (r + g + b) / 3;
  if (method === 'linear') return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
  return .2126 * r + .7152 * g + .0722 * b;
}

export function cropRect(width, height, settings) {
  const x = Math.min(width - 1, Math.round(width * (settings.cropX ?? 0) / 100));
  const y = Math.min(height - 1, Math.round(height * (settings.cropY ?? 0) / 100));
  const right = Math.round(width * ((settings.cropX ?? 0) + (settings.cropWidth ?? 100)) / 100);
  const bottom = Math.round(height * ((settings.cropY ?? 0) + (settings.cropHeight ?? 100)) / 100);
  return { x, y, width: clamp(right - x, 1, width - x), height: clamp(bottom - y, 1, height - y) };
}

export function gridSize(width, height, cellWidth, cellHeight, settings) {
  const limit = settings.quality === 'draft' ? 84 : 480;
  const cols = Math.min(limit, settings.columns);
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const frame = perspectiveSize(width, height, settings.perspective, perspectiveLimit(settings.quality));
  const crop = cropRect(frame.width, frame.height, settings);
  const ratio = rotated ? crop.width / crop.height : crop.height / crop.width;
  const rows = Math.round(settings.lockAspect
    ? cols * ratio * cellWidth / cellHeight
    : settings.rows * cols / settings.columns);
  return { cols, rows: clamp(rows, 1, Math.floor(115200 / cols)) };
}

export function randomAt(index, seed) {
  let n = Math.imul(index ^ seed, 0x9e3779b1);
  n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
  return ((n ^ n >>> 15) >>> 0) / 4294967296;
}

export function braille(dots) {
  const weights = [1, 8, 2, 16, 4, 32, 64, 128];
  return String.fromCharCode(0x2800 + weights.reduce((mask, bit, i) => mask + (dots[i] ? bit : 0), 0));
}

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >>> 16, (n >>> 8) & 255, n & 255];
}

export const rgbHex = (r, g, b) => '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

export const ANSI16 = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
].map(hexRgb);

export const paletteDistance = (r, g, b, [pr, pg, pb]) => .2126 * (pr - r) ** 2
  + .7152 * (pg - g) ** 2 + .0722 * (pb - b) ** 2;

export function nearestPalette(r, g, b, palette = ANSI16) {
  let score = Infinity;
  let best = 0;
  for (let i = 0; i < palette.length; i++) {
    const distance = paletteDistance(r, g, b, palette[i]);
    if (distance < score) {
      score = distance;
      best = i;
    }
  }
  return best;
}
