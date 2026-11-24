import { luminance, rgbHex } from './math.js';

export const MAX_PALETTE_SIZE = 16;
export const DEFAULT_PALETTE = Object.freeze(['#201c35', '#3c5573', '#875a7a', '#d38a72', '#edd09d', '#f5eee3']);

export function normalizeSwatch(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase().replace(/^#/, '');
  if (/^[a-f\d]{6}$/.test(hex)) return '#' + hex;
  if (/^[a-f\d]{3}$/.test(hex)) return '#' + [...hex].map((digit) => digit + digit).join('');
  return null;
}

export function normalizePalette(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_PALETTE_SIZE).map(normalizeSwatch).filter(Boolean);
}

export function parsePalette(text) {
  const values = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!values.length || values.length > MAX_PALETTE_SIZE) throw new Error('Enter 1 to 16 HEX colours.');
  const palette = values.map(normalizeSwatch);
  if (palette.some((swatch) => !swatch)) throw new Error('Use HEX colours such as #1e3054 or #abc.');
  return palette;
}

function colorBuckets(pixels) {
  const count = 32768;
  const weight = new Float64Array(count);
  const red = new Float64Array(count), green = new Float64Array(count), blue = new Float64Array(count);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (!alpha) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const index = ((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3);
    weight[index] += alpha;
    red[index] += r * alpha;
    green[index] += g * alpha;
    blue[index] += b * alpha;
  }
  const samples = [];
  for (let index = 0; index < count; index++) {
    const sum = weight[index];
    if (sum) samples.push([red[index] / sum, green[index] / sum, blue[index] / sum, sum]);
  }
  return samples;
}

function measureBox(samples) {
  const low = [255, 255, 255], high = [0, 0, 0];
  let weight = 0;
  for (const rgb of samples) {
    for (let channel = 0; channel < 3; channel++) {
      low[channel] = Math.min(low[channel], rgb[channel]);
      high[channel] = Math.max(high[channel], rgb[channel]);
    }
    weight += rgb[3];
  }
  let axis = 0;
  for (let channel = 1; channel < 3; channel++) {
    if (high[channel] - low[channel] > high[axis] - low[axis]) axis = channel;
  }
  return { samples, weight, axis, score: (high[axis] - low[axis]) * Math.sqrt(weight) };
}

export function extractPalette(pixels, count = 6) {
  const samples = colorBuckets(pixels);
  if (!samples.length) return [];
  const limit = Math.max(1, Math.min(MAX_PALETTE_SIZE, Math.round(count)));
  const boxes = [measureBox(samples)];
  while (boxes.length < limit) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].samples.length > 1 && (best === -1 || boxes[i].score > boxes[best].score)) best = i;
    }
    if (best === -1) break;
    const box = boxes[best];
    box.samples.sort((a, b) => a[box.axis] - b[box.axis]);
    let split = 1, weight = box.samples[0][3];
    while (split < box.samples.length - 1 && weight < box.weight / 2) weight += box.samples[split++][3];
    boxes.splice(best, 1, measureBox(box.samples.slice(0, split)), measureBox(box.samples.slice(split)));
  }
  const means = boxes.map(({ samples: colors, weight }) => {
    const sum = [0, 0, 0];
    for (const [r, g, b, alpha] of colors) {
      sum[0] += r * alpha;
      sum[1] += g * alpha;
      sum[2] += b * alpha;
    }
    return sum.map((value) => value / weight);
  });
  means.sort((a, b) => luminance(...a) - luminance(...b));
  return [...new Set(means.map((rgb) => rgbHex(...rgb)))];
}
