const ASSETS = './src/';
const assetURL = new URL(ASSETS, self.registration.scope).href;
const cachePrefix = 'ascii-catalyst:' + self.registration.scope + ':';
const CACHE = cachePrefix + ASSETS;
const files = ['styles.css', 'app.js', 'ui.js', 'media.js', 'project.js', 'worker.js',
  'engine/adjust.js', 'engine/convert.js', 'engine/dithering.js', 'engine/filters.js', 'engine/glyphs.js',
  'engine/paint-mask.js', 'engine/palette.js', 'engine/perspective.js', 'engine/image.js', 'engine/math.js',
  'engine/render.js', 'engine/settings.js', 'engine/export.js', 'fonts/inter-latin-wght-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-700-normal.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html', ...files.map((path) => ASSETS + path)]
    .map((path) => new Request(path, { cache: 'reload' })))));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(cachePrefix) && key !== CACHE).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  if (url.href.startsWith(assetURL)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(event.request)) || fetch(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    const match = await cache.match(event.request, { ignoreSearch: true });
    return match || (event.request.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
  }));
});
