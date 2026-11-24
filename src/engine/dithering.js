import { clamp, nearestPalette, paletteDistance, randomAt } from './math.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const FLOYD = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
const ATKINSON = [[1, 0, .125], [2, 0, .125], [-1, 1, .125], [0, 1, .125], [1, 1, .125], [0, 2, .125]];

export const diffusionKernel = (method) => method === 'floyd' ? FLOYD : method === 'atkinson' ? ATKINSON : null;
export const bayerThreshold = (x, y) => (BAYER[(y % 4) * 4 + x % 4] + .5) / 16;

function mixInk(red, green, blue, palette, threshold, strength) {
  let base, alternate, closest = Infinity, second = Infinity;
  for (const ink of palette) {
    const score = paletteDistance(red, green, blue, ink);
    if (score < closest) {
      alternate = base;
      second = closest;
      base = ink;
      closest = score;
    } else if (score < second) {
      alternate = ink;
      second = score;
    }
  }
  if (!alternate) return base;
  const span = paletteDistance(...base, alternate);
  if (!span) return base;
  const projection = (closest + span - second) / (2 * span);
  return threshold < clamp(projection, 0, .5) * strength ? alternate : base;
}

export function ditherInks(samples, width, height, palette, method, strength, seed) {
  const output = new Uint8ClampedArray(samples.length);
  const kernel = diffusionKernel(method);
  const error = kernel ? new Float32Array(samples.length) : null;
  for (let y = 0; y < height; y++) {
    const reverse = kernel && y % 2 === 1;
    for (let column = 0; column < width; column++) {
      const x = reverse ? width - column - 1 : column;
      const i = y * width + x, p = i * 4;
      const alpha = samples[p + 3];
      if (!alpha) continue;
      const red = clamp(samples[p] + (error?.[p] ?? 0), 0, 255);
      const green = clamp(samples[p + 1] + (error?.[p + 1] ?? 0), 0, 255);
      const blue = clamp(samples[p + 2] + (error?.[p + 2] ?? 0), 0, 255);
      const ink = method === 'bayer' || method === 'random'
        ? mixInk(red, green, blue, palette, method === 'bayer' ? bayerThreshold(x, y) : randomAt(i, seed), strength)
        : palette[nearestPalette(red, green, blue, palette)];
      output[p] = ink[0];
      output[p + 1] = ink[1];
      output[p + 2] = ink[2];
      output[p + 3] = alpha;
      if (!error) continue;
      const amount = strength * alpha / 255;
      const dr = (red - ink[0]) * amount, dg = (green - ink[1]) * amount, db = (blue - ink[2]) * amount;
      for (const [dx, dy, weight] of kernel) {
        const nx = x + (reverse ? -dx : dx), ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        const next = (ny * width + nx) * 4;
        if (!samples[next + 3]) continue;
        error[next] += dr * weight;
        error[next + 1] += dg * weight;
        error[next + 2] += db * weight;
      }
    }
  }
  return output;
}
