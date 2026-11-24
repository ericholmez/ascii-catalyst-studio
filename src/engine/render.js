import { hexRgb, rgbHex } from './math.js';
import { makeCanvas } from './image.js';

const rgba = (values, i, alpha = 1) => 'rgba(' + values[i] + ',' + values[i + 1] + ',' + values[i + 2] + ',' + values[i + 3] / 255 * alpha + ')';
const overlays = ['#bcbcbc', '#ffffff', '#7c7c7c', '#535353', '#eeeeee'];

export function drawArtwork(canvas, art, metrics, settings, { scale = 1, grid = false, map = false, edits = {}, margin = 0 } = {}) {
  const { cols, rows } = art;
  const { cellWidth: cw, cellHeight: ch, size, family, weight } = metrics;
  canvas.width = Math.ceil(cols * cw * scale + 2 * margin);
  canvas.height = Math.ceil(rows * ch * scale + 2 * margin);
  if (canvas.width * canvas.height > 32000000 || Math.max(canvas.width, canvas.height) > 16384) {
    throw new Error('Output exceeds the canvas limit. Lower the export scale or grid resolution.');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  if (!settings.transparent) {
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.translate(margin, margin);
  ctx.scale(scale, scale);
  ctx.font = weight + ' ' + size + 'px ' + family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < art.cells.length; i++) {
    const x = i % cols * cw, y = Math.floor(i / cols) * ch;
    const glyph = edits[i] ?? art.glyphs[art.cells[i]];
    const p = i * 4;
    if (art.background?.[p + 3]) {
      ctx.fillStyle = rgba(art.background, p);
      ctx.fillRect(x, y, cw + .15, ch + .15);
    }
    if (glyph === ' ') continue;
    if (map) {
      ctx.fillStyle = overlays[art.influence[i]];
    } else if (settings.color === 'mono' || edits[i] !== undefined) {
      ctx.fillStyle = settings.foreground;
    } else {
      ctx.fillStyle = rgba(art.foreground, p);
    }
    ctx.globalAlpha = edits[i] !== undefined || art.background ? 1 : art.opacity[i] / 255;
    ctx.fillText(glyph, x + cw / 2, y + ch / 2);
    ctx.globalAlpha = 1;
  }
  if (grid) {
    ctx.strokeStyle = '#ffffff26';
    ctx.lineWidth = .5;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(x * cw, 0);
      ctx.lineTo(x * cw, rows * ch);
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(0, y * ch);
      ctx.lineTo(cols * cw, y * ch);
    }
    ctx.stroke();
  }
  return canvas;
}

export function renderComposition(canvas, art, metrics, settings, options = {}) {
  if (!options.layers?.length) return drawArtwork(canvas, art, metrics, settings, options);
  const base = drawArtwork(makeCanvas(1, 1), art, metrics, settings, options);
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  const scale = options.scale ?? 1;
  for (const layer of options.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.translate(canvas.width / 2 + layer.x * scale, canvas.height / 2 + layer.y * scale);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layer.blend;
    ctx.fillStyle = layer.color;
    ctx.font = '700 ' + layer.size * scale + 'px ' + metrics.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = layer.text.split('\n');
    lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * layer.size * scale * 1.2));
    ctx.restore();
  }
  return canvas;
}

export function cellColors(art, i, settings) {
  const p = i * 4;
  const fg = settings.color !== 'mono' && art.foreground[p + 3]
    ? rgbHex(...art.foreground.subarray(p, p + 3)) : settings.foreground;
  const bg = art.background?.[p + 3] ? rgbHex(...art.background.subarray(p, p + 3)) : null;
  return { fg, bg, fgRgb: hexRgb(fg), bgRgb: bg ? hexRgb(bg) : null };
}
