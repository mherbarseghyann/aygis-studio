// AYGIS Packaging Studio - service worker (static hosting / GitHub Pages).
// GitHub Pages serves every file with `Cache-Control: max-age=600` and offers no way to set long-lived headers,
// so repeat visits would re-validate ~40 files. This worker:
//   * precaches the application shell once (code, three.js, the BOX-10 model + artwork needed for the first view),
//   * serves code (html / js / css / json) NETWORK-FIRST, so a new deploy is picked up on the next load and all
//     modules always come from the same version, falling back to the cache when offline,
//   * serves heavy static assets (vendor libraries, models, artwork, fonts, sample PDFs) CACHE-FIRST.
// Bump VERSION on every deploy: the old cache is deleted when the new worker activates.
const VERSION = 'aygis-r1.1-2026-10-08b';
const SHELL = [
  './', './index.html', './css/app.css', './vendor/fonts/fonts.css',
  './js/app.js', './js/viewer.js', './js/environments.js', './js/lookdev.js', './js/props.js', './js/sky.js', './js/texbake.js', './js/units.js',
  './js/artwork.js', './js/boxmodel.js', './js/panelgeom.js', './js/confections.js', './js/timeline.js', './js/recorder.js', './js/access.js',
  './vendor/three/three.module.min.js', './vendor/three/three.core.min.js', './vendor/three/OrbitControls.js', './vendor/three/GLTFLoader.js', './vendor/three/BufferGeometryUtils.js',
  './vendor/three/postprocessing/EffectComposer.js', './vendor/three/postprocessing/RenderPass.js', './vendor/three/postprocessing/GTAOPass.js', './vendor/three/postprocessing/OutputPass.js',
  './vendor/three/postprocessing/Pass.js', './vendor/three/postprocessing/ShaderPass.js', './vendor/three/postprocessing/MaskPass.js',
  './vendor/three/shaders/CopyShader.js', './vendor/three/shaders/GTAOShader.js', './vendor/three/shaders/PoissonDenoiseShader.js', './vendor/three/shaders/OutputShader.js',
  './vendor/three/shaders/HorizontalBlurShader.js', './vendor/three/shaders/VerticalBlurShader.js', './vendor/three/math/SimplexNoise.js',
  './assets/models/box_models.json', './assets/models/confections.glb', './assets/artwork/manifest.json',
  './assets/artwork/BOX-10_CASE_outside.webp', './assets/artwork/BOX-10_CASE_outside_gold.png', './assets/artwork/BOX-10_CASE_inside.webp',
  './assets/artwork/BOX-10_CASE_inside_gold.png', './assets/artwork/BOX-10_INSERT_outside.webp',
];
const CODE = /\.(html|js|mjs|css|json)$|\/$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/__')) return;
  if (/\/assets\/(dielines|samples)\//.test(url.pathname)) return;      // large downloads: straight from the network, not stored
  const path = url.pathname;
  const isCode = CODE.test(path) && !path.includes('/vendor/');
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (isCode) {
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; }
      catch (err) { const hit = await cache.match(req, { ignoreSearch: true }); if (hit) return hit; throw err; }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
