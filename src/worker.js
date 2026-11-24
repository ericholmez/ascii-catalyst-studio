import { convert } from './engine/convert.js';
import { extractImagePalette } from './engine/adjust.js';
import { PATCH_W, PATCH_H } from './engine/glyphs.js';

self.onmessage = ({ data }) => {
  const { id, pixels, cols, rows, atlas, settings, inspect, preview, paintedMask } = data;
  try {
    if (data.type === 'extract-palette') {
      self.postMessage({ palette: extractImagePalette(pixels, cols * PATCH_W, rows * PATCH_H, settings, paintedMask, data.count) });
      return;
    }
    const result = convert(pixels, cols, rows, atlas, settings, {
      inspect, preview, paintedMask,
      onProgress: (value) => self.postMessage({ id, progress: value }),
    });
    const transfers = ['cells', 'foreground', 'background', 'opacity', 'influence', 'histogram', 'usage', 'processed']
      .flatMap((key) => result[key] ? [result[key].buffer] : []);
    self.postMessage({ id, result }, transfers);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
