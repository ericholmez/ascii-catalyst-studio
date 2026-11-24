export function validPerspective(points) {
  if (!Array.isArray(points) || points.length !== 8
    || !points.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8, k = (i + 4) % 8;
    const cross = (points[j] - points[i]) * (points[k + 1] - points[j + 1])
      - (points[j + 1] - points[i + 1]) * (points[k] - points[j]);
    if (!(cross > .00025)) return false;
  }
  return true;
}

export function perspectiveMatrix([x0, y0, x1, y1, x2, y2, x3, y3]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function projectPoint([a, b, c, d, e, f, g, h], u, v) {
  const z = g * u + h * v + 1;
  return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
}

export function perspectiveSize(width, height, points, limit = Infinity) {
  if (!points) return { width, height };
  const length = (i, j) => Math.hypot((points[i] - points[j]) * width, (points[i + 1] - points[j + 1]) * height);
  const w = (length(0, 2) + length(6, 4)) / 2;
  const h = (length(0, 6) + length(2, 4)) / 2;
  const scale = Math.min(1, limit / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function warpPerspective(pixels, width, height, outWidth, outHeight, points) {
  const [a, b, c, d, e, f, g, h] = perspectiveMatrix(points);
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0, p = 0; y < outHeight; y++) {
    const v = (y + .5) / outHeight;
    const xBase = b * v + c, yBase = e * v + f, wBase = h * v + 1;
    for (let x = 0; x < outWidth; x++, p += 4) {
      const u = (x + .5) / outWidth;
      const z = g * u + wBase;
      const sx = Math.max(0, Math.min(width - 1, (a * u + xBase) / z * width - .5));
      const sy = Math.max(0, Math.min(height - 1, (d * u + yBase) / z * height - .5));
      const left = Math.floor(sx), top = Math.floor(sy);
      const tx = sx - left, ty = sy - top;
      const i = (top * width + left) * 4;
      const j = left + 1 < width ? i + 4 : i;
      const k = top + 1 < height ? i + width * 4 : i;
      const l = k + j - i;
      const w0 = (1 - tx) * (1 - ty) * pixels[i + 3];
      const w1 = tx * (1 - ty) * pixels[j + 3];
      const w2 = (1 - tx) * ty * pixels[k + 3];
      const w3 = tx * ty * pixels[l + 3];
      const alpha = w0 + w1 + w2 + w3;
      if (!alpha) continue;
      for (let ch = 0; ch < 3; ch++) {
        out[p + ch] = (pixels[i + ch] * w0 + pixels[j + ch] * w1 + pixels[k + ch] * w2 + pixels[l + ch] * w3) / alpha;
      }
      out[p + 3] = alpha;
    }
  }
  return out;
}

export const perspectiveLimit = (quality) => quality === 'draft' ? 768 : 1600;
