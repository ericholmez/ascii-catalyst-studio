import { PATCH_W, PATCH_H } from './glyphs.js';
import { cropRect, randomAt } from './math.js';
import { perspectiveLimit, perspectiveMatrix, perspectiveSize, projectPoint, warpPerspective } from './perspective.js';

const svgTags = new Set(('svg g path polygon polyline rect circle ellipse line defs linearGradient radialGradient stop '
  + 'clipPath mask use symbol title desc pattern').split(' '));
const svgAttrs = new Set(('id viewBox width height x y x1 x2 y1 y2 rx ry cx cy r fx fy d points transform '
  + 'preserveAspectRatio fill fill-opacity fill-rule stroke stroke-width stroke-dasharray stroke-dashoffset '
  + 'stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit opacity clip-path clip-rule mask '
  + 'gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity patternUnits patternContentUnits '
  + 'patternTransform clipPathUnits maskUnits maskContentUnits href').split(' '));

export function sanitizeSvg(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG documents with XML declarations for entities are unsupported.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || doc.querySelector('parsererror')) {
    throw new Error('The SVG could not be read.');
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.namespaceURI !== root.namespaceURI || !svgTags.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes]) {
      const localReference = /^#[\w.-]+$/.test(attr.value);
      const validUrl = !/url\s*\(/i.test(attr.value) || /^url\(\s*#[\w.-]+\s*\)$/.test(attr.value);
      const allowed = svgAttrs.has(attr.localName) && validUrl
        && (attr.localName === 'href' ? localReference : !attr.namespaceURI);
      if (!allowed) node.removeAttributeNode(attr);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function decodeImage(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose an image smaller than 40 MB.');
  let blob = file;
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    blob = new Blob([sanitizeSvg(await file.text())], { type: 'image/svg+xml' });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = img.naturalWidth, height = img.naturalHeight;
    if (!width || !height || width * height > 36000000) throw new Error('Choose an image under 36 megapixels.');
    const canvas = makeCanvas(width, height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { canvas, name: file.name || 'Pasted image', type: blob.type || 'image', size: file.size, blob };
  } catch (error) {
    if (error.message === 'Choose an image under 36 megapixels.') throw error;
    throw new Error('This browser could not decode the image. Try PNG, JPEG, WebP, or SVG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function sampleSource(canvas, cols, rows, settings) {
  const target = makeCanvas(cols * PATCH_W, rows * PATCH_H);
  const ctx = target.getContext('2d', { willReadFrequently: true });
  drawFramedSource(ctx, canvas, settings);
  return ctx.getImageData(0, 0, target.width, target.height).data;
}

let rectification;

export function correctedSource(source, settings) {
  if (!settings.perspective) return source;
  const limit = perspectiveLimit(settings.quality);
  const key = limit + ':' + settings.perspective.join(',');
  if (rectification?.source === source && rectification.key === key) return rectification.canvas;
  const scale = Math.min(1, limit / Math.max(source.width, source.height));
  const input = makeCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const inputCtx = input.getContext('2d', { willReadFrequently: true });
  inputCtx.imageSmoothingQuality = 'high';
  inputCtx.drawImage(source, 0, 0, input.width, input.height);
  const { width, height } = perspectiveSize(source.width, source.height, settings.perspective, limit);
  const warped = warpPerspective(inputCtx.getImageData(0, 0, input.width, input.height).data,
    input.width, input.height, width, height, settings.perspective);
  const canvas = makeCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(warped, width, height), 0, 0);
  rectification = { source, key, canvas };
  return canvas;
}

export function drawFramedSource(ctx, original, settings) {
  const source = correctedSource(original, settings);
  const target = ctx.canvas;
  const crop = cropRect(source.width, source.height, settings);
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const width = rotated ? target.height : target.width;
  const height = rotated ? target.width : target.height;
  ctx.save();
  ctx.translate(target.width / 2, target.height / 2);
  ctx.rotate(settings.rotation * Math.PI / 180);
  ctx.scale(settings.flipX ? -1 : 1, settings.flipY ? -1 : 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, -width / 2, -height / 2, width, height);
  ctx.restore();
}

export const SAMPLES = ['Concrete Study', 'Orbital Field', 'Calibration Chart', 'Perspective Chart', 'Colour Study'];

export function sampleImage(name = SAMPLES[0], phase = 0, seed = 14) {
  const canvas = makeCanvas(960, 720);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const polygon = (points, fill, stroke = null) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, 960, 720);
  if (name === SAMPLES[0]) {
    const sky = ctx.createRadialGradient(575, 370, 60, 520, 380, 580);
    sky.addColorStop(0, '#3b3b3b');
    sky.addColorStop(1, '#0c0c0c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 960, 720);
    polygon([[0, 650], [485, 570], [960, 652], [960, 720], [0, 720]], '#333333');
    polygon([[78, 654], [430, 575], [797, 628], [963, 720], [0, 720]], '#6c6c6c');
    polygon([[209, 580], [557, 517], [803, 586], [803, 661], [530, 687], [209, 624]], '#999999');
    polygon([[209, 580], [570, 520], [803, 586], [530, 623]], '#c4c4c4');
    polygon([[530, 623], [803, 586], [803, 659], [530, 687]], '#4d4d4d');
    const offset = 8 * Math.sin(phase);
    for (let level = 0; level < 10; level++) {
      const y = 570 - level * 45;
      const center = 539 + level * 6 + offset;
      const left = 287 + level * 17 + (level % 3 === 0 ? -32 : 0);
      const right = 763 - level * 7;
      const depth = 56 - level * 2;
      polygon([[left, y], [center, y + depth], [right, y + 12], [right, y + 40], [center, y + depth + 30], [left, y + 28]], '#626262');
      polygon([[left, y], [left + 16, y - 18], [center + 4, y - 59], [right, y + 12], [center, y + depth]], '#c2c2c2');
      polygon([[left, y], [center, y + depth], [center, y + depth + 30], [left, y + 28]], '#b4b4b4', '#e2e2e2');
      polygon([[center, y + depth], [right, y + 12], [right, y + 40], [center, y + depth + 30]], '#606060', '#8b8b8b');
      for (let i = 1; i < 9; i++) {
        const t = i / 10;
        const x = left + t * (center - left);
        const w = (center - left) * .071;
        const wy = y + t * depth + 7;
        polygon([[x, wy], [x + w, wy + depth * .071], [x + w, wy + depth * .071 + 12], [x, wy + 12]], '#262626');
        const rx = center + t * (right - center);
        const rw = (right - center) * .075;
        const ry = y + depth + (12 - depth) * t + 7;
        polygon([[rx, ry], [rx + rw, ry + (12 - depth) * .075], [rx + rw, ry + (12 - depth) * .075 + 13], [rx, ry + 13]], '#272727');
      }
    }
    polygon([[465, 156], [590, 91], [700, 136], [620, 182]], '#dbdbdb');
    polygon([[465, 156], [620, 182], [620, 216], [465, 190]], '#b0b0b0');
    polygon([[620, 182], [700, 136], [700, 173], [620, 216]], '#6a6a6a');
    ctx.strokeStyle = '#898989';
    ctx.beginPath();
    ctx.moveTo(590, 93);
    ctx.lineTo(590, 52);
    ctx.stroke();
    const noise = ctx.getImageData(0, 0, 960, 720);
    for (let i = 0; i < noise.data.length; i += 4) {
      const value = (randomAt(i, seed) - .5) * 27;
      noise.data[i] += value;
      noise.data[i + 1] += value;
      noise.data[i + 2] += value;
    }
    ctx.putImageData(noise, 0, 0);
  } else if (name === SAMPLES[1]) {
    ctx.translate(480, 340);
    for (let i = 45; i > 0; i--) {
      const radius = 8 * i;
      const tone = Math.round(110 + 105 * Math.sin(i * .27 + phase));
      ctx.strokeStyle = 'rgb(' + tone + ' ' + tone + ' ' + tone + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * .65, i * .11 + phase, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (name === SAMPLES[3]) {
    const plane = perspectiveMatrix([.25, .16, .76, .27, .88, .86, .12, .77]);
    const project = (x, y) => {
      const [u, v] = projectPoint(plane, x, y);
      return [u * canvas.width, v * canvas.height];
    };
    polygon([project(0, 0), project(1, 0), project(1, 1), project(0, 1)], '#bababa', '#ededed');
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        const tone = (x + y) % 2 ? '#b9b9b9' : '#343434';
        const u = x / 16, v = y / 12, right = (x + 1) / 16, bottom = (y + 1) / 12;
        polygon([project(u, v), project(right, v), project(right, bottom), project(u, bottom)], tone, '#828282');
      }
    }
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const [u, v] = project(x, y);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(u - 5, v - 5, 10, 10);
    }
  } else if (name === SAMPLES[4]) {
    const sky = ctx.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, '#1b1c43');
    sky.addColorStop(1, '#935f83');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 960, 720);
    ctx.fillStyle = '#f4ba79';
    ctx.beginPath();
    ctx.arc(490, 310, 160, 0, Math.PI * 2);
    ctx.fill();
    polygon([[0, 463], [143, 300], [251, 358], [319, 273], [418, 419],
      [577, 315], [648, 354], [754, 259], [960, 442], [960, 720], [0, 720]], '#353459');
    polygon([[0, 494], [158, 416], [250, 478], [401, 404], [541, 473], [676, 426],
      [818, 487], [960, 416], [960, 720], [0, 720]], '#58677d');
    polygon([[0, 552], [149, 531], [316, 570], [481, 501], [651, 561],
      [797, 513], [960, 557], [960, 720], [0, 720]], '#3a8590');
    for (let i = 0; i < 13; i++) {
      const y = 565 + i * 11;
      const center = 490 + Math.sin(i * 1.7) * 28;
      ctx.fillStyle = i % 3 === 0 ? '#f3bc82' : '#c8878a';
      ctx.fillRect(center - 19 - i * 7, y, 38 + i * 14, 2 + (i % 3));
    }
  } else {
    const ramp = ctx.createLinearGradient(85, 0, 875, 0);
    ramp.addColorStop(0, '#000');
    ramp.addColorStop(1, '#fff');
    ctx.fillStyle = ramp;
    ctx.fillRect(85, 100, 790, 150);
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 12; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#eee' : '#222';
        ctx.fillRect(105 + x * 18, 350 + y * 18, 18, 18);
      }
    }
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(680, 460, 118, 0, Math.PI * 2);
    ctx.moveTo(540, 600);
    ctx.lineTo(820, 318);
    ctx.stroke();
  }
  return { canvas, name: name + '.png', sample: name, type: 'image/png', size: 0 };
}
