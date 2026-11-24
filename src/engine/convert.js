import { PATCH_W, PATCH_H, PATCH_SIZE, orientation } from './glyphs.js';
import { ANSI16, braille, clamp, luminance, nearestPalette, randomAt } from './math.js';
import { cleanGlyphs, normalizeSettings } from './settings.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const FLOYD = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
const ATKINSON = [[1, 0, .125], [2, 0, .125], [-1, 1, .125], [0, 1, .125], [1, 1, .125], [0, 2, .125]];
const GLYPH_SHIFTS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const PERCENTILES = 256;

function prepare(pixels, settings) {
  const count = pixels.length / 4;
  const light = new Float32Array(count);
  const colors = new Uint8ClampedArray(pixels.length);
  const histogram = new Uint32Array(PERCENTILES);
  const contrast = 2 ** (settings.contrast / 70);
  const exposure = 2 ** settings.exposure;
  const gamma = 1 / settings.gamma;
  const brightness = settings.brightness / 100;
  const black = settings.black / 100;
  const levels = Math.max(.01, settings.white / 100 - black);
  const saturation = settings.saturation / 100;
  for (let i = 0, j = 0; i < count; i++, j += 4) {
    const alpha = pixels[j + 3] / 255;
    const red = pixels[j] / 255;
    const green = pixels[j + 1] / 255;
    const blue = pixels[j + 2] / 255;
    const gray = luminance(red, green, blue);
    for (let channel = 0; channel < 3; channel++) {
      const base = gray + (pixels[j + channel] / 255 - gray) * saturation;
      const adjusted = clamp(((base * exposure + brightness - .5) * contrast + .5 - black) / levels) ** gamma;
      colors[j + channel] = (settings.invert ? 1 - adjusted : adjusted) * 255;
    }
    colors[j + 3] = pixels[j + 3];
    const tone = luminance(colors[j] / 255, colors[j + 1] / 255, colors[j + 2] / 255, settings.grayscale);
    light[i] = (settings.polarity === 'dark' ? 1 - tone : tone) * alpha;
    if (alpha) histogram[Math.round(tone * 255)]++;
  }
  if (settings.mapping === 'equalized') {
    const distribution = new Uint32Array(PERCENTILES);
    for (const value of light) distribution[Math.round(value * 255)]++;
    let cumulative = 0;
    const first = distribution.find((value) => value > 0);
    if (first < count) {
      for (let i = 0; i < distribution.length; i++) {
        cumulative += distribution[i];
        distribution[i] = Math.round(255 * clamp((cumulative - first) / (count - first)));
      }
      for (let i = 0; i < count; i++) light[i] = colors[i * 4 + 3]
        ? distribution[Math.round(light[i] * 255)] / 255 : 0;
    }
  }
  return { light, colors, histogram };
}

function gradientMap(values, width, height, operator) {
  const gx = new Float32Array(values.length);
  const gy = new Float32Array(values.length);
  const outer = operator === 'scharr' ? 3 : 1;
  const middle = operator === 'scharr' ? 10 : operator === 'prewitt' ? 1 : 2;
  const norm = 2 * outer + middle;
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const row = y * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1);
      gx[row + x] = (outer * (values[up + right] - values[up + left] + values[down + right] - values[down + left])
        + middle * (values[row + right] - values[row + left])) / norm;
      gy[row + x] = (outer * (values[down + left] - values[up + left] + values[down + right] - values[up + right])
        + middle * (values[down + x] - values[up + x])) / norm;
    }
  }
  return { gx, gy };
}

function sample(patch, method, average, low, high) {
  if (method === 'minimum') return low;
  if (method === 'maximum') return high;
  if (method === 'center') return (patch[13] + patch[14] + patch[17] + patch[18]) / 4;
  if (method === 'median') {
    const sorted = patch.slice().sort();
    return (sorted[15] + sorted[16]) / 2;
  }
  if (method === 'gaussian') {
    let value = 0, weight = 0;
    for (let i = 0; i < PATCH_SIZE; i++) {
      const w = (3 - Math.abs(i % PATCH_W - 1.5)) * (5 - Math.abs(Math.floor(i / PATCH_W) - 3.5));
      value += w * patch[i];
      weight += w;
    }
    return value / weight;
  }
  return average;
}

function nearestDensity(sorted, tone) {
  let low = 0, high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].density < tone) low = mid + 1;
    else high = mid;
  }
  if (low && tone - sorted[low - 1].density <= sorted[low].density - tone) return sorted[low - 1];
  return sorted[low];
}

function shapeError(patch, mask, offsetX, offsetY) {
  let match = 0, union = 0;
  for (let y = 0; y < PATCH_H; y++) {
    for (let x = 0; x < PATCH_W; x++) {
      const dx = x + offsetX, dy = y + offsetY;
      const ink = dx >= 0 && dx < PATCH_W && dy >= 0 && dy < PATCH_H ? mask[dy * PATCH_W + dx] : 0;
      const source = patch[y * PATCH_W + x];
      match += Math.min(ink, source);
      union += Math.max(ink, source);
    }
  }
  return union ? 1 - match / union : 0;
}

function structuralGlyph(entries, patch, tone, direction, strength, settings, detail) {
  const shape = settings.mode === 'edges' ? 0 : settings.shape / 100;
  const edge = strength * settings.edge / 100;
  let chosen = entries[0], best = Infinity;
  for (const item of entries) {
    const tonalError = Math.abs(item.density - tone);
    const directionalError = Math.hypot(direction[0] - item.orientation[0], direction[1] - item.orientation[1]) / 2;
    let spatialError = 0;
    if (shape) {
      spatialError = shapeError(patch, item.mask, 0, 0);
      if (settings.quality === 'final') {
        for (const [x, y] of GLYPH_SHIFTS) {
          spatialError = Math.min(spatialError, shapeError(patch, item.mask, x, y) + .015);
        }
      }
    }
    const score = (1 - .55 * shape) * tonalError + edge * directionalError * .36 + shape * spatialError * .6;
    if (detail) detail.push({ glyph: item.glyph, score, tonalError, directionalError, spatialError });
    if (score < best) {
      chosen = item;
      best = score;
    }
  }
  return chosen;
}

function putColor(buffer, index, r, g, b, alpha, mode) {
  if (mode === 'gray4') r = g = b = Math.round(luminance(r, g, b) / 85) * 85;
  if (mode === 'ansi16') [r, g, b] = ANSI16[nearestPalette(r, g, b)];
  buffer.set([r, g, b, alpha], index * 4);
}

export function convert(pixels, cols, rows, atlas, input = {}, options = {}) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols * rows > 115200
    || pixels.length !== cols * rows * PATCH_SIZE * 4) throw new Error('Invalid conversion sampling grid.');
  const start = performance.now();
  const settings = normalizeSettings(input);
  const { light, colors, histogram } = prepare(pixels, settings);
  const width = cols * PATCH_W;
  const gradients = ['edges', 'structure', 'hybrid'].includes(settings.mode)
    ? gradientMap(light, width, rows * PATCH_H, settings.edgeOperator) : null;
  const entries = atlas.entries.map((item, id) => ({ ...item, id }));
  const sorted = entries.slice().sort((a, b) => a.density - b.density);
  const maximum = Math.max(.01, sorted.at(-1).density);
  const glyphs = entries.map(({ glyph }) => glyph);
  const ids = new Map(glyphs.map((glyph, id) => [glyph, id]));
  const glyphId = (glyph) => {
    if (!ids.has(glyph)) {
      ids.set(glyph, glyphs.length);
      glyphs.push(glyph);
    }
    return ids.get(glyph);
  };
  const blank = glyphId(' ');
  const count = cols * rows;
  const cells = new Uint16Array(count);
  const foreground = new Uint8ClampedArray(count * 4);
  const background = settings.mode === 'half' && settings.color !== 'mono' ? new Uint8ClampedArray(count * 4) : null;
  const opacity = new Uint8ClampedArray(count);
  const influence = new Uint8Array(count);
  const diffusion = settings.dither === 'floyd' ? FLOYD : settings.dither === 'atkinson' ? ATKINSON : null;
  const error = diffusion ? new Float32Array(count) : null;
  const fixed = cleanGlyphs(settings.text, 8192);
  const patch = new Float32Array(PATCH_SIZE);
  const dots = new Array(8);
  const strength = settings.intensity / 100;
  let diagnostic = null;

  for (let y = 0; y < rows; y++) {
    const reverse = diffusion && y % 2;
    for (let column = 0; column < cols; column++) {
      const x = reverse ? cols - column - 1 : column;
      const index = y * cols + x;
      let average = 0, low = 1, high = 0, xx = 0, yy = 0, xy = 0;
      let r = 0, g = 0, b = 0, a = 0, rr = 0, gg = 0, bb = 0, aa = 0;
      for (let dy = 0; dy < PATCH_H; dy++) {
        for (let dx = 0; dx < PATCH_W; dx++) {
          const pi = (y * PATCH_H + dy) * width + x * PATCH_W + dx;
          const value = light[pi];
          patch[dy * PATCH_W + dx] = value;
          average += value;
          low = Math.min(low, value);
          high = Math.max(high, value);
          const offset = pi * 4;
          const alpha = colors[offset + 3];
          if (dy < PATCH_H / 2) {
            r += colors[offset] * alpha;
            g += colors[offset + 1] * alpha;
            b += colors[offset + 2] * alpha;
            a += alpha;
          } else {
            rr += colors[offset] * alpha;
            gg += colors[offset + 1] * alpha;
            bb += colors[offset + 2] * alpha;
            aa += alpha;
          }
          if (gradients) {
            const gx = gradients.gx[pi], gy = gradients.gy[pi];
            xx += gx * gx;
            yy += gy * gy;
            xy += gx * gy;
          }
        }
      }
      average /= PATCH_SIZE;
      const spread = high - low;
      const edgeStrength = clamp(Math.sqrt((xx + yy) / PATCH_SIZE) * 3);
      const direction = gradients ? orientation(xx, yy, xy) : [0, 0];
      const detail = index === options.inspect ? [] : null;
      let tone = sample(patch, settings.sampling, average, low, high);
      if (settings.mapping === 'gamma') tone = Math.sqrt(tone);
      if (settings.dither === 'bayer') tone += ((BAYER[(y % 4) * 4 + x % 4] + .5) / 16 - .5) * strength * .38;
      if (settings.dither === 'random') tone += (randomAt(index, settings.seed) - .5) * strength * .38;
      if (error) tone += error[index];
      tone = clamp(tone);
      const target = tone * maximum;
      let chosen = blank;
      let actual = 0;
      const alpha = (a + aa) / PATCH_SIZE;
      opacity[index] = alpha;
      if (alpha) {
        if (settings.mode === 'braille') {
          const threshold = clamp(settings.threshold / 100 - (tone - average));
          for (let dot = 0; dot < 8; dot++) {
            const pi = Math.floor(dot / 2) * 8 + dot % 2 * 2;
            dots[dot] = (patch[pi] + patch[pi + 1] + patch[pi + 4] + patch[pi + 5]) / 4 > threshold;
          }
          actual = dots.filter(Boolean).length / 8;
          chosen = actual ? glyphId(braille(dots)) : blank;
          influence[index] = 3;
        } else if (settings.mode === 'half') {
          const upper = patch.subarray(0, 16).reduce((sum, value) => sum + value, 0) / 16;
          const lower = average * 2 - upper;
          const threshold = clamp(settings.threshold / 100 - (tone - average));
          const bits = background ? (a > 0 ? 1 : 0) + (aa > 0 ? 2 : 0) : (upper > threshold ? 1 : 0) + (lower > threshold ? 2 : 0);
          chosen = glyphId(background && bits === 3 ? '▀' : [' ', '▀', '▄', '█'][bits]);
          actual = ((bits & 1) + (bits >> 1)) / 2;
          influence[index] = 3;
        } else if (settings.mode === 'fixed') {
          chosen = glyphId(fixed[index % fixed.length] || ' ');
          opacity[index] *= .12 + tone * .88;
          actual = tone;
          influence[index] = 4;
        } else if (settings.mode === 'tonal') {
          const position = Math.round(tone * (entries.length - 1));
          chosen = position;
          actual = entries[position].density / maximum;
          if (detail) for (const item of entries) detail.push({ glyph: item.glyph, score: Math.abs(item.id - position) });
        } else {
          const isStructural = settings.mode === 'structure' || settings.mode === 'edges'
            || (settings.mode === 'hybrid' && edgeStrength * settings.edge / 100 > .08 && spread > .16);
          const structuralTone = settings.mode === 'edges' ? target * .18 + maximum * edgeStrength * .82 : target;
          if (isStructural && settings.mode !== 'edges' && spread > .08) {
            for (let i = 0; i < PATCH_SIZE; i++) patch[i] = (patch[i] - low) / spread;
          }
          const match = isStructural
            ? structuralGlyph(entries, patch, structuralTone, direction, edgeStrength, settings, detail)
            : nearestDensity(sorted, target);
          chosen = match.id;
          actual = match.density / maximum;
          influence[index] = isStructural ? (settings.mode === 'edges' ? 2 : 1) : 0;
          if (detail && !isStructural) {
            for (const item of sorted) detail.push({ glyph: item.glyph, score: Math.abs(item.density - target) });
          }
        }
      }
      if (settings.dropout && randomAt(index, settings.seed + 1) < settings.dropout / 100) {
        chosen = blank;
        actual = 0;
      }
      cells[index] = chosen;
      if (settings.color !== 'mono') {
        if (background) {
          if (a && aa) {
            putColor(foreground, index, r / a, g / a, b / a, a / 16, settings.color);
            putColor(background, index, rr / aa, gg / aa, bb / aa, aa / 16, settings.color);
          } else if (a || aa) {
            putColor(foreground, index, (r + rr) / (a + aa), (g + gg) / (a + aa), (b + bb) / (a + aa), (a + aa) / 16, settings.color);
          }
        } else if (a + aa) {
          putColor(foreground, index, (r + rr) / (a + aa), (g + gg) / (a + aa), (b + bb) / (a + aa), 255, settings.color);
        }
      }
      if (detail) diagnostic = {
        index, tone, direction, edgeStrength, influence: influence[index], glyph: glyphs[chosen],
        patch: [...patch],
        candidates: detail.sort((a, b) => a.score - b.score).slice(0, 8),
      };
      if (diffusion && alpha) {
        const residual = (tone - actual) * strength;
        for (const [dx, dy, weight] of diffusion) {
          const nx = x + (reverse ? -dx : dx), ny = y + dy;
          if (nx >= 0 && nx < cols && ny < rows) error[ny * cols + nx] += residual * weight;
        }
      }
    }
    if (y % 8 === 0) options.onProgress?.(Math.round(100 * y / rows));
  }
  const usage = new Uint32Array(glyphs.length);
  for (const id of cells) usage[id]++;
  return {
    cols, rows, cells, glyphs, foreground, background, opacity, influence, histogram, usage, diagnostic,
    occupied: count - usage[blank], duration: performance.now() - start, mode: settings.mode,
  };
}
