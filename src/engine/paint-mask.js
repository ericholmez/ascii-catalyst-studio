import { makeCanvas } from './image.js';
import { clamp, cropRect } from './math.js';
import { perspectiveLimit, perspectiveMatrix, perspectiveSize } from './perspective.js';

export const MAX_MASK_STROKES = 160;
export const MAX_STROKE_POINTS = 1024;

export function normalizeMaskStrokes(input) {
  if (!Array.isArray(input)) return [];
  const strokes = [];
  for (const stroke of input.slice(0, MAX_MASK_STROKES)) {
    if (!stroke || !['hide', 'restore'].includes(stroke.mode) || !Array.isArray(stroke.points)) continue;
    const points = stroke.points.slice(0, MAX_STROKE_POINTS * 2);
    if (!points.length || points.length % 2 || !points.every(Number.isFinite)) continue;
    const size = Number.isFinite(stroke.size) ? clamp(stroke.size, 1, 60) : 12;
    const hardness = Number.isFinite(stroke.hardness) ? clamp(stroke.hardness, 0, 100) : 100;
    strokes.push({ mode: stroke.mode, size, hardness, points: points.map((point) => clamp(point)) });
  }
  return strokes;
}

export function drawMaskStroke(ctx, stroke) {
  const { width, height } = ctx.canvas;
  const { points } = stroke;
  if (!points.length) return;
  const diameter = Math.min(width, height) * stroke.size / 100;
  const hardness = stroke.hardness / 100;
  const steps = hardness === 1 ? 1 : 10;
  const path = new Path2D();
  path.moveTo(points[0] * width, points[1] * height);
  for (let i = 2; i < points.length; i += 2) path.lineTo(points[i] * width, points[i + 1] * height);

  ctx.save();
  ctx.globalCompositeOperation = stroke.mode === 'hide' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  for (let step = 1; step <= steps; step++) {
    const size = Math.max(.5, diameter * (1 - (1 - hardness) * (step - 1) / steps));
    ctx.globalAlpha = 1 / (steps - step + 1);
    if (points.length === 2) {
      ctx.beginPath();
      ctx.arc(points[0] * width, points[1] * height, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = size;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

let renderedMask;

export function maskSurface(source, strokes) {
  if (renderedMask?.source === source && renderedMask.strokes === strokes) return renderedMask.canvas;
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = renderedMask?.source === source ? renderedMask.canvas : makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const previous = renderedMask?.source === source ? renderedMask.strokes : [];
  const appended = previous.length > 0 && previous.length <= strokes.length && previous.every((s, i) => s === strokes[i]);
  if (!appended) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  for (let i = appended ? previous.length : 0; i < strokes.length; i++) drawMaskStroke(ctx, strokes[i]);
  renderedMask = { source, strokes, canvas };
  return canvas;
}

export function sampleMaskAlpha(pixels, maskWidth, maskHeight, width, height, sourceWidth, sourceHeight, settings) {
  const frame = perspectiveSize(sourceWidth, sourceHeight, settings.perspective, perspectiveLimit(settings.quality));
  const crop = cropRect(frame.width, frame.height, settings);
  const matrix = settings.perspective ? perspectiveMatrix(settings.perspective) : null;
  const [a, b, c, d, e, f, g, h] = matrix ?? [];
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0, i = 0; y < height; y++) {
    const v = (y + .5) / height;
    for (let x = 0; x < width; x++, i++) {
      const u = (x + .5) / width;
      let px = u, py = v;
      if (settings.rotation === 90) { px = v; py = 1 - u; }
      if (settings.rotation === 180) { px = 1 - u; py = 1 - v; }
      if (settings.rotation === 270) { px = 1 - v; py = u; }
      if (settings.flipX) px = 1 - px;
      if (settings.flipY) py = 1 - py;
      px = (crop.x + px * crop.width) / frame.width;
      py = (crop.y + py * crop.height) / frame.height;
      if (matrix) {
        const z = g * px + h * py + 1;
        const mappedX = (a * px + b * py + c) / z;
        py = (d * px + e * py + f) / z;
        px = mappedX;
      }
      const sx = clamp(px * maskWidth - .5, 0, maskWidth - 1);
      const sy = clamp(py * maskHeight - .5, 0, maskHeight - 1);
      const left = Math.floor(sx), top = Math.floor(sy);
      const j = (top * maskWidth + left) * 4 + 3;
      const right = left + 1 < maskWidth ? 4 : 0;
      const below = top + 1 < maskHeight ? maskWidth * 4 : 0;
      const tx = sx - left, ty = sy - top;
      const a0 = pixels[j] * (1 - tx) + pixels[j + right] * tx;
      const a1 = pixels[j + below] * (1 - tx) + pixels[j + right + below] * tx;
      alpha[i] = a0 * (1 - ty) + a1 * ty;
    }
  }
  return alpha;
}
