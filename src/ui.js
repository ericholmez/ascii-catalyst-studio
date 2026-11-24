import { escapeMarkup as esc, FORMATS } from './engine/export.js';
import { MODES, PRESETS, RAMPS } from './engine/settings.js';
import { SAMPLES } from './engine/image.js';

export const WORKSPACES = {
  create: 'Create', characters: 'Character Lab', compositor: 'Compositor', text: 'Text Lab',
  motion: 'Motion', archive: 'Archive', output: 'Output', index: 'Index',
};

const attr = (key, value) => ' data-' + key + '="' + esc(value) + '"';
export const button = (name, action, extra = '') => '<button data-action="' + action + '"' + extra + '>' + esc(name) + '</button>';
const section = (title, body, index = '') => '<section class="section"><h2 class="section-title">'
  + (index ? '<span>' + index + '</span>' : '') + esc(title) + '</h2>' + body + '</section>';
const details = (title, body, open = false) => '<details class="section"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary>' + body + '</details>';
const hint = (msg) => '<p class="hint">' + esc(msg) + '</p>';
const field = (title, body, id) => '<div class="field"><label for="' + id + '">' + esc(title) + '</label>' + body + '</div>';
const options = (entries, value) => entries.map(([key, label]) => '<option value="' + esc(key) + '"'
  + (String(value) === String(key) ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
const select = (key, name, value, entries, group = 'setting') => field(name, '<select id="' + key + '"'
  + attr(group, key) + '>' + options(entries, value) + '</select>', key);
const check = (key, name, value, group = 'setting') => '<div class="field"><label class="check"><input type="checkbox"'
  + attr(group, key) + (value ? ' checked' : '') + '> ' + esc(name) + '</label></div>';
const number = (key, name, value, min, max, step = 1, group = 'setting') => field(name, '<input type="number" id="' + key
  + '" value="' + value + '" min="' + min + '" max="' + max + '" step="' + step + '"' + attr(group, key) + '>', key);
const range = (key, name, value, min, max, step = 1, disabled = false) => {
  const config = ' value="' + value + '" min="' + min + '" max="' + max + '" step="' + step + '"' + attr('setting', key)
    + (disabled ? ' disabled' : '');
  return field(name, '<div class="range"><input type="range" id="' + key + '"' + config + '>'
    + '<input type="number" aria-label="' + esc(name) + ' value"' + config + '></div>', key);
};
const input = (key, name, value, type = 'text', group = 'setting') => field(name, '<input type="' + type
  + '" id="' + key + '" value="' + esc(value) + '"' + attr(group, key) + '>', key);
const textarea = (key, name, value, group = 'setting') => field(name, '<textarea id="' + key + '" rows="4"'
  + attr(group, key) + ' spellcheck="false">' + esc(value) + '</textarea>', key);
const actions = (...buttons) => '<div class="compact-actions">' + buttons.join('') + '</div>';
const pairs = (object) => Object.entries(object);

function sourceControls(state) {
  return section('Source image', '<button class="source-drop" data-action="upload"><span aria-hidden="true">＋</span> Import image</button>'
    + '<div class="source-row"><span class="hint" title="' + esc(state.source?.name || '') + '">'
    + esc(state.source?.name || 'Drop, paste or browse') + '</span>' + button('Samples', 'samples', ' class="text-button"') + '</div>', '01');
}

function createControls(state) {
  const s = state.settings;
  return sourceControls(state)
    + section('Conversion', select('mode', 'Method', s.mode, pairs(MODES))
      + (['braille', 'half'].includes(s.mode) ? range('threshold', 'Threshold', s.threshold, 0, 100) : '')
      + (s.mode === 'fixed' ? textarea('text', 'Source text', s.text) : select('library', 'Character set', s.library, [
        ...Object.keys(RAMPS).map((key) => [key, key]), ['Custom', 'Custom ramp'],
      ]) + (s.library === 'Custom' ? input('ramp', 'Sparse to dense', s.ramp) : '')), '02')
    + section('Resolution', range('columns', 'Columns', s.columns, 16, 480)
      + check('lockAspect', 'Lock aspect ratio', s.lockAspect)
      + (!s.lockAspect ? range('rows', 'Rows', s.rows, 1, 480) : ''), '03')
    + '<section class="section"><div class="section-heading"><h2 class="section-title">Tone</h2>'
      + button('Reset', 'reset-tone', ' class="text-button" aria-label="Reset tone"') + '</div>'
      + range('brightness', 'Brightness', s.brightness, -100, 100)
      + range('contrast', 'Contrast', s.contrast, -100, 100)
      + range('exposure', 'Exposure (stops)', s.exposure, -3, 3, .1)
      + actions(button('Preview adjustments', 'preview-adjustments', ' aria-pressed="' + (state.view === 'adjusted') + '"'))
      + '</section>'
    + details('Tonal range', range('shadows', 'Shadows', s.shadows, -100, 100)
      + range('midtones', 'Midtones', s.midtones, -100, 100)
      + range('highlights', 'Highlights', s.highlights, -100, 100)
      + range('contrastPivot', 'Contrast pivot', s.contrastPivot, 0, 100)
      + range('gamma', 'Gamma', s.gamma, .2, 4, .05)
      + range('black', 'Black point', s.black, 0, 99) + range('white', 'White point', s.white, 1, 100)
      + check('invert', 'Invert source', s.invert))
    + details('Texture', range('soften', 'Soften', s.soften, 0, 100)
      + range('detail', 'Detail boost', s.detail, 0, 100)
      + range('grain', 'Grain', s.grain, 0, 100)
      + range('posterize', 'Posterize (0 = off)', s.posterize, 0, 16)
      + check('hardThreshold', 'Black and white threshold', s.hardThreshold)
      + (s.hardThreshold ? range('cutoff', 'Threshold point', s.cutoff, 0, 100) : '')
      + number('seed', 'Random seed', s.seed, 0, 2147483647)
      + actions(button('Reset texture', 'reset-texture')))
    + details('Structure', select('edgeOperator', 'Edge operator', s.edgeOperator, [['sobel', 'Sobel'], ['scharr', 'Scharr'], ['prewitt', 'Prewitt']])
      + range('edge', 'Edge influence', s.edge, 0, 100)
      + range('shape', 'Shape fidelity', s.shape, 0, 100)
      + check('map', 'Show method influence', state.map, 'view-setting'))
    + details('Colour and dithering', select('color', 'Ink colours', s.color,
      [['mono', 'Monochrome'], ['source', 'Source colours'], ['gray4', 'Four-tone grey'], ['ansi16', 'ANSI 16'], ['duotone', 'Duotone']])
      + (s.color === 'mono' ? input('foreground', 'Foreground', s.foreground, 'color') : '')
      + (s.color === 'duotone' ? input('lowInk', 'Shadow ink', s.lowInk, 'color') + input('highInk', 'Highlight ink', s.highInk, 'color') : '')
      + input('background', 'Background', s.background, 'color')
      + check('transparent', 'Transparent background', s.transparent)
      + range('saturation', 'Saturation', s.saturation, 0, 200)
      + range('vibrance', 'Vibrance', s.vibrance, -100, 100)
      + range('temperature', 'Temperature', s.temperature, -100, 100)
      + range('tint', 'Tint', s.tint, -100, 100)
      + select('polarity', 'Ink polarity', s.polarity, [['light', 'Light ink'], ['dark', 'Dark ink']])
      + select('dither', 'Dithering', s.dither, [['none', 'None'], ['bayer', 'Ordered Bayer'], ['random', 'Seeded noise'], ['floyd', 'Floyd–Steinberg'], ['atkinson', 'Atkinson']])
      + range('intensity', 'Dither intensity', s.intensity, 0, 100))
    + (state.advanced ? details('Transforms', check('flipX', 'Flip horizontally', s.flipX) + check('flipY', 'Flip vertically', s.flipY)
      + select('rotation', 'Rotation', s.rotation, [0, 90, 180, 270].map((a) => [a, a + '°'])))
      + details('Sampling and effects', select('grayscale', 'Luminance', s.grayscale,
        [['perceptual', 'Weighted display RGB'], ['linear', 'Linear-light sRGB'], ['average', 'RGB average']])
        + select('sampling', 'Cell sample', s.sampling, ['average', 'center', 'minimum', 'maximum', 'median', 'gaussian'].map((key) => [key, key]))
        + select('mapping', 'Tonal mapping', s.mapping, [['linear', 'Linear'], ['gamma', 'Gamma lift'], ['equalized', 'Histogram equalization']])
        + range('dropout', 'Character dropout', s.dropout, 0, 100))
      + details('Typography and quality', fontControls(s) + quality(s)
        + actions(button('Reset settings', 'reset'))) : '');
}

function fontControls(s) {
  return select('font', 'Font', s.font, [['mono', 'IBM Plex Mono'], ['courier', 'Courier New'], ['system', 'System monospace']])
    + select('weight', 'Font weight', s.weight, [[400, 'Regular'], [700, 'Bold']])
    + range('lineHeight', 'Line height', s.lineHeight, .8, 2, .01)
    + range('spacing', 'Letter spacing (px)', s.spacing, -2, 6, .1);
}

export const quality = (s) => select('quality', 'Preview quality', s.quality,
  [['draft', 'Draft'], ['standard', 'Standard'], ['final', 'Final']]);

function characterControls(state) {
  const s = state.settings;
  return section('Character set', select('library', 'Library', s.library,
    [...Object.keys(RAMPS).map((key) => [key, key]), ['Custom', 'Custom']])
    + textarea('ramp', 'Edit ramp', s.ramp)
    + actions(button('Sort by density', 'sort-density'), button('Sort by code', 'sort-code'), button('Export ramp', 'export-ramp')))
    + section('Typography', fontControls(s));
}

function compositorControls(state) {
  const layer = state.layers[state.selectedLayer];
  return section('Manual cells', check('painting', 'Paint on canvas', state.painting, 'view-setting')
    + input('brush', 'Brush glyph', state.brush, 'text', 'view-setting')
    + check('erasing', 'Erase glyph', state.erasing, 'view-setting')
    + actions(button('Clear painted cells', 'clear-edits')))
    + section('Typography layers', actions(button('Add text layer', 'add-layer'))
      + (layer ? input('name', 'Layer name', layer.name, 'text', 'layer')
        + textarea('text', 'Layer text', layer.text, 'layer')
        + number('opacity', 'Opacity (%)', layer.opacity, 0, 100, 1, 'layer')
        + number('size', 'Size (px)', layer.size, 8, 500, 1, 'layer')
        + number('x', 'Offset X', layer.x, -9000, 9000, 1, 'layer')
        + number('y', 'Offset Y', layer.y, -9000, 9000, 1, 'layer')
        + number('rotation', 'Rotation', layer.rotation, -180, 180, 1, 'layer')
        + input('color', 'Text colour', layer.color, 'color', 'layer')
        + select('blend', 'Blend', layer.blend, [['source-over', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['difference', 'Difference']], 'layer')
        + check('visible', 'Visible', layer.visible, 'layer')
        + actions(button('Move up', 'layer-up'), button('Move down', 'layer-down'),
          button('Duplicate', 'layer-duplicate'), button('Delete', 'layer-delete')) : ''));
}

export function outputControls(state, prefix = '') {
  const o = state.exportOptions;
  const rangeKey = prefix + 'scale';
  return select(prefix + 'format', 'Format', o.format, pairs(FORMATS), 'export')
    + (['png', 'jpeg', 'webp', 'pdf', 'svg', 'html'].includes(o.format)
      ? number(rangeKey, 'Output scale', state.settings.scale, 1, 8, 1, 'export')
        + number(prefix + 'margin', 'Margin (px)', o.margin, 0, 500, 1, 'export') : '')
    + (['txt', 'ascii', 'nfo', 'md'].includes(o.format) ? check(prefix + 'trim', 'Trim trailing spaces', o.trim, 'export')
      + (o.trim ? hint('Rows may have different widths after trimming.') : '') : '')
    + (['svg', 'html'].includes(o.format) ? hint('Rendering depends on the fonts available on the viewing device.') : '')
    + (['jpeg', 'pdf'].includes(o.format) ? hint('The artwork background colour is applied to transparent areas.') : '')
    + (o.format === 'project' ? check(prefix + 'embedSource', 'Include source image', o.embedSource, 'export') : '')
    + actions(button('Download', 'download', ' class="primary"'), button('Copy text', 'copy'));
}

const INDEX_TOPICS = [
  ['ASCII and Unicode', 'Strict ASCII accepts the 95 printable codes from U+0020 to U+007E. Blocks and Braille are Unicode. Try the Printable ASCII ramp, then switch the method to Braille.', 'Braille', 'index-braille'],
  ['Glyph density', 'Density is the fraction of a cell covered by rasterized ink. The Character Lab measures this for the active font and spacing.', 'Open Character Lab', 'index-characters'],
  ['Luminance and polarity', 'Linear-light sRGB weights red, green and blue by 0.2126, 0.7152 and 0.0722. Choose light or dark ink to match the artwork background.', 'Classic tonal', 'index-tonal'],
  ['Structure and edges', 'A Sobel gradient measures changes across neighboring samples. Shape matching compares a rasterized glyph with the local image patch.', 'Shape matching', 'index-structure'],
  ['Dithering', 'Error diffusion distributes part of each cell’s density error to nearby cells. Ordered Bayer dithering applies a repeating threshold matrix.', 'Floyd–Steinberg', 'index-dither'],
  ['Aspect ratio', 'Rows depend on the source aspect ratio and the measured advance and line height of the chosen font. Increasing export scale keeps the same characters.', 'Fit artwork', 'fit'],
  ['Terminal output', 'ANSI adds colour escape sequences to text. CP437 NFO stores single-byte IBM PC characters and requires a CP437-aware viewer.', 'Open Output', 'index-output'],
];

export function controlsMarkup(state) {
  const s = state.settings;
  if (state.workspace === 'characters') return characterControls(state);
  if (state.workspace === 'compositor') return compositorControls(state);
  if (state.workspace === 'text') return sourceControls(state) + section('Fixed text', textarea('text', 'Text sequence', s.text)
    + actions(button('Apply to artwork', 'apply-text'))
    + hint('Characters repeat in row order. Opacity follows image tone.')) + section('Typography', fontControls(s));
  if (state.workspace === 'archive') return section('Local projects', input('project-name', 'Project name', state.name, 'text', 'project')
    + actions(button('Save named project', 'save'), button('Import project', 'open'), button('Download project', 'project-download'))
    + hint('Projects are stored in this browser. Download a project file for a portable copy.'));
  if (state.workspace === 'output') return section('Export settings', outputControls(state));
  if (state.workspace === 'index') return INDEX_TOPICS.map(([title, desc, label, action]) =>
    details(title, '<p>' + esc(desc) + '</p>' + actions(button(label, action)), title === INDEX_TOPICS[0][0])).join('');
  if (state.workspace === 'motion') {
    const media = state.media;
    return section('Motion source', actions(button('Open video or GIF', 'open-video'),
      button('Orbital animation', 'animate'), button(media.playing ? 'Pause' : 'Play', 'play-media'))
      + number('seek', 'Position (seconds)', media.time, 0, media.duration || 86400, .05, 'media')
      + actions(button('Previous frame', 'frame-back'), button('Next frame', 'frame-next'))
      + number('fps', 'Target FPS', media.fps, 1, 30, 1, 'media')
      + actions(button('Freeze frame', 'freeze'), button('Snapshot PNG', 'media-snapshot'),
        button(media.recording ? 'Stop recording' : 'Record WebM', 'record-media'))
      + hint('Playback uses the browser’s available media decoders.'))
      + section('Conversion', select('mode', 'Method', s.mode, pairs(MODES))
        + range('columns', 'Columns', s.columns, 16, 480));
  }
  return createControls(state);
}

function diagnosticMarkup(state) {
  const d = state.art?.diagnostic;
  if (state.inspectIndex === null || !state.art) return hint('Click an artwork cell to inspect its glyph selection.');
  if (!d || d.index !== state.inspectIndex) return hint('Calculating candidate scores…');
  const label = ['Tonal', 'Shape', 'Directional', 'Subcell', 'Fixed sequence'][d.influence];
  return '<canvas class="diagnostic-patch" width="4" height="8" aria-label="Processed cell samples" role="img"></canvas>'
    + '<dl class="meta"><dt>Cell</dt><dd>' + (d.index % state.art.cols + 1) + ' × ' + (Math.floor(d.index / state.art.cols) + 1)
    + '</dd><dt>Selected</dt><dd>' + esc(d.glyph === ' ' ? 'Space' : d.glyph) + '</dd><dt>Method</dt><dd>' + label
    + '</dd><dt>Tone</dt><dd>' + (d.tone * 100).toFixed(1) + '%</dd></dl>'
    + (d.candidates.length ? '<dl class="meta">' + d.candidates.map((candidate) => '<dt>' + esc(candidate.glyph === ' ' ? 'Space' : candidate.glyph)
      + '</dt><dd>' + candidate.score.toFixed(3) + '</dd>').join('') + '</dl>' : '');
}

const featured = [0, 1, 8, 9, 13, 17];
const presetGroups = ['Featured', ...new Set(PRESETS.map(([, , , group]) => group)), 'All', 'Saved'];

function presetsMarkup(state) {
  const group = state.presetGroup;
  const builtins = PRESETS.flatMap(([name, description, , category], index) => {
    if (!(group === 'All' || group === category || (group === 'Featured' && featured.includes(index)))) return [];
    return [button(name, 'preset', attr('preset', index)
      + ' title="' + esc(description) + '" aria-pressed="' + (state.activePreset === index) + '"')];
  });
  const saved = group === 'Saved' ? state.presets.map(({ id, name }) =>
    button(name, 'saved-preset', attr('preset-id', id) + ' aria-pressed="' + (state.activePreset === id) + '"')) : [];
  const active = PRESETS[state.activePreset]?.[1] ?? '';
  return section('Presets', select('preset-group', 'Style collection', group, presetGroups.map((key) => [key, key]), 'preset-group')
    + '<div class="preset-grid">' + [...builtins, ...saved].join('') + '</div>'
    + (group === 'Saved' && !saved.length ? hint('No saved presets yet.') : '')
    + (active ? hint(active) : '')
    + actions(button('Vary style', 'vary-style', ' title="Generate a repeatable variation of the current settings"'),
      button('Save preset', 'save-preset'),
      ...(group === 'Saved' && state.presets.some(({ id }) => id === state.activePreset) ? [button('Remove preset', 'remove-preset')] : [])));
}

export function inspectorMarkup(state) {
  const { source, art, atlas } = state;
  if (state.workspace === 'characters') {
    const selected = atlas?.entries.find(({ glyph }) => glyph === state.selectedGlyph) || atlas?.entries[0];
    const glyphs = atlas?.entries || [];
    const layout = '<div class="glyph-grid">' + glyphs.map((item, i) => button(item.glyph === ' ' ? '␣' : item.glyph, 'glyph',
      attr('glyph', i) + ' aria-pressed="' + (selected === item) + '" title="U+' + item.glyph.codePointAt(0).toString(16).toUpperCase() + '"')).join('') + '</div>';
    const sample = selected ? '<div class="glyph-preview">' + esc(selected.glyph === ' ' ? '␣' : selected.glyph) + '</div>'
      + '<dl class="meta"><dt>Code point</dt><dd>U+' + selected.glyph.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
      + '</dd><dt>Ink coverage</dt><dd>' + (selected.density * 100).toFixed(2) + '%</dd><dt>Bounds</dt><dd>'
      + selected.bounds.join(' × ') + '</dd><dt>Axis bias</dt><dd>' + selected.orientation[0].toFixed(2)
      + '</dd><dt>Uses</dt><dd>' + (art?.usage[art.glyphs.indexOf(selected.glyph)] || 0) + '</dd></dl>' : '';
    return section('Glyph atlas', layout + (atlas?.rejected.length ? hint('Excluded for incompatible width or no visible ink: ' + atlas.rejected.join(' ')) : ''))
      + section('Glyph properties', sample);
  }
  if (state.workspace === 'compositor') {
    return section('Layers', '<div class="stack">' + state.layers.map((layer, index) => button(
      (layer.visible ? '◉ ' : '○ ') + layer.name, 'select-layer', attr('layer-index', index) + ' aria-pressed="' + (index === state.selectedLayer) + '"'
    )).reverse().join('') + '<div class="entry">Generated artwork</div></div>')
      + section('Painted cells', hint(Object.keys(state.edits).length + ' cells edited. Edits are shown on their original grid.'));
  }
  if (state.workspace === 'archive') {
    return section('Saved projects', state.archive.length ? state.archive.map(({ id, name }) => '<div class="entry"><strong>'
      + esc(name) + '</strong>' + actions(button('Open', 'archive-open', attr('project-id', id)),
        button('Duplicate', 'archive-copy', attr('project-id', id)), button('Delete', 'archive-delete', attr('project-id', id))) + '</div>').join('')
      + actions(button('Clear archive', 'archive-clear')) : hint('No named projects yet.'));
  }
  const sourceInfo = section('Source preview', source
    ? '<canvas class="thumbnail" width="240" height="132" role="img" aria-label="Source image thumbnail"></canvas>'
      + '<dl class="meta"><dt>File</dt><dd title="' + esc(source.name) + '">' + esc(source.name.length > 22 ? source.name.slice(0, 19) + '…' : source.name)
      + '</dd><dt>Dimensions</dt><dd>' + source.canvas.width + ' × ' + source.canvas.height
      + '</dd><dt>Source</dt><dd>' + (source.sample ? 'Built-in sample' : source.size ? Math.round(source.size / 1024) + ' KB' : 'Local frame') + '</dd></dl>'
    : hint('No source image is loaded.'));
  const histogram = section('Luminance', '<canvas class="histogram" width="240" height="60" role="img" aria-label="Processed luminance histogram"></canvas>'
    + '<div class="histogram-label"><span>0 / BLACK</span><span>255 / WHITE</span></div>');
  if (state.workspace === 'index') return sourceInfo + section('Cell inspector', diagnosticMarkup(state));
  if (state.workspace === 'output') return sourceInfo + section('Artwork data', art
    ? hint(art.cols + ' columns × ' + art.rows + ' rows. Text exports preserve the cell grid and any painted characters.')
    : hint('Load an image to generate artwork.'));
  if (state.workspace === 'motion') {
    return section('Playback', hint(state.media.message))
      + histogram;
  }
  return sourceInfo + (state.workspace === 'create' ? presetsMarkup(state) : '') + histogram + section('Cell inspector', diagnosticMarkup(state));
}

export function paintInspector(state, root) {
  const thumbnail = root.querySelector('.thumbnail');
  if (state.source && thumbnail) {
    const source = state.source.canvas;
    const ctx = thumbnail.getContext('2d');
    ctx.clearRect(0, 0, thumbnail.width, thumbnail.height);
    const scale = Math.max(thumbnail.width / source.width, thumbnail.height / source.height);
    ctx.drawImage(source, (thumbnail.width - source.width * scale) / 2, (thumbnail.height - source.height * scale) / 2,
      source.width * scale, source.height * scale);
  }
  const hist = root.querySelector('.histogram');
  if (state.art && hist) {
    const ctx = hist.getContext('2d');
    const bins = state.art.histogram;
    const max = Math.log1p(Math.max(...bins));
    ctx.clearRect(0, 0, hist.width, hist.height);
    ctx.fillStyle = '#a3a3a3';
    for (let i = 0; i < bins.length; i++) {
      const height = max ? Math.log1p(bins[i]) / max * (hist.height - 4) : 0;
      ctx.fillRect(i / bins.length * hist.width, hist.height - height, 1, height);
    }
  }
  const patch = root.querySelector('.diagnostic-patch');
  if (patch && state.art?.diagnostic) {
    const ctx = patch.getContext('2d');
    for (let i = 0; i < state.art.diagnostic.patch.length; i++) {
      const n = Math.round(state.art.diagnostic.patch[i] * 255);
      ctx.fillStyle = 'rgb(' + n + ' ' + n + ' ' + n + ')';
      ctx.fillRect(i % 4, Math.floor(i / 4), 1, 1);
    }
  }
}

export function dialogMarkup(title, content) {
  return '<div class="dialog-body"><div class="dialog-top"><h2 id="dialog-title">' + esc(title)
    + '</h2>' + button('×', 'close-dialog', ' aria-label="Close dialog"') + '</div>' + content + '</div>';
}

export const samplesMarkup = () => '<div class="stack">' + SAMPLES.map((name, i) => button(name, 'sample', attr('sample', i))).join('') + '</div>';
export const projectNameMarkup = (state) => input('dialog-project-name', 'Project name', state.name, 'text', 'project')
  + actions(button('Save locally', 'save-local', ' class="primary"'), button('Download project', 'project-download'));
export const presetNameMarkup = () => '<div class="field"><label for="preset-name">Preset name</label>'
  + '<input type="text" id="preset-name" maxlength="48" autocomplete="off" autofocus></div>'
  + actions(button('Save locally', 'save-preset-local', ' class="primary"'));
