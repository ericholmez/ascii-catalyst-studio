import { randomAt } from './math.js';
import { DEFAULT_PALETTE, normalizePalette } from './palette.js';
import { validPerspective } from './perspective.js';

export const RAMPS = {
  Classic: ' .:-=+*#%@',
  Extended: ' .\x27·,:;!iIl|/\\()1[]?-_+~<>rcvunxzjftLCJUYXZO0Qmwqpdbkhao*#MW&8%B@$',
  Directional: ' .:_-=/\\|Iil+XTL7JC()O*#@',
  Blocks: ' ░▒▓█',
  Binary: ' 01',
  Typewriter: ' .,:;-=+oxOX#',
  Punctuation: ' .\x27,:;^~"-_=/\\()!?+*#',
  Geometry: ' .·:•+oO0xX#%',
  Hexadecimal: ' .0123456789ABCDEF',
  'Printable ASCII': Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''),
};

export const DEFAULTS = Object.freeze({
  mode: 'hybrid', ramp: RAMPS.Directional, library: 'Directional', columns: 132, rows: 60,
  lockAspect: true, lineHeight: 1.12, spacing: 0, font: 'mono', weight: 400,
  brightness: 0, exposure: 0, contrast: 16, gamma: 1, black: 0, white: 100, saturation: 100,
  contrastPivot: 50, shadows: 0, midtones: 0, highlights: 0, vibrance: 0, temperature: 0, tint: 0,
  curve0: 0, curve25: 25, curve50: 50, curve75: 75, curve100: 100,
  soften: 0, detail: 0, grain: 0, posterize: 0, hardThreshold: false, cutoff: 50,
  denoise: 0, pixelSize: 1,
  invert: false, flipX: false, flipY: false, rotation: 0, grayscale: 'perceptual',
  cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100,
  perspective: null,
  maskMode: 'off', maskThreshold: 50, maskTolerance: 18, maskFeather: 10, maskColor: '#808080', maskInvert: false,
  sampling: 'average', mapping: 'linear', foreground: '#eaeaea', background: '#101010',
  transparent: false, color: 'mono', lowInk: '#3f5d9c', highInk: '#f0e5bf', dither: 'none', intensity: 35, seed: 42,
  palette: DEFAULT_PALETTE,
  colorDither: 'none', colorDitherStrength: 70, colorDitherSeed: 42,
  edge: 54, shape: 40, threshold: 48, edgeOperator: 'sobel', polarity: 'light',
  quality: 'standard', dropout: 0, text: 'TEXT AS MEDIUM. DATA AS MATERIAL. ', scale: 2,
});

export const MODES = {
  tonal: 'Classic tonal', density: 'Font-aware density', edges: 'Edge-aware',
  structure: 'Shape matching', hybrid: 'Hybrid', braille: 'Braille dots',
  half: 'Half blocks', fixed: 'Fixed text',
};

export const PRESETS = [
  ['Classic', 'Traditional tonal rendering', { mode: 'tonal', library: 'Classic' }, 'Tone'],
  ['Blueprint', 'Directional architectural detail', { mode: 'edges', library: 'Directional', edge: 80, contrast: 30 }, 'Structure'],
  ['Monolith', 'Dense block shading', { mode: 'density', library: 'Blocks', contrast: 40 }, 'Tone'],
  ['Trace', 'Structural outlines with strong shape matching', { mode: 'structure', library: 'Directional', edge: 85, shape: 75 }, 'Structure'],
  ['Braille', 'Two by four dot matrix', { mode: 'braille', threshold: 55 }, 'Patterns'],
  ['Typewriter', 'Dark ink on pale paper', { mode: 'density', library: 'Typewriter', polarity: 'dark', foreground: '#202020', background: '#eaeaea' }, 'Print'],
  ['Signal', 'Seeded character dropout', { mode: 'hybrid', library: 'Binary', dropout: 17, dither: 'bayer' }, 'Patterns'],
  ['Chromatic', 'Source colours in half blocks', { mode: 'half', color: 'source' }, 'Colour'],
  ['Chromotype', 'Two-colour cobalt and ivory ink gradient', { mode: 'density', library: 'Extended', color: 'duotone', shadows: 18, contrast: 24 }, 'Colour'],
  ['Newspaper', 'Coarse dots with ordered halftone and paper tones', {
    mode: 'density', library: 'Typewriter', dither: 'bayer', intensity: 67, grain: 12,
    polarity: 'dark', foreground: '#262319', background: '#e9dec2', contrast: 30,
  }, 'Print'],
  ['Carbon Copy', 'Grainy hard cuts through dark transfer ink', {
    mode: 'hybrid', library: 'Punctuation', hardThreshold: true, cutoff: 47,
    grain: 25, detail: 35, invert: true, foreground: '#d2cabd', background: '#211e1a',
  }, 'Print'],
  ['Silver Gelatin', 'Softer shadows with a broad tonal ramp', {
    mode: 'density', library: 'Extended', shadows: 17, highlights: -18, gamma: 1.16,
    soften: 18, dither: 'floyd', intensity: 60, contrast: 32,
  }, 'Tone'],
  ['Solarized', 'Four-level negative in gold and violet', {
    mode: 'tonal', library: 'Classic', color: 'duotone', lowInk: '#633394', highInk: '#ffda71',
    background: '#180f23', invert: true, posterize: 4, contrast: 26,
  }, 'Colour'],
  ['Wireframe', 'Sharpened Scharr gradients and directional punctuation', {
    mode: 'edges', library: 'Punctuation', edgeOperator: 'scharr', edge: 92, detail: 54, black: 20, contrast: 46,
  }, 'Structure'],
  ['Isoline', 'Flattened tonal bands with edge-aware glyphs', {
    mode: 'hybrid', library: 'Geometry', posterize: 5, soften: 46, edge: 76, shape: 44, contrast: 23,
  }, 'Structure'],
  ['Phosphor', 'Green terminal text with diffused glyph density', {
    mode: 'density', library: 'Hexadecimal', foreground: '#a6ef87', background: '#111e14',
    dither: 'atkinson', intensity: 79, shadows: 8, contrast: 38,
  }, 'Colour'],
  ['Negative Space', 'A high threshold leaves only the strongest marks', {
    mode: 'density', library: 'Geometry', hardThreshold: true, cutoff: 71, contrast: 32, soften: 25,
  }, 'Tone'],
  ['Stipple', 'A sparse, seeded field of Braille dots', {
    mode: 'braille', threshold: 49, dither: 'random', grain: 38, soften: 20, intensity: 90, contrast: 8,
  }, 'Patterns'],
];

export const TONE_KEYS = ['brightness', 'contrast', 'exposure', 'gamma', 'contrastPivot',
  'shadows', 'midtones', 'highlights', 'black', 'white', 'invert'];
export const TEXTURE_KEYS = ['denoise', 'pixelSize', 'soften', 'detail', 'grain', 'posterize', 'hardThreshold', 'cutoff'];
export const CURVE_KEYS = ['curve0', 'curve25', 'curve50', 'curve75', 'curve100'];
export const CROP_KEYS = ['cropX', 'cropY', 'cropWidth', 'cropHeight'];
export const MASK_KEYS = ['maskMode', 'maskThreshold', 'maskTolerance', 'maskFeather', 'maskColor', 'maskInvert'];

export function varySettings(settings) {
  const seed = (settings.seed + 1) % 2147483648;
  const centered = (index, limit) => Math.round((randomAt(index, seed) * 2 - 1) * limit);
  return {
    seed, brightness: settings.brightness + centered(1, 12),
    contrast: settings.contrast + centered(2, 22),
    midtones: settings.midtones + centered(3, 24),
    grain: Math.max(0, settings.grain + centered(4, 20)),
    dither: ['none', 'bayer', 'random', 'floyd', 'atkinson'][Math.floor(randomAt(5, seed) * 5)],
    intensity: 25 + Math.round(randomAt(6, seed) * 55),
  };
}

export const FONT_FAMILIES = {
  mono: '"IBM Plex Mono Catalyst", "IBM Plex Mono", Consolas, "Liberation Mono", monospace',
  courier: '"Courier New", "Liberation Mono", monospace',
  system: 'monospace',
};

export function cleanGlyphs(value, limit = 1024) {
  return [...String(value).slice(0, limit)]
    .filter((glyph) => glyph === ' ' || !/[\p{C}\p{M}\p{Z}]/u.test(glyph));
}

const choices = {
  mode: Object.keys(MODES), font: Object.keys(FONT_FAMILIES), sampling: ['average', 'center', 'minimum', 'maximum', 'median', 'gaussian'],
  mapping: ['linear', 'gamma', 'equalized'], edgeOperator: ['sobel', 'scharr', 'prewitt'],
  grayscale: ['perceptual', 'linear', 'average'], polarity: ['light', 'dark'],
  maskMode: ['off', 'highlights', 'shadows', 'colour'],
  color: ['mono', 'source', 'ansi16', 'gray4', 'duotone', 'palette'], dither: ['none', 'random', 'bayer', 'floyd', 'atkinson'],
  colorDither: ['none', 'random', 'bayer', 'floyd', 'atkinson'],
  quality: ['draft', 'standard', 'final'], rotation: [0, 90, 180, 270], weight: [400, 700],
};
const ranges = {
  columns: [16, 480], rows: [1, 480], lineHeight: [.8, 2], spacing: [-2, 6],
  brightness: [-100, 100], exposure: [-3, 3], contrast: [-100, 100], gamma: [.2, 4],
  contrastPivot: [0, 100], shadows: [-100, 100], midtones: [-100, 100], highlights: [-100, 100],
  curve0: [0, 100], curve25: [0, 100], curve50: [0, 100], curve75: [0, 100], curve100: [0, 100],
  cropX: [0, 99], cropY: [0, 99], cropWidth: [1, 100], cropHeight: [1, 100],
  maskThreshold: [0, 100], maskTolerance: [0, 100], maskFeather: [0, 100],
  vibrance: [-100, 100], temperature: [-100, 100], tint: [-100, 100],
  soften: [0, 100], detail: [0, 100], grain: [0, 100], posterize: [0, 16], cutoff: [0, 100],
  denoise: [0, 100], pixelSize: [1, 24],
  black: [0, 99], white: [1, 100], saturation: [0, 200], intensity: [0, 100],
  colorDitherStrength: [0, 100], colorDitherSeed: [0, 2147483647],
  seed: [0, 2147483647], edge: [0, 100], shape: [0, 100], threshold: [0, 100], dropout: [0, 100], scale: [1, 8],
};

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = input[key];
    if (value == null) continue;
    if (key === 'palette') {
      const palette = normalizePalette(value);
      if (palette.length) s.palette = palette;
    } else if (key === 'perspective') {
      if (validPerspective(value)) s.perspective = value.slice();
    } else if (choices[key]) {
      if (choices[key].includes(value)) s[key] = value;
    } else if (ranges[key]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [min, max] = ranges[key];
      const bounded = Math.max(min, Math.min(max, value));
      s[key] = ['exposure', 'gamma', 'lineHeight', 'spacing'].includes(key) ? bounded : Math.round(bounded);
      if (key === 'posterize' && s[key] === 1) s[key] = 2;
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value === 'boolean') s[key] = value;
    } else if (['foreground', 'background', 'lowInk', 'highInk', 'maskColor'].includes(key)) {
      if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) s[key] = value;
    } else if (typeof value === 'string') {
      s[key] = value.slice(0, key === 'text' ? 8192 : 1024);
    }
  }
  s.cropWidth = Math.min(s.cropWidth, 100 - s.cropX);
  s.cropHeight = Math.min(s.cropHeight, 100 - s.cropY);
  return s;
}
