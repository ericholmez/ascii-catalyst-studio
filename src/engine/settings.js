export const RAMPS = {
  Classic: ' .:-=+*#%@',
  Extended: ' .\x27·,:;!iIl|/\\()1[]?-_+~<>rcvunxzjftLCJUYXZO0Qmwqpdbkhao*#MW&8%B@$',
  Directional: ' .:_-=/\\|Iil+XTL7JC()O*#@',
  Blocks: ' ░▒▓█',
  Binary: ' 01',
  Typewriter: ' .,:;-=+oxOX#',
  'Printable ASCII': Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''),
};

export const DEFAULTS = Object.freeze({
  mode: 'hybrid', ramp: RAMPS.Directional, library: 'Directional', columns: 132, rows: 60,
  lockAspect: true, lineHeight: 1.12, spacing: 0, font: 'mono', weight: 400,
  brightness: 0, exposure: 0, contrast: 16, gamma: 1, black: 0, white: 100, saturation: 100,
  invert: false, flipX: false, flipY: false, rotation: 0, grayscale: 'perceptual',
  sampling: 'average', mapping: 'linear', foreground: '#eaeaea', background: '#101010',
  transparent: false, color: 'mono', dither: 'none', intensity: 35, seed: 42,
  edge: 54, shape: 40, threshold: 48, edgeOperator: 'sobel', polarity: 'light',
  quality: 'standard', dropout: 0, text: 'TEXT AS MEDIUM. DATA AS MATERIAL. ', scale: 2,
});

export const MODES = {
  tonal: 'Classic tonal', density: 'Font-aware density', edges: 'Edge-aware',
  structure: 'Shape matching', hybrid: 'Hybrid', braille: 'Braille dots',
  half: 'Half blocks', fixed: 'Fixed text',
};

export const PRESETS = [
  ['Classic', 'Traditional tonal rendering', { mode: 'tonal', library: 'Classic' }],
  ['Blueprint', 'Directional architectural detail', { mode: 'edges', library: 'Directional', edge: 80, contrast: 30 }],
  ['Monolith', 'Dense block shading', { mode: 'density', library: 'Blocks', contrast: 40 }],
  ['Trace', 'Sparse structural outlines', { mode: 'structure', library: 'Directional', edge: 85, shape: 75 }],
  ['Braille', 'Two by four dot matrix', { mode: 'braille', threshold: 55 }],
  ['Typewriter', 'Dark ink on pale paper', { mode: 'density', library: 'Typewriter', polarity: 'dark', foreground: '#202020', background: '#eaeaea' }],
  ['Signal', 'Seeded character dropout', { mode: 'hybrid', library: 'Binary', dropout: 17, dither: 'bayer' }],
  ['Chromatic', 'Source colours in half blocks', { mode: 'half', color: 'source' }],
];

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
  color: ['mono', 'source', 'ansi16', 'gray4'], dither: ['none', 'random', 'bayer', 'floyd', 'atkinson'],
  quality: ['draft', 'standard', 'final'], rotation: [0, 90, 180, 270], weight: [400, 700],
};
const ranges = {
  columns: [16, 480], rows: [1, 480], lineHeight: [.8, 2], spacing: [-2, 6],
  brightness: [-100, 100], exposure: [-3, 3], contrast: [-100, 100], gamma: [.2, 4],
  black: [0, 99], white: [1, 100], saturation: [0, 200], intensity: [0, 100],
  seed: [0, 2147483647], edge: [0, 100], shape: [0, 100], threshold: [0, 100], dropout: [0, 100], scale: [1, 8],
};

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = input[key];
    if (value == null) continue;
    if (choices[key]) {
      if (choices[key].includes(value)) s[key] = value;
    } else if (ranges[key]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [min, max] = ranges[key];
      const bounded = Math.max(min, Math.min(max, value));
      s[key] = ['exposure', 'gamma', 'lineHeight', 'spacing'].includes(key) ? bounded : Math.round(bounded);
    } else if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value === 'boolean') s[key] = value;
    } else if (key === 'foreground' || key === 'background') {
      if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) s[key] = value;
    } else if (typeof value === 'string') {
      s[key] = value.slice(0, key === 'text' ? 8192 : 1024);
    }
  }
  return s;
}
