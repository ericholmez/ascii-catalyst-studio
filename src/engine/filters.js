import { luminance } from './math.js';

export function medianCleanup(colors, width, height, strength) {
  const tone = new Float32Array(width * height);
  const samples = new Float32Array(9);
  for (let i = 0, p = 0; i < tone.length; i++, p += 4) {
    tone[i] = luminance(colors[p], colors[p + 1], colors[p + 2]);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4;
      if (!colors[p + 3]) continue;
      let count = 0;
      for (let dy = Math.max(0, y - 1); dy < Math.min(height, y + 2); dy++) {
        for (let dx = Math.max(0, x - 1); dx < Math.min(width, x + 2); dx++) {
          const neighbor = dy * width + dx;
          if (!colors[neighbor * 4 + 3]) continue;
          const value = tone[neighbor];
          let at = count++;
          for (; at > 0 && samples[at - 1] > value; at--) samples[at] = samples[at - 1];
          samples[at] = value;
        }
      }
      const median = (samples[(count - 1) >>> 1] + samples[count >>> 1]) / 2;
      const offset = (median - tone[i]) * strength;
      colors[p] += offset;
      colors[p + 1] += offset;
      colors[p + 2] += offset;
    }
  }
}

export function pixelate(colors, width, height, size) {
  for (let top = 0; top < height; top += size) {
    const bottom = Math.min(top + size, height);
    for (let left = 0; left < width; left += size) {
      const right = Math.min(left + size, width);
      let r = 0, g = 0, b = 0, weight = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const p = (y * width + x) * 4, alpha = colors[p + 3];
          r += colors[p] * alpha;
          g += colors[p + 1] * alpha;
          b += colors[p + 2] * alpha;
          weight += alpha;
        }
      }
      if (!weight) continue;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const p = (y * width + x) * 4;
          if (!colors[p + 3]) continue;
          colors[p] = r / weight;
          colors[p + 1] = g / weight;
          colors[p + 2] = b / weight;
        }
      }
    }
  }
}
