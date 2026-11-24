import { convert } from './engine/convert.js';

self.onmessage = ({ data }) => {
  const { id, pixels, cols, rows, atlas, settings, inspect, preview } = data;
  try {
    const result = convert(pixels, cols, rows, atlas, settings, {
      inspect, preview,
      onProgress: (value) => self.postMessage({ id, progress: value }),
    });
    const transfers = ['cells', 'foreground', 'background', 'opacity', 'influence', 'histogram', 'usage', 'processed']
      .flatMap((key) => result[key] ? [result[key].buffer] : []);
    self.postMessage({ id, result }, transfers);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
