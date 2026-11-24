const CACHE = 'ascii-catalyst-v1';
const files = ['./', './index.html', './src/styles.css', './src/app.js', './src/ui.js', './src/media.js',
  './src/project.js', './src/worker.js', './src/engine/convert.js', './src/engine/glyphs.js',
  './src/engine/image.js', './src/engine/math.js', './src/engine/render.js', './src/engine/settings.js', './src/engine/export.js',
  './src/fonts/inter-latin-wght-normal.woff2', './src/fonts/ibm-plex-mono-latin-400-normal.woff2',
  './src/fonts/ibm-plex-mono-latin-700-normal.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(files)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('ascii-catalyst-') && key !== CACHE).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    const match = await cache.match(event.request, { ignoreSearch: true });
    return match || (event.request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
  }));
});
