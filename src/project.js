import { normalizeSettings, cleanGlyphs } from './engine/settings.js';
import { clamp } from './engine/math.js';
import { decodeImage, sampleImage, SAMPLES } from './engine/image.js';

const storageName = 'ascii-catalyst';
const storeName = 'projects';
const blends = new Set(['source-over', 'screen', 'multiply', 'difference']);

export function normalizeLayers(layers = []) {
  if (!Array.isArray(layers)) return [];
  return layers.slice(0, 24).map((layer) => {
    const item = layer && typeof layer === 'object' ? layer : {};
    const number = (key, fallback, min, max) => typeof item[key] === 'number' && Number.isFinite(item[key])
      ? clamp(item[key], min, max) : fallback;
    return {
      name: typeof item.name === 'string' ? item.name.slice(0, 80) : 'Text layer',
      text: typeof item.text === 'string' ? item.text.slice(0, 1000) : 'ASCII–CATALYST',
      visible: item.visible !== false, opacity: number('opacity', 100, 0, 100),
      x: number('x', 0, -9000, 9000), y: number('y', 0, -9000, 9000),
      rotation: number('rotation', 0, -180, 180), size: number('size', 60, 8, 500),
      color: /^#[\da-f]{6}$/i.test(item.color) ? item.color : '#eeeeee',
      blend: blends.has(item.blend) ? item.blend : 'source-over',
    };
  });
}

export function normalizeEdits(input) {
  if (!input || typeof input !== 'object') return {};
  const entries = Object.entries(input).slice(0, 115200);
  return Object.fromEntries(entries.filter(([key, value]) => /^\d{1,6}$/.test(key)
    && Number(key) < 115200 && typeof value === 'string' && cleanGlyphs(value).length === 1
    && [...value].length === 1));
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob)
    : reject(new Error('Could not encode the source image.')), 'image/png'));
}

export async function snapshotProject({ source, name, settings, layers, edits, editGrid, exportOptions }, embedSource = true) {
  return {
    format: 'ASCII-CATALYST', version: 1, name, settings, layers, edits, editGrid, exportOptions,
    source: source?.sample ? { sample: source.sample } : source && embedSource ? {
      name: source.name, blob: source.blob || await canvasBlob(source.canvas),
    } : null,
  };
}

export function validateProject(project) {
  if (!project || project.format !== 'ASCII-CATALYST' || project.version !== 1) {
    throw new Error('Choose a version 1 ASCII-Catalyst project.');
  }
  return {
    name: typeof project.name === 'string' ? project.name.slice(0, 100) : 'Untitled',
    settings: normalizeSettings(project.settings && typeof project.settings === 'object' ? project.settings : {}),
    layers: normalizeLayers(project.layers),
    edits: normalizeEdits(project.edits),
    editGrid: /^\d{1,3}x\d{1,6}$/.test(project.editGrid) ? project.editGrid : '',
    exportOptions: {
      format: ['png', 'txt', 'ascii', 'ansi', 'nfo', 'md', 'svg', 'html', 'json', 'jpeg', 'webp', 'pdf', 'project']
        .includes(project.exportOptions?.format) ? project.exportOptions.format : 'png',
      margin: Number.isFinite(project.exportOptions?.margin) ? clamp(Math.round(project.exportOptions.margin), 0, 500) : 0,
      trim: project.exportOptions?.trim === true,
      embedSource: project.exportOptions?.embedSource !== false,
    },
    source: project.source ?? null,
  };
}

export async function projectSource(source) {
  if (SAMPLES.includes(source?.sample)) return sampleImage(source.sample);
  if (source?.blob instanceof Blob) {
    return decodeImage(new File([source.blob], typeof source.name === 'string' ? source.name : 'source.png', { type: source.blob.type }));
  }
  if (typeof source?.data === 'string' && /^data:image\/[\w.+-]+;base64,[a-z\d+/=]+$/i.test(source.data)) {
    const blob = await (await fetch(source.data)).blob();
    return decodeImage(new File([blob], typeof source.name === 'string' ? source.name : 'source.png', { type: blob.type }));
  }
  return null;
}

export async function serializeProject(project) {
  let source = project.source;
  if (source?.blob) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([source.blob], { type: source.blob.type || 'image/png' }));
    });
    source = { name: source.name, data };
  }
  return JSON.stringify({ ...project, source }, null, 2);
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storage(method, ...args) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, ['get', 'getAll'].includes(method) ? 'readonly' : 'readwrite');
      const request = tx.objectStore(storeName)[method](...args);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
    });
  } finally {
    db.close();
  }
}
