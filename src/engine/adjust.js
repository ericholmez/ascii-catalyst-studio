import { clamp, luminance, randomAt } from './math.js';

const BINS = 256;

function localTone(colors, width, height) {
  const count = width * height;
  const tone = new Float32Array(count);
  const horizontal = new Float32Array(count);
  const weights = new Float32Array(count);
  const smoothed = new Float32Array(count);
  const radius = 3;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    tone[i] = luminance(colors[p], colors[p + 1], colors[p + 2]) / 255;
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0, weight = 0;
    for (let x = 0; x < Math.min(radius, width); x++) {
      const alpha = colors[(row + x) * 4 + 3];
      sum += tone[row + x] * alpha;
      weight += alpha;
    }
    for (let x = 0; x < width; x++) {
      const right = row + x + radius, left = row + x - radius - 1;
      if (x + radius < width) {
        const alpha = colors[right * 4 + 3];
        sum += tone[right] * alpha;
        weight += alpha;
      }
      if (x > radius) {
        const alpha = colors[left * 4 + 3];
        sum -= tone[left] * alpha;
        weight -= alpha;
      }
      horizontal[row + x] = sum;
      weights[row + x] = weight;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let y = 0; y < Math.min(radius, height); y++) {
      sum += horizontal[y * width + x];
      weight += weights[y * width + x];
    }
    for (let y = 0; y < height; y++) {
      const below = (y + radius) * width + x, above = (y - radius - 1) * width + x;
      if (y + radius < height) {
        sum += horizontal[below];
        weight += weights[below];
      }
      if (y > radius) {
        sum -= horizontal[above];
        weight -= weights[above];
      }
      const i = y * width + x;
      smoothed[i] = weight > 0 ? sum / weight : tone[i];
    }
  }
  return { tone, smoothed };
}

export function adjustImage(pixels, width, height, settings) {
  const count = pixels.length / 4;
  const colors = new Uint8ClampedArray(pixels.length);
  const light = new Float32Array(count);
  const histogram = new Uint32Array(BINS);
  const contrast = 2 ** (settings.contrast / 70);
  const pivot = settings.contrastPivot / 100;
  const exposure = 2 ** settings.exposure;
  const gamma = 1 / settings.gamma;
  const brightness = settings.brightness / 100;
  const black = settings.black / 100;
  const levels = Math.max(.01, settings.white / 100 - black);
  const saturation = settings.saturation / 100;
  const shadow = settings.shadows * .0042;
  const middle = settings.midtones * .0035;
  const highlight = settings.highlights * .0042;
  const splitTone = Boolean(shadow || middle || highlight);
  const temperature = settings.temperature * .0016;
  const tint = settings.tint * .0013;
  const offsets = [temperature + tint / 2, -tint, -temperature + tint / 2];
  for (let p = 0; p < pixels.length; p += 4) {
    if (!pixels[p + 3]) continue;
    const r = pixels[p] / 255, g = pixels[p + 1] / 255, b = pixels[p + 2] / 255;
    const gray = luminance(r, g, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const sat = saturation * (1 + settings.vibrance / 100 * (1 - chroma));
    for (let channel = 0; channel < 3; channel++) {
      const base = gray + (pixels[p + channel] / 255 - gray) * sat + offsets[channel];
      let tone = clamp(((base * exposure + brightness - pivot) * contrast + pivot - black) / levels) ** gamma;
      if (splitTone) {
        tone = clamp(tone + shadow * (1 - tone) ** 2 + middle * (4 * tone * (1 - tone)) ** 2 + highlight * tone ** 2);
      }
      colors[p + channel] = (settings.invert ? 1 - tone : tone) * 255;
    }
    colors[p + 3] = pixels[p + 3];
  }

  const localAmount = (settings.soften - settings.detail * 1.65) / 100;
  const local = localAmount ? localTone(colors, width, height) : null;
  const grain = settings.grain * .0024;
  const steps = settings.posterize ? settings.posterize - 1 : 0;
  const cutoff = settings.cutoff / 100;
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    const alpha = colors[p + 3] / 255;
    if (!alpha) continue;
    const localShift = local ? (local.smoothed[i] - local.tone[i]) * localAmount : 0;
    const delta = localShift + (grain ? (randomAt(i, settings.seed ^ 0x297a) - .5) * grain : 0);
    if (steps || delta) {
      for (let channel = 0; channel < 3; channel++) {
        let value = clamp(colors[p + channel] / 255 + delta);
        if (steps) value = Math.round(value * steps) / steps;
        colors[p + channel] = value * 255;
      }
    }
    let tone = luminance(colors[p] / 255, colors[p + 1] / 255, colors[p + 2] / 255, settings.grayscale);
    if (settings.hardThreshold) {
      tone = Number(tone >= cutoff);
      colors[p] = colors[p + 1] = colors[p + 2] = tone * 255;
    }
    light[i] = (settings.polarity === 'dark' ? 1 - tone : tone) * alpha;
    histogram[Math.round(tone * 255)]++;
  }

  if (settings.mapping === 'equalized') {
    const distribution = new Uint32Array(BINS);
    let visible = 0;
    for (let i = 0; i < count; i++) {
      if (!colors[i * 4 + 3]) continue;
      distribution[Math.round(light[i] * 255)]++;
      visible++;
    }
    const first = distribution.find((value) => value > 0);
    if (first < visible) {
      let cumulative = 0;
      for (let i = 0; i < distribution.length; i++) {
        cumulative += distribution[i];
        distribution[i] = Math.round(255 * clamp((cumulative - first) / (visible - first)));
      }
      for (let i = 0; i < count; i++) {
        if (colors[i * 4 + 3]) light[i] = distribution[Math.round(light[i] * 255)] / 255;
      }
    }
  }
  return { light, colors, histogram };
}
