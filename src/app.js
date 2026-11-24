import { convert } from './engine/convert.js';
import { fontMetrics, glyphAtlas, PATCH_W, PATCH_H } from './engine/glyphs.js';
import { correctedSource, decodeImage, drawFramedSource, sampleImage, sampleSource, SAMPLES } from './engine/image.js';
import { clamp, cropRect, gridSize, rgbHex } from './engine/math.js';
import { validPerspective } from './engine/perspective.js';
import { renderComposition } from './engine/render.js';
import { CROP_KEYS, CURVE_KEYS, DEFAULTS, MASK_KEYS, MODES, normalizeSettings, PRESETS, RAMPS,
  TONE_KEYS, TEXTURE_KEYS, cleanGlyphs, varySettings } from './engine/settings.js';
import { artworkText, download, escapeMarkup, exportArtwork } from './engine/export.js';
import { normalizeLayers, presetStorage, projectSource, serializeProject, snapshotProject, storage, validateProject } from './project.js';
import { MediaSession } from './media.js';
import { button, controlsMarkup, dialogMarkup, inspectorMarkup, outputControls, paintCurve, paintInspector, paintPerspectiveGuide,
  presetNameMarkup, projectNameMarkup, quality, samplesMarkup, WORKSPACES } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const app = $('#app');
const viewport = $('#viewport');
const board = $('#artboard');
const artCanvas = $('#art-canvas');
const original = $('#source-canvas');
const cropSource = $('#crop-source-canvas');
const perspectiveGuide = $('#perspective-guide');
const comparison = $('#compare-canvas');
const adjusted = $('#adjusted-canvas');
const controls = $('#controls');
const inspector = $('#inspector');
const dialog = $('#dialog');
const repositoryUrl = $('meta[name="ascii-repository"]').content;
const state = {
  name: 'Untitled', projectId: null, settings: { ...DEFAULTS }, source: null, art: null,
  metrics: null, atlas: null, workspace: 'create', view: 'art', advanced: false, activePreset: -1,
  presets: [], presetGroup: 'Featured',
  sourceTool: null, toolView: 'art', draftCrop: null,
  draftCorners: [], cornerCursor: { x: .15, y: .15 },
  scale: 1, panX: 0, panY: 0, grid: false, map: false, selectedGlyph: '',
  inspectIndex: null, layers: [], selectedLayer: -1, edits: {}, editGrid: '', archive: [],
  painting: false, erasing: false, brush: '@',
  exportOptions: { format: 'png', margin: 0, trim: false, embedSource: true },
};
const undoStack = [];
const redoStack = [];
let worker, workerUnavailable = false, pending = false, timer, job = 0, toastTimer, autosaveTimer;
let sampled, gesture, dialogType, sourceRequest = 0, hasRecovery = false;
let comparedSource, comparedFrame, cropPreviewSource;
let initialized = false;

const frameKeys = [...CROP_KEYS, 'rotation', 'flipX', 'flipY', 'perspective'];
const frameKey = (settings) => settings.quality + ':' + frameKeys.map((key) => settings[key]).join(',');
const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const cornerStarts = [{ x: .15, y: .15 }, { x: .85, y: .15 }, { x: .85, y: .85 }, { x: .15, y: .85 }];

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function errorMessage(error) {
  toast(error.message || String(error));
}

function status(message, cancel = false) {
  $('#render-status').textContent = message;
  $('[data-action="cancel"]').hidden = !cancel;
}

function showControls() {
  const expanded = [...controls.querySelectorAll('details[open] summary')].map((summary) => summary.textContent);
  const position = controls.scrollTop;
  controls.innerHTML = controlsMarkup(state);
  paintCurve(controls, state.settings);
  for (const detail of controls.querySelectorAll('details')) {
    if (expanded.includes(detail.querySelector('summary').textContent)) detail.open = true;
  }
  controls.scrollTop = position;
  $('[data-action="advanced"]').hidden = state.workspace !== 'create';
  $('[data-action="advanced"]').setAttribute('aria-pressed', state.advanced);
}

function showInspector() {
  const position = inspector.scrollTop;
  inspector.innerHTML = inspectorMarkup(state);
  paintInspector(state, inspector);
  inspector.scrollTop = position;
}

function navigate() {
  const route = location.hash.slice(1);
  const workspace = Object.hasOwn(WORKSPACES, route) ? route : 'create';
  if (route && route !== workspace) history.replaceState(null, '', '#' + workspace);
  if (workspace !== state.workspace && state.workspace === 'motion') {
    state.media.stop();
    drawOriginal();
    schedule();
  }
  if (workspace !== state.workspace) {
    if (state.sourceTool) setView('art');
    controls.scrollTop = 0;
    inspector.scrollTop = 0;
  }
  state.workspace = workspace;
  document.title = workspace === 'create' ? 'ASCII-CATALYST' : 'ASCII-CATALYST / ' + WORKSPACES[workspace];
  for (const item of $$('.workspaces a')) {
    if (item.hash === '#' + workspace) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  viewport.classList.toggle('drawing', workspace === 'compositor' && state.painting);
  showControls();
  showInspector();
  if (workspace === 'archive') refreshArchive().catch(errorMessage);
}

function showDialog(type, title, content) {
  dialogType = type;
  $('#dialog-content').innerHTML = dialogMarkup(title, content);
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
}

function openExport() {
  showDialog('export', 'Export artwork', outputControls(state, 'dialog-'));
}

function historySnapshot() {
  return {
    settings: { ...state.settings }, source: state.source, layers: structuredClone(state.layers),
    edits: { ...state.edits }, editGrid: state.editGrid, name: state.name, projectId: state.projectId,
    activePreset: state.activePreset, exportOptions: { ...state.exportOptions },
  };
}

function historyButtons() {
  $('[data-action="undo"]').disabled = !undoStack.length;
  $('[data-action="redo"]').disabled = !redoStack.length;
}

function recordHistory() {
  undoStack.push(historySnapshot());
  if (undoStack.length > 36) undoStack.shift();
  redoStack.length = 0;
  historyButtons();
}

function restoreHistory(from, to) {
  if (!from.length) return;
  to.push(historySnapshot());
  Object.assign(state, from.pop());
  state.selectedLayer = Math.min(state.selectedLayer, state.layers.length - 1);
  state.inspectIndex = null;
  sampled = null;
  state.art = null;
  historyButtons();
  showControls();
  showInspector();
  drawOriginal();
  refreshView();
  schedule();
  autosave();
}

function setSource(source, { remember = true } = {}) {
  state.media.stop();
  if (state.sourceTool) setView('art');
  if (remember) recordHistory();
  Object.assign(state, { source, art: null, inspectIndex: null, edits: {}, editGrid: '', scale: 1, panX: 0, panY: 0 });
  sampled = null;
  showControls();
  showInspector();
  drawOriginal();
  refreshView();
  schedule();
  if (remember) autosave();
}

async function importSource(file) {
  const id = ++sourceRequest;
  status('Decoding image');
  try {
    const source = await decodeImage(file);
    if (id === sourceRequest) setSource(source);
  } catch (error) {
    if (id === sourceRequest) {
      status(state.art ? 'Preview ready' : 'Waiting for image');
      throw error;
    }
  }
}

function stopWork() {
  clearTimeout(timer);
  job++;
  pending = false;
  if (worker) worker.terminate();
  worker = null;
}

function schedule(delay = 0, mediaFrame = false) {
  if (mediaFrame && pending) return;
  stopWork();
  if (!state.source) {
    status('Waiting for image');
    return;
  }
  pending = true;
  status('Preparing preview', true);
  timer = setTimeout(renderJob, delay);
}

const isMedia = () => state.workspace === 'motion' && state.media.playing;

function renderJob() {
  if (!state.source) return;
  const id = ++job;
  pending = true;
  status('Processing 0%', true);
  try {
    const s = isMedia() ? { ...state.settings, quality: 'draft' } : state.settings;
    const source = state.source.canvas;
    const metrics = fontMetrics(s);
    const { cols, rows } = gridSize(source.width, source.height, metrics.cellWidth, metrics.cellHeight, s);
    let atlas;
    try {
      atlas = glyphAtlas(s, metrics);
    } catch (error) {
      if (!['half', 'braille', 'fixed'].includes(s.mode)) throw error;
      atlas = glyphAtlas({ ...s, ramp: ' ' }, metrics);
    }
    const frame = frameKey(s);
    if (!(sampled?.source === source && sampled.cols === cols && sampled.rows === rows && sampled.frame === frame)) {
      sampled = { source, cols, rows, frame, pixels: sampleSource(source, cols, rows, s) };
    }
    const pixels = sampled.pixels.slice();
    const preview = state.view === 'adjusted';
    const finish = (art) => {
      if (id !== job) return;
      pending = false;
      state.art = art;
      state.metrics = metrics;
      state.atlas = atlas;
      if (art.processed) {
        adjusted.width = art.cols * PATCH_W;
        adjusted.height = art.rows * PATCH_H;
        adjusted.getContext('2d').putImageData(new ImageData(art.processed, adjusted.width, adjusted.height), 0, 0);
      }
      paint();
      if (isMedia()) paintInspector(state, inspector);
      else showInspector();
      status('Preview ready');
    };
    if (!workerUnavailable && typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.id !== job) return;
          if (data.error) {
            pending = false;
            status('Conversion failed');
            toast(data.error);
          } else if (data.result) {
            finish(data.result);
          } else {
            status('Processing ' + data.progress + '%', true);
          }
        };
        worker.onerror = () => {
          if (id !== job) return;
          workerUnavailable = true;
          schedule();
        };
        worker.postMessage({ id, pixels, cols, rows, atlas, settings: s, inspect: state.inspectIndex, preview }, [pixels.buffer]);
        return;
      } catch {
        workerUnavailable = true;
      }
    }
    finish(convert(sampled.pixels, cols, rows, atlas, s, { inspect: state.inspectIndex, preview }));
  } catch (error) {
    pending = false;
    status('Conversion failed');
    errorMessage(error);
  }
}

function activeEdits() {
  return state.art && state.editGrid === state.art.cols + 'x' + state.art.rows ? state.edits : {};
}

function paint() {
  if (!state.art) return refreshView();
  try {
    renderComposition(artCanvas, state.art, state.metrics, state.settings, {
      grid: state.grid, map: state.map, layers: state.layers, edits: activeEdits(),
    });
    const { cols, rows, occupied, duration, usage, mode } = state.art;
    artCanvas.setAttribute('aria-label', MODES[mode] + ' character artwork, ' + cols + ' columns and ' + rows + ' rows');
    $('#stat-grid').textContent = 'GRID ' + cols + ' × ' + rows;
    $('#stat-cells').textContent = 'CELLS ' + occupied.toLocaleString() + ' / ' + (cols * rows).toLocaleString();
    $('#stat-glyphs').textContent = 'GLYPHS ' + usage.filter(Boolean).length;
    $('#stat-mode').textContent = 'MODE ' + MODES[mode].toUpperCase();
    $('#stat-quality').textContent = (isMedia() ? 'DRAFT' : state.settings.quality.toUpperCase());
    $('#stat-time').textContent = Math.round(duration) + ' MS';
    $('#canvas-size').textContent = artCanvas.width + ' × ' + artCanvas.height + ' PX';
    refreshView();
  } catch (error) {
    errorMessage(error);
  }
}

function drawOriginal() {
  if (!state.source) return;
  const source = state.source.canvas;
  const factor = Math.min(1, 1450 / Math.max(source.width, source.height));
  original.width = Math.max(1, Math.round(source.width * factor));
  original.height = Math.max(1, Math.round(source.height * factor));
  original.getContext('2d').drawImage(source, 0, 0, original.width, original.height);
}

function drawComparison() {
  const source = state.source.canvas;
  const settings = isMedia() ? { ...state.settings, quality: 'draft' } : state.settings;
  const frame = frameKey(settings);
  if (comparedSource === source && comparedFrame === frame) return;
  const corrected = correctedSource(source, settings);
  const { width, height } = cropRect(corrected.width, corrected.height, settings);
  const rotated = settings.rotation % 180 !== 0;
  const scale = Math.min(1, 1450 / Math.max(width, height));
  comparison.width = Math.max(1, Math.round((rotated ? height : width) * scale));
  comparison.height = Math.max(1, Math.round((rotated ? width : height) * scale));
  drawFramedSource(comparison.getContext('2d'), source, settings);
  comparedSource = source;
  comparedFrame = frame;
}

function drawCropSource() {
  const source = correctedSource(state.source.canvas, state.settings);
  if (cropPreviewSource === source) return;
  cropSource.width = source.width;
  cropSource.height = source.height;
  cropSource.getContext('2d').drawImage(source, 0, 0);
  cropPreviewSource = source;
}

function showSourceTool() {
  const tool = state.sourceTool;
  const guide = $('.source-tool-guide');
  const outline = $('.crop-outline');
  viewport.classList.toggle('source-editing', Boolean(tool));
  $('[data-action="draw-crop"]')?.setAttribute('aria-pressed', tool === 'crop');
  $('[data-action="pick-key"]')?.setAttribute('aria-pressed', tool === 'key');
  $('[data-action="choose-perspective"]')?.setAttribute('aria-pressed', tool === 'perspective');
  guide.hidden = !tool;
  outline.hidden = tool !== 'crop';
  perspectiveGuide.hidden = tool !== 'perspective';
  if (!tool) return;
  const label = tool === 'crop' ? 'Drag to mark the crop' : tool === 'key' ? 'Select a colour in the original image'
    : 'Select ' + cornerNames[state.draftCorners.length] + ' (' + (state.draftCorners.length + 1) + '/4)';
  const message = guide.querySelector('span');
  if (message.textContent !== label) message.textContent = label;
  if (tool === 'perspective') paintPerspectiveGuide(perspectiveGuide, state.draftCorners, state.cornerCursor);
  if (tool === 'crop') {
    const { cropX, cropY, cropWidth, cropHeight } = state.draftCrop ?? state.settings;
    Object.assign(outline.style, { left: cropX + '%', top: cropY + '%', width: cropWidth + '%', height: cropHeight + '%' });
  }
}

function refreshView() {
  const hasArt = Boolean(state.art);
  const showAdjusted = state.view === 'adjusted' && Boolean(state.art?.processed);
  const sourceOnly = state.view === 'source' || !hasArt || (state.view === 'adjusted' && !showAdjusted);
  const split = state.view === 'split' && hasArt;
  const rectifiedCrop = Boolean(state.source && state.settings.perspective && state.sourceTool === 'crop');
  const visible = state.source && (hasArt || sourceOnly);
  board.hidden = !visible;
  $('.empty-art').hidden = Boolean(state.source);
  artCanvas.hidden = sourceOnly || showAdjusted;
  original.hidden = !sourceOnly || rectifiedCrop;
  cropSource.hidden = !rectifiedCrop;
  comparison.hidden = !split;
  adjusted.hidden = !showAdjusted;
  $('.split-line').hidden = !split;
  $('.compare-control').hidden = !split;
  board.classList.toggle('transparent', state.settings.transparent || (showAdjusted && state.settings.maskMode !== 'off'));
  const percent = Number($('#split').value);
  if (split) drawComparison();
  if (rectifiedCrop) drawCropSource();
  comparison.style.clipPath = split ? 'inset(0 ' + (100 - percent) + '% 0 0)' : '';
  $('.split-line').style.left = percent + '%';
  $('#stage-label').textContent = showAdjusted ? 'ADJUSTED / PREVIEW'
    : sourceOnly ? 'SOURCE / PREVIEW' : split ? 'SOURCE / ARTWORK' : 'ASCII / PREVIEW';
  $('[data-action="preview-adjustments"]')?.setAttribute('aria-pressed', state.view === 'adjusted');
  for (const button of $$('[data-view]')) button.setAttribute('aria-pressed', button.dataset.view === state.view);
  if (!visible) {
    showSourceTool();
    for (const key of ['grid', 'cells', 'glyphs', 'mode']) $('#stat-' + key).textContent = key.toUpperCase() + ' —';
    $('#stat-time').textContent = '—';
    $('#canvas-size').textContent = '—';
    return;
  }
  const canvas = rectifiedCrop ? cropSource : sourceOnly ? original : artCanvas;
  const fit = Math.min((viewport.clientWidth - 36) / canvas.width, (viewport.clientHeight - 54) / canvas.height);
  const ratio = Math.max(.025, fit * state.scale);
  board.style.width = canvas.width * ratio + 'px';
  board.style.height = canvas.height * ratio + 'px';
  board.style.transform = 'translate(calc(-50% + ' + state.panX + 'px), calc(-50% + ' + state.panY + 'px))';
  $('#zoom').textContent = state.scale === 1 && !state.panX && !state.panY ? 'Fit' : Math.round(ratio * 100) + '%';
  showSourceTool();
}

function autosave() {
  if (!initialized || isMedia()) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      const project = await snapshotProject(historySnapshot());
      await storage('put', project, 'recovery');
      hasRecovery = true;
    } catch {
      status('Local autosave unavailable');
    }
  }, 480);
}

async function refreshArchive() {
  const projects = await storage('getAll');
  state.archive = projects.filter((p) => p.id).sort((a, b) => b.modified - a.modified);
  if (state.workspace === 'archive') showInspector();
}

async function saveNamed() {
  if (!state.name.trim()) throw new Error('Enter a project name.');
  const project = await snapshotProject(historySnapshot());
  const id = state.projectId || crypto.randomUUID();
  await storage('put', { ...project, id, modified: Date.now() }, id);
  state.projectId = id;
  await refreshArchive();
  dialog.close();
  toast('Project saved locally.');
}

async function loadProject(raw, projectId = null) {
  const project = validateProject(raw);
  const source = await projectSource(project.source);
  state.media.stop();
  if (state.sourceTool) setView('art');
  recordHistory();
  Object.assign(state, project, { source, art: null, activePreset: -1, projectId, inspectIndex: null, selectedLayer: -1, scale: 1, panX: 0, panY: 0 });
  sampled = null;
  dialog.close();
  showControls();
  showInspector();
  drawOriginal();
  refreshView();
  schedule();
  autosave();
}

async function exportCurrent(format = state.exportOptions.format) {
  const base = state.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'ascii-catalyst';
  if (format === 'project') {
    const snapshot = await snapshotProject(historySnapshot(), state.exportOptions.embedSource);
    download(new Blob([await serializeProject(snapshot)], { type: 'application/json' }), base + '.acatalyst');
    return;
  }
  if (!state.art || pending) throw new Error('Wait for the artwork preview before exporting.');
  const opt = { ...state.exportOptions, format, scale: state.settings.scale, layers: state.layers, edits: activeEdits() };
  const ext = { ascii: 'txt', jpeg: 'jpg' }[format] || format;
  download(await exportArtwork(state.art, state.metrics, state.settings, opt), base + '.' + ext);
  toast('Export prepared.');
}

async function copyText() {
  if (!state.art || pending) throw new Error('Wait for the artwork preview before copying.');
  if (state.layers.some((layer) => layer.visible)) throw new Error('Hide the typography layers to copy the character grid.');
  const text = artworkText(state.art, { edits: activeEdits(), trim: state.exportOptions.trim });
  await navigator.clipboard.writeText(text);
  toast('Character grid copied.');
}

function changeSettings(patch, { history = true, rebuild = true, delay = 0 } = {}) {
  if (history) recordHistory();
  state.activePreset = -1;
  state.settings = normalizeSettings({ ...state.settings, ...patch });
  if (rebuild) showControls();
  if (CURVE_KEYS.some((key) => key in patch)) paintCurve(controls, state.settings);
  if (CROP_KEYS.some((key) => key in patch)) {
    for (const key of CROP_KEYS) {
      for (const input of controls.querySelectorAll('[data-setting="' + key + '"]')) {
        if (input !== document.activeElement || input.type !== 'number') input.value = state.settings[key];
      }
    }
    showSourceTool();
  }
  if (Object.keys(patch).every((key) => ['foreground', 'background', 'transparent', 'scale'].includes(key))) {
    paint();
  } else {
    state.inspectIndex = null;
    schedule(delay);
  }
  autosave();
}

function choosePreset(index) {
  const [name, , config] = PRESETS[index];
  applyPreset(index, {
    ...DEFAULTS, font: state.settings.font, weight: state.settings.weight,
    ...config, ramp: RAMPS[config.library] || DEFAULTS.ramp,
  });
  toast(name + ' applied.');
}

function applyPreset(id, config) {
  recordHistory();
  const framing = ['columns', 'rows', 'lockAspect', 'quality', 'scale', ...frameKeys, ...MASK_KEYS];
  state.settings = normalizeSettings({ ...config, ...Object.fromEntries(framing.map((key) => [key, state.settings[key]])) });
  state.activePreset = id;
  state.inspectIndex = null;
  showControls();
  showInspector();
  schedule();
  autosave();
}

async function refreshPresets() {
  state.presets = (await presetStorage('getAll')).sort((a, b) => a.name.localeCompare(b.name));
  if (state.workspace === 'create') showInspector();
}

async function savePreset() {
  const name = $('#preset-name').value.trim();
  if (!name) throw new Error('Enter a preset name.');
  if (state.presets.length >= 40) throw new Error('Remove a saved preset before adding another.');
  const id = crypto.randomUUID();
  await presetStorage('put', { id, name, settings: { ...state.settings } }, id);
  state.activePreset = id;
  state.presetGroup = 'Saved';
  dialog.close();
  await refreshPresets();
  toast('Preset saved locally.');
}

async function removePreset() {
  const preset = state.presets.find(({ id }) => id === state.activePreset);
  if (!preset || !confirm('Remove saved preset "' + preset.name + '"?')) return;
  await presetStorage('delete', preset.id);
  state.activePreset = -1;
  await refreshPresets();
}

function setView(view) {
  state.sourceTool = null;
  state.draftCrop = null;
  state.draftCorners = [];
  state.view = view;
  fit();
  if (view === 'adjusted' && !state.art?.processed) schedule();
}

function beginSourceTool(tool) {
  if (!state.source) throw new Error('Import a source image first.');
  if (state.sourceTool === tool) return setView(state.toolView);
  if (!state.sourceTool) state.toolView = state.view;
  state.sourceTool = tool;
  state.draftCrop = null;
  state.draftCorners = [];
  state.cornerCursor = cornerStarts[0];
  state.view = 'source';
  fit();
  viewport.focus({ preventScroll: true });
}

function placeCorner(position) {
  const points = [...state.draftCorners, position];
  if (points.length < 4) {
    state.draftCorners = points;
    state.cornerCursor = cornerStarts[points.length];
    showSourceTool();
    return;
  }
  const corners = points.flatMap(({ x, y }) => [x, y]);
  if (!validPerspective(corners)) {
    state.draftCorners = [];
    state.cornerCursor = cornerStarts[0];
    showSourceTool();
    toast('Choose four corners of a convex shape in clockwise order.');
    return;
  }
  setView(state.toolView);
  changeSettings({ perspective: corners });
}

const cornerSteps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function moveCorner(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) placeCorner(state.cornerCursor);
    return;
  }
  const direction = cornerSteps[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? .05 : .01;
  state.cornerCursor = {
    x: clamp(state.cornerCursor.x + direction[0] * step),
    y: clamp(state.cornerCursor.y + direction[1] * step),
  };
  showSourceTool();
}

function sourcePosition(event, limitToImage = false) {
  const box = board.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  if (limitToImage && (x < 0 || y < 0 || x >= 1 || y >= 1)) return null;
  return { x: clamp(x), y: clamp(y) };
}

function cropFromPoints(a, b) {
  const cropX = Math.min(99, Math.round(Math.min(a.x, b.x) * 100));
  const cropY = Math.min(99, Math.round(Math.min(a.y, b.y) * 100));
  return {
    cropX, cropY,
    cropWidth: Math.max(1, Math.round(Math.max(a.x, b.x) * 100) - cropX),
    cropHeight: Math.max(1, Math.round(Math.max(a.y, b.y) * 100) - cropY),
  };
}

function pickSourceColour(position) {
  const source = state.source.canvas;
  const x = Math.min(source.width - 1, Math.floor(position.x * source.width));
  const y = Math.min(source.height - 1, Math.floor(position.y * source.height));
  const [r, g, b, alpha] = source.getContext('2d').getImageData(x, y, 1, 1).data;
  if (!alpha) return toast('Choose a visible pixel in the image.');
  setView(state.toolView);
  changeSettings({ maskColor: rgbHex(r, g, b) });
}

function changeLayer(action) {
  const selected = state.selectedLayer;
  const layers = state.layers;
  if (action === 'add-layer' || action === 'layer-duplicate') {
    if (layers.length >= 24) throw new Error('This project already has 24 typography layers.');
    recordHistory();
    layers.push(normalizeLayers([action === 'add-layer' ? {} : { ...layers[selected], name: layers[selected].name + ' copy' }])[0]);
    state.selectedLayer = layers.length - 1;
  } else if (action === 'layer-delete') {
    recordHistory();
    layers.splice(selected, 1);
    state.selectedLayer = Math.min(selected, layers.length - 1);
  } else {
    const target = action === 'layer-up' ? selected + 1 : selected - 1;
    if (target < 0 || target >= layers.length) return;
    recordHistory();
    [layers[selected], layers[target]] = [layers[target], layers[selected]];
    state.selectedLayer = target;
  }
  showControls();
  showInspector();
  paint();
  autosave();
}

function fit() {
  Object.assign(state, { scale: 1, panX: 0, panY: 0 });
  refreshView();
}

function zoom(factor) {
  state.scale = Math.min(12, Math.max(.25, state.scale * factor));
  refreshView();
}

function newProject() {
  ++sourceRequest;
  recordHistory();
  Object.assign(state, {
    name: 'Untitled', projectId: null, settings: { ...DEFAULTS }, layers: [], selectedLayer: -1, activePreset: -1,
  });
  setSource(null, { remember: false });
  autosave();
  dialog.close();
}

const actionHandlers = {
  upload: () => $('#image-file').click(),
  open: () => $('#project-file').click(),
  new: () => showDialog('new', 'New project',
    '<p>Start with an empty workspace. The current project stays in the undo history.</p>' + button('Create project', 'new-confirm', ' class="primary"')
    + (hasRecovery ? button('Recover autosave', 'recover') : '')),
  'new-confirm': newProject,
  recover: async () => {
    const recovery = await storage('get', 'recovery');
    if (!recovery) throw new Error('No local autosave was found.');
    await loadProject(recovery);
  },
  save: () => showDialog('save', 'Save project', projectNameMarkup(state)),
  'save-local': saveNamed,
  'project-download': () => exportCurrent('project'),
  undo: () => restoreHistory(undoStack, redoStack),
  redo: () => restoreHistory(redoStack, undoStack),
  export: openExport,
  download: () => exportCurrent(),
  copy: copyText,
  'close-dialog': () => dialog.close(),
  samples: () => showDialog('samples', 'Choose a sample', samplesMarkup()),
  sample: (node) => {
    ++sourceRequest;
    setSource(sampleImage(SAMPLES[Number(node.dataset.sample)]));
    dialog.close();
  },
  settings: () => showDialog('settings', 'Settings', quality(state.settings)
    + '<p>For viewport navigation use +, − and 0. Press F to toggle presentation and Esc to leave it.</p>'
    + (/^https:\/\//i.test(repositoryUrl) ? '<p><a href="' + escapeMarkup(repositoryUrl)
      + '" target="_blank" rel="noopener noreferrer">Source repository</a></p>' : '')
    + button('Reset conversion settings', 'reset')),
  advanced: () => {
    state.advanced = !state.advanced;
    showControls();
    $('[data-action="advanced"]').focus();
  },
  reset: () => {
    state.activePreset = -1;
    changeSettings(DEFAULTS);
    dialog.close();
  },
  'reset-tone': () => changeSettings(Object.fromEntries(TONE_KEYS.map((key) => [key, DEFAULTS[key]]))),
  'reset-texture': () => changeSettings(Object.fromEntries(TEXTURE_KEYS.map((key) => [key, DEFAULTS[key]]))),
  'reset-curve': () => changeSettings(Object.fromEntries(CURVE_KEYS.map((key) => [key, DEFAULTS[key]]))),
  'reset-crop': () => changeSettings(Object.fromEntries(CROP_KEYS.map((key) => [key, DEFAULTS[key]]))),
  'reset-mask': () => {
    if (state.sourceTool === 'key') setView(state.toolView);
    changeSettings(Object.fromEntries(MASK_KEYS.map((key) => [key, DEFAULTS[key]])));
  },
  'draw-crop': () => beginSourceTool('crop'),
  'choose-perspective': () => beginSourceTool('perspective'),
  'reset-perspective': () => {
    if (state.sourceTool === 'perspective') setView(state.toolView);
    changeSettings({ perspective: null });
  },
  'pick-key': () => beginSourceTool('key'),
  'cancel-source-tool': () => setView(state.toolView),
  'preview-adjustments': () => setView(state.view === 'adjusted' ? 'art' : 'adjusted'),
  cancel: () => {
    stopWork();
    if (isMedia()) state.media.pause();
    status('Processing cancelled');
  },
  fit,
  'zoom-out': () => zoom(1 / 1.22),
  'zoom-in': () => zoom(1.22),
  grid: (node) => {
    state.grid = !state.grid;
    node.setAttribute('aria-pressed', state.grid);
    paint();
  },
  present: () => {
    app.classList.toggle('presentation');
    fit();
  },
  'hide-inspector': (node) => {
    const hidden = $('.workspace').classList.toggle('inspector-collapsed');
    node.setAttribute('aria-expanded', !hidden);
    node.setAttribute('aria-label', hidden ? 'Expand inspector' : 'Collapse inspector');
    node.textContent = hidden ? '+' : '−';
    refreshView();
  },
  preset: (node) => choosePreset(Number(node.dataset.preset)),
  'vary-style': () => changeSettings(varySettings(state.settings)),
  'save-preset': () => showDialog('preset', 'Save preset', presetNameMarkup()),
  'save-preset-local': savePreset,
  'saved-preset': (node) => {
    const preset = state.presets.find(({ id }) => id === node.dataset.presetId);
    if (preset) applyPreset(preset.id, preset.settings);
  },
  'remove-preset': removePreset,
  glyph: (node) => {
    state.selectedGlyph = state.atlas?.entries[Number(node.dataset.glyph)]?.glyph || '';
    showInspector();
    inspector.querySelector('[aria-pressed="true"]')?.focus();
  },
  'sort-density': () => {
    const atlas = glyphAtlas(state.settings);
    const ramp = atlas.entries.slice().sort((a, b) => a.density - b.density).map(({ glyph }) => glyph).join('');
    changeSettings({ ramp, library: 'Custom' });
  },
  'sort-code': () => changeSettings({
    ramp: cleanGlyphs(state.settings.ramp).sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join(''), library: 'Custom',
  }),
  'export-ramp': () => download(new Blob([state.settings.ramp], { type: 'text/plain;charset=utf-8' }), 'character-ramp.txt'),
  'apply-text': () => changeSettings({ mode: 'fixed' }),
  'index-braille': () => changeSettings({ mode: 'braille' }),
  'index-tonal': () => changeSettings({ mode: 'tonal' }),
  'index-structure': () => changeSettings({ mode: 'structure' }),
  'index-dither': () => changeSettings({ dither: 'floyd' }),
  'index-characters': () => { location.hash = 'characters'; },
  'index-output': () => { location.hash = 'output'; },
  'select-layer': (node) => {
    state.selectedLayer = Number(node.dataset.layerIndex);
    showControls();
    showInspector();
  },
  'clear-edits': () => {
    if (!Object.keys(state.edits).length) return;
    recordHistory();
    state.edits = {};
    state.editGrid = '';
    showInspector();
    paint();
    autosave();
  },
  'archive-open': async (node) => {
    const id = node.dataset.projectId;
    const project = await storage('get', id);
    await loadProject(project, id);
  },
  'archive-copy': async (node) => {
    const project = await storage('get', node.dataset.projectId);
    if (!project) throw new Error('That project is unavailable.');
    const id = crypto.randomUUID();
    await storage('put', { ...project, id, name: project.name.slice(0, 90) + ' copy', modified: Date.now() }, id);
    await refreshArchive();
  },
  'archive-delete': async (node) => {
    if (!confirm('Delete this saved project from local storage?')) return;
    const id = node.dataset.projectId;
    await storage('delete', id);
    if (state.projectId === id) state.projectId = null;
    await refreshArchive();
  },
  'archive-clear': async () => {
    if (!confirm('Delete all saved projects and the recovery copy from local storage?')) return;
    clearTimeout(autosaveTimer);
    await storage('clear');
    state.projectId = null;
    hasRecovery = false;
    await refreshArchive();
  },
  'open-video': () => $('#video-file').click(),
  animate: () => state.media.animate(),
  'play-media': () => {
    state.media.play();
    if (!state.media.playing) schedule();
  },
  freeze: () => {
    state.media.pause();
    schedule();
    toast('Frame frozen.');
  },
  'media-snapshot': () => exportCurrent('png'),
  'record-media': () => state.media.record(artCanvas),
  'frame-back': () => state.media.seek(state.media.time - 1 / state.media.fps),
  'frame-next': () => state.media.seek(state.media.time + 1 / state.media.fps),
};
for (const action of ['add-layer', 'layer-up', 'layer-down', 'layer-duplicate', 'layer-delete']) {
  actionHandlers[action] = () => changeLayer(action);
}

app.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.view) {
    setView(node.dataset.view);
    return;
  }
  const handler = actionHandlers[node.dataset.action];
  if (!handler) return;
  try {
    await handler(node);
  } catch (error) {
    errorMessage(error);
  }
});

const inputValue = (node) => node.type === 'checkbox' ? node.checked
  : node.type === 'number' || node.type === 'range' ? node.valueAsNumber : node.value;
let streamingControl;

app.addEventListener('input', (event) => {
  const node = event.target;
  if (node.dataset.project) {
    state.name = node.value.slice(0, 100);
    autosave();
    return;
  }
  if (node.id === 'split') {
    refreshView();
    return;
  }
  const key = node.dataset.setting;
  const pair = node.closest('.range');
  if (!key || (!pair && !['range', 'color'].includes(node.type))) return;
  const value = inputValue(node);
  if (node.type === 'number' && !Number.isFinite(value)) return;
  if (streamingControl !== node) {
    streamingControl = node;
    recordHistory();
  }
  changeSettings({ [key]: value }, { history: false, rebuild: false, delay: 105 });
  if (pair) {
    const sibling = pair.querySelector(node.type === 'range' ? 'input[type="number"]' : 'input[type="range"]');
    sibling.value = state.settings[key];
  }
});

app.addEventListener('focusout', ({ target: node }) => {
  if (streamingControl !== node) return;
  streamingControl = null;
  if (node.type === 'number') node.value = state.settings[node.dataset.setting];
});

app.addEventListener('change', async (event) => {
  const node = event.target;
  const value = inputValue(node);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    showControls();
    if (dialog.open && dialogType === 'export') openExport();
    return;
  }
  try {
    if (node.dataset.setting) {
      const key = node.dataset.setting;
      if (key === 'maskMode' && state.sourceTool === 'key') setView(state.toolView);
      const isStreaming = streamingControl === node;
      streamingControl = null;
      const patch = key === 'library' && RAMPS[value] ? { library: value, ramp: RAMPS[value] }
        : key === 'ramp' ? { ramp: value, library: 'Custom' }
          : { [key]: ['weight', 'rotation'].includes(key) ? Number(value) : value };
      const rebuild = ['library', 'mode', 'lockAspect', 'hardThreshold', 'color', 'maskMode'].includes(key);
      changeSettings(patch, { history: !isStreaming, rebuild });
      if (key === 'ramp') controls.querySelector('[data-setting="library"]').value = 'Custom';
      const paired = node.closest('.range');
      if (paired && !rebuild) for (const item of paired.querySelectorAll('input')) item.value = state.settings[key];
      if (['foreground', 'background', 'transparent', 'scale'].includes(key)) showInspector();
    } else if (node.dataset.presetGroup) {
      state.presetGroup = node.value;
      showInspector();
      $('#preset-group')?.focus();
    } else if (node.dataset.viewSetting) {
      state[node.dataset.viewSetting] = value;
      viewport.classList.toggle('drawing', state.workspace === 'compositor' && state.painting);
      paint();
    } else if (node.dataset.layer) {
      recordHistory();
      const index = state.selectedLayer;
      state.layers[index] = normalizeLayers([{ ...state.layers[index], [node.dataset.layer]: value }])[0];
      paint();
      showInspector();
      autosave();
    } else if (node.dataset.export) {
      const key = node.dataset.export.replace(/^dialog-/, '');
      if (key === 'scale') state.settings.scale = Math.max(1, Math.min(8, Math.round(value)));
      else state.exportOptions[key] = key === 'margin' ? Math.max(0, Math.min(500, Math.round(value))) : value;
      if (['format', 'trim'].includes(key)) {
        if (dialog.open) {
          openExport();
          dialog.querySelector('[data-export="' + node.dataset.export + '"]')?.focus();
        }
        if (state.workspace === 'output') showControls();
      }
      autosave();
    } else if (node.dataset.media) {
      const key = node.dataset.media;
      if (key === 'seek') await state.media.seek(value);
      if (key === 'fps') state.media.fps = Math.max(1, Math.min(30, Math.round(value)));
    }
  } catch (error) {
    errorMessage(error);
  }
});

function handleFile(input, handler) {
  input.addEventListener('change', () => {
    const [file] = input.files;
    input.value = '';
    if (file) Promise.resolve(handler(file)).catch(errorMessage);
  });
}
handleFile($('#image-file'), importSource);
handleFile($('#project-file'), async (file) => {
  if (file.size > 58 * 1024 * 1024) throw new Error('Choose a project smaller than 58 MB.');
  ++sourceRequest;
  await loadProject(JSON.parse(await file.text()));
});
handleFile($('#video-file'), (file) => state.media.openVideo(file));

app.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  app.classList.add('drop-target');
});
app.addEventListener('dragleave', (event) => {
  if (!app.contains(event.relatedTarget)) app.classList.remove('drop-target');
});
app.addEventListener('drop', (event) => {
  event.preventDefault();
  app.classList.remove('drop-target');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (file.name.endsWith('.acatalyst')) {
    ++sourceRequest;
    if (file.size > 58 * 1024 * 1024) return toast('Choose a project smaller than 58 MB.');
    file.text().then((json) => loadProject(JSON.parse(json))).catch(errorMessage);
  } else {
    importSource(file).catch(errorMessage);
  }
});
document.addEventListener('paste', (event) => {
  if (event.target.matches('input, textarea, [contenteditable]') || dialog.open) return;
  const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  importSource(file).catch(errorMessage);
});

function hit(event) {
  if (!state.art || ['source', 'adjusted'].includes(state.view)) return null;
  const rect = board.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * state.art.cols);
  const y = Math.floor((event.clientY - rect.top) / rect.height * state.art.rows);
  if (x < 0 || y < 0 || x >= state.art.cols || y >= state.art.rows) return null;
  return { x, y, index: y * state.art.cols + x };
}

function drawCell(cell) {
  if (!cell) return;
  const glyph = state.erasing ? ' ' : cleanGlyphs(state.brush)[0];
  if (!glyph) return;
  if (!gesture.changed) {
    const grid = state.art.cols + 'x' + state.art.rows;
    if (state.editGrid !== grid && Object.keys(state.edits).length) {
      if (!gesture.warned) toast('Painted cells belong to another grid. Restore its resolution or clear the edits.');
      gesture.warned = true;
      return;
    }
    recordHistory();
    state.editGrid = grid;
    gesture.changed = true;
  }
  if (state.edits[cell.index] === glyph) return;
  state.edits[cell.index] = glyph;
  paint();
}

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input, label')) return;
  if (state.sourceTool) {
    const start = sourcePosition(event, true);
    if (start) {
      gesture = { sourceTool: state.sourceTool, start, x: event.clientX, y: event.clientY };
      viewport.setPointerCapture(event.pointerId);
    }
    return;
  }
  gesture = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false,
    paint: state.workspace === 'compositor' && state.painting };
  viewport.setPointerCapture(event.pointerId);
  if (gesture.paint) drawCell(hit(event));
});
viewport.addEventListener('pointermove', (event) => {
  if (state.sourceTool === 'perspective') {
    state.cornerCursor = sourcePosition(event);
    showSourceTool();
    return;
  }
  const cell = hit(event);
  if (cell) $('#stage-coordinates').textContent = 'X ' + String(cell.x + 1).padStart(4, '0')
    + ' / Y ' + String(cell.y + 1).padStart(4, '0');
  if (!gesture) return;
  if (gesture.sourceTool) {
    if (state.sourceTool === 'crop' && gesture.sourceTool === 'crop') {
      state.draftCrop = cropFromPoints(gesture.start, sourcePosition(event));
      showSourceTool();
    }
    return;
  }
  if (gesture.paint) return drawCell(cell);
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (gesture.moved || Math.hypot(dx, dy) > 4) {
    gesture.moved = true;
    viewport.classList.add('dragging');
    state.panX = gesture.panX + dx;
    state.panY = gesture.panY + dy;
    refreshView();
  }
});
function endGesture(event) {
  if (!gesture) return;
  if (gesture.sourceTool) {
    const completed = event.type === 'pointerup' && state.sourceTool === gesture.sourceTool;
    try {
      if (completed && state.sourceTool === 'crop' && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) {
        const patch = cropFromPoints(gesture.start, sourcePosition(event));
        setView(state.toolView);
        changeSettings(patch);
      } else if (completed && state.sourceTool === 'key') {
        const position = sourcePosition(event, true);
        if (position) pickSourceColour(position);
      } else if (completed && state.sourceTool === 'perspective') {
        const position = sourcePosition(event, true);
        if (position) placeCorner(position);
      }
    } catch (error) {
      errorMessage(error);
    }
    state.draftCrop = null;
    gesture = null;
    showSourceTool();
    return;
  }
  const cell = hit(event);
  if (gesture.paint) {
    if (gesture.changed) {
      showInspector();
      autosave();
    }
  } else if (!gesture.moved && cell && event.type === 'pointerup' && ['create', 'index'].includes(state.workspace)) {
    state.inspectIndex = cell.index;
    showInspector();
    schedule();
    inspector.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  gesture = null;
  viewport.classList.remove('dragging');
}
viewport.addEventListener('pointerup', endGesture);
viewport.addEventListener('pointercancel', endGesture);
viewport.addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.sourceTool && !dialog.open) {
    setView(state.toolView);
    return;
  }
  if (event.target.matches('input, textarea, select, [contenteditable]') || dialog.open) return;
  if (event.target === viewport && state.sourceTool === 'perspective' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    moveCorner(event);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) actionHandlers.redo();
    else actionHandlers.undo();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    actionHandlers.save();
  }
  if (event.key === 'Escape' && app.classList.contains('presentation')) actionHandlers.present();
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'f') actionHandlers.present();
  if (event.target !== viewport) return;
  if (event.key === '+' || event.key === '=') zoom(1.22);
  if (event.key === '-') zoom(1 / 1.22);
  if (event.key === '0') fit();
  const offsets = { ArrowUp: [0, 20], ArrowDown: [0, -20], ArrowLeft: [20, 0], ArrowRight: [-20, 0] };
  if (offsets[event.key]) {
    event.preventDefault();
    state.panX += offsets[event.key][0];
    state.panY += offsets[event.key][1];
    refreshView();
  }
});

state.media = new MediaSession((source, time) => {
  if (pending && isMedia()) return;
  state.source = source;
  const seek = $('#seek');
  if (seek && document.activeElement !== seek) seek.value = time.toFixed(2);
  if (state.view !== 'art' || !state.art) drawOriginal();
  schedule(0, true);
}, () => {
  if (state.workspace === 'motion') {
    showControls();
    showInspector();
  }
}, errorMessage);

addEventListener('hashchange', navigate);
addEventListener('pagehide', () => state.media.stop());
new ResizeObserver(refreshView).observe(viewport);
navigate();

async function initialize() {
  await Promise.allSettled([
    document.fonts.load('400 16px "IBM Plex Mono Catalyst"'),
    document.fonts.load('700 16px "IBM Plex Mono Catalyst"'),
  ]);
  if (!state.source && !undoStack.length && !sourceRequest) setSource(sampleImage(), { remember: false });
  refreshPresets().catch(() => {});
  const recovery = await storage('get', 'recovery');
  hasRecovery = Boolean(recovery);
  if (recovery && !undoStack.length && !sourceRequest) {
    const project = validateProject(recovery);
    const source = await projectSource(project.source);
    if (!undoStack.length && !sourceRequest) {
      Object.assign(state, project, { source, art: null });
      sampled = null;
      showControls();
      showInspector();
      drawOriginal();
      refreshView();
      schedule();
    }
  }
}
initialize().catch(() => {}).finally(() => { initialized = true; });

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register(new URL('../offline.js', import.meta.url)).catch(() => {});
}
