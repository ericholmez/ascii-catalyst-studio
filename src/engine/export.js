import { makeCanvas } from './image.js';
import { renderComposition, cellColors } from './render.js';
import { ANSI16, nearestPalette } from './math.js';

export const FORMATS = {
  png: 'PNG image', jpeg: 'JPEG image', webp: 'WebP image', pdf: 'PDF image',
  txt: 'UTF-8 text', ascii: 'Strict ASCII text', ansi: 'ANSI terminal', nfo: 'CP437 NFO',
  md: 'Markdown', svg: 'SVG editable text', html: 'Self-contained HTML', json: 'JSON character data',
  project: 'ASCII-Catalyst project',
};

export function artworkText(art, { edits = {}, trim = false, strict = false } = {}) {
  const lines = [];
  for (let y = 0; y < art.rows; y++) {
    let row = '';
    for (let x = 0; x < art.cols; x++) {
      const i = y * art.cols + x;
      const glyph = edits[i] ?? art.glyphs[art.cells[i]];
      if (strict && !/^[\x20-\x7e]$/.test(glyph)) {
        throw new Error('This artwork contains non-ASCII glyphs. Choose UTF-8 text or a printable ASCII ramp.');
      }
      row += glyph;
    }
    lines.push(trim ? row.replace(/ +$/, '') : row);
  }
  return lines.join('\n');
}

const CP437_HIGH = [...('ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»'
  + '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀'
  + 'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ')];
const CP437 = new Map(CP437_HIGH.map((glyph, i) => [glyph, 128 + i]));

export function encodeCp437(text) {
  const chars = [...text.replace(/\r?\n/g, '\r\n')];
  return Uint8Array.from(chars, (glyph) => {
    if (/^[\x20-\x7e\r\n]$/.test(glyph)) return glyph.charCodeAt(0);
    const code = CP437.get(glyph);
    if (code === undefined) throw new Error('CP437 cannot encode ' + glyph + '. Choose UTF-8 or change the character set.');
    return code;
  });
}

export function ansiText(art, settings, edits = {}) {
  const lines = [];
  for (let y = 0; y < art.rows; y++) {
    let row = '';
    let last = '';
    for (let x = 0; x < art.cols; x++) {
      const i = y * art.cols + x;
      const { fgRgb, bgRgb } = cellColors(art, i, settings);
      const color = (rgb, isBg) => {
        if (settings.color !== 'ansi16') return (isBg ? 48 : 38) + ';2;' + rgb.join(';');
        const index = nearestPalette(...rgb, ANSI16);
        return String((index > 7 ? 90 : 30) + index % 8 + (isBg ? 10 : 0));
      };
      const style = color(fgRgb, false) + ';' + (bgRgb || !settings.transparent
        ? color(bgRgb || [1, 3, 5].map((n) => parseInt(settings.background.slice(n, n + 2), 16)), true) : '49');
      if (last !== style) row += '\x1b[' + style + 'm';
      last = style;
      row += edits[i] ?? art.glyphs[art.cells[i]];
    }
    lines.push(row + '\x1b[0m');
  }
  return lines.join('\n');
}

export const escapeMarkup = (value) => String(value).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function svgMarkup(art, metrics, settings, { edits, margin, scale }) {
  const { cellWidth: cw, cellHeight: ch, size, weight, family } = metrics;
  const width = art.cols * cw * scale + margin * 2;
  const height = art.rows * ch * scale + margin * 2;
  const out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(width)
    + '" height="' + Math.ceil(height) + '" viewBox="0 0 ' + width + ' ' + height + '">'];
  if (!settings.transparent) out.push('<rect width="100%" height="100%" fill="' + settings.background + '"/>');
  out.push('<g transform="translate(' + margin + ' ' + margin + ') scale(' + scale
    + ')" font-family="' + escapeMarkup(family) + '" font-size="' + size + '" font-weight="' + weight
    + '" text-anchor="middle" dominant-baseline="central" style="font-variant-ligatures:none" xml:space="preserve">');
  for (let i = 0; i < art.cells.length; i++) {
    const glyph = edits[i] ?? art.glyphs[art.cells[i]];
    const x = i % art.cols * cw, y = Math.floor(i / art.cols) * ch;
    const { fg, bg } = cellColors(art, i, settings);
    if (bg) out.push('<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '" fill="' + bg + '"/>');
    if (glyph === ' ') continue;
    const opacity = edits[i] !== undefined ? 1 : art.background ? art.foreground[i * 4 + 3] / 255 : art.opacity[i] / 255;
    out.push('<text x="' + (x + cw / 2) + '" y="' + (y + ch / 2) + '" fill="'
      + (edits[i] !== undefined ? settings.foreground : fg) + '" opacity="' + opacity + '">' + escapeMarkup(glyph) + '</text>');
  }
  return out.join('') + '</g></svg>';
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob?.type === type ? resolve(blob)
    : reject(new Error('This browser cannot encode ' + type + '. Try PNG.')), type, .94));
}

function rasterPdf(jpeg, width, height) {
  const encoder = new TextEncoder();
  const w = (width * .75).toFixed(2), h = (height * .75).toFixed(2);
  const draw = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Image Do\nQ\n';
  const parts = [];
  let position = 0;
  const add = (item) => {
    const data = typeof item === 'string' ? encoder.encode(item) : item;
    parts.push(data);
    position += data.byteLength;
  };
  const offsets = [0];
  const object = (n, ...value) => {
    offsets[n] = position;
    add(n + ' 0 obj\n');
    value.forEach(add);
    add('\nendobj\n');
  };
  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h
    + '] /Contents 4 0 R /Resources << /XObject << /Image 5 0 R >> >> >>');
  object(4, '<< /Length ' + draw.length + ' >>\nstream\n', draw, 'endstream');
  object(5, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height
    + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.byteLength
    + ' >>\nstream\n', jpeg, '\nendstream');
  const xref = position;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) add(String(offset).padStart(10, '0') + ' 00000 n \n');
  add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, { type: 'application/pdf' });
}

export async function exportArtwork(art, metrics, settings, options) {
  const { format, layers = [], edits = {} } = options;
  const plain = ['txt', 'ascii', 'ansi', 'nfo', 'md', 'svg', 'html', 'json'];
  if (layers.some((layer) => layer.visible) && plain.includes(format)) {
    throw new Error('Visible typography layers require PNG, JPEG, WebP, PDF or a project file.');
  }
  const blob = (content, type) => new Blob([content], { type });
  if (['png', 'jpeg', 'webp', 'pdf'].includes(format)) {
    const s = ['jpeg', 'pdf'].includes(format) ? { ...settings, transparent: false } : settings;
    const canvas = renderComposition(makeCanvas(1, 1), art, metrics, s, options);
    if (format === 'pdf') {
      const jpeg = await canvasBlob(canvas, 'image/jpeg');
      return rasterPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
    }
    return canvasBlob(canvas, 'image/' + format);
  }
  if (format === 'svg') return blob(svgMarkup(art, metrics, settings, options), 'image/svg+xml');
  if (format === 'html') {
    const svg = svgMarkup(art, metrics, settings, options);
    return blob('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>ASCII-Catalyst Artwork</title><style>body{margin:0}svg{display:block;max-width:100%;height:auto}</style>' + svg + '</html>', 'text/html');
  }
  if (format === 'json') {
    return blob(JSON.stringify({
      version: 1, cols: art.cols, rows: art.rows, glyphs: art.glyphs, cells: [...art.cells], edits,
      foreground: [...art.foreground], background: art.background ? [...art.background] : null,
      opacity: [...art.opacity], metrics, settings,
    }), 'application/json');
  }
  if (format === 'ansi') return blob(ansiText(art, settings, edits), 'text/plain;charset=utf-8');
  const text = artworkText(art, { edits, trim: options.trim, strict: format === 'ascii' });
  if (format === 'nfo') return blob(encodeCp437(text), 'application/octet-stream');
  if (format === 'md') {
    const ticks = String.fromCharCode(96);
    const fence = ticks.repeat(Math.max(3, ...Array.from(text.matchAll(/[\x60]+/g), (match) => match[0].length + 1)));
    return blob(fence + 'text\n' + text + '\n' + fence + '\n', 'text/markdown;charset=utf-8');
  }
  return blob(text, 'text/plain;charset=utf-8');
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
