// Lector service worker.
// 1. Keeps the app shell on the device, so it opens with no connection.
// 2. Adds the isolation headers that allow multi-threaded voice synthesis. Static hosts such as GitHub Pages cannot send them.
// Voice model files are large and are kept by the voice workers themselves, so they pass straight through here.
const SHELL = 'lector-shell-v6';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'lib/jszip.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/newsreader-latin-400-normal.woff2', 'fonts/newsreader-latin-500-normal.woff2', 'fonts/newsreader-latin-400-italic.woff2',
  'tts/common.js', 'tts/kokoro/worker.js', 'tts/kokoro/phonemizer.js', 'tts/kokoro/espeak-ng.js', 'tts/supertonic/worker.js', 'tts/piper/worker.js', 'tts/piper/daniela.json', 'tts/ort/ort.wasm.min.js', 'tts/ort/ort-wasm-simd-threaded.js',
  ...['k-af_aoede.mp3', 'k-af_bella.mp3', 'k-af_heart.mp3', 'k-af_kore.mp3', 'k-af_nicole.mp3', 'k-af_sarah.mp3', 'k-am_fenrir.mp3', 'k-am_michael.mp3', 'k-am_puck.mp3', 'k-bf_emma.mp3', 'k-bf_isabella.mp3', 'k-bm_fable.mp3', 'k-bm_george.mp3', 'k-ef_dora.mp3', 'k-em_alex.mp3', 'k-em_santa.mp3', 'p-daniela.mp3', 'k-ff_siwis.mp3', 'k-if_sara.mp3', 'k-im_nicola.mp3', 'k-pf_dora.mp3', 'k-pm_alex.mp3', 's-es-0.mp3', 's-es-1.mp3', 's-es-2.mp3', 's-es-3.mp3', 's-es-4.mp3', 's-es-5.mp3', 's-es-6.mp3', 's-es-7.mp3', 's-es-8.mp3', 's-es-9.mp3'].map(f => 'tts/samples/' + f)];

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then(c => Promise.allSettled(FILES.map(f => c.add(new Request(f, { cache:'reload' })))))); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for(const k of await caches.keys()) if(k.startsWith('lector-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

function isolate(r){
  if(!r || r.status === 0 || r.type === 'opaque' || r.type === 'opaqueredirect') return r;
  const h = new Headers(r.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(r.body, { status:r.status, statusText:r.statusText, headers:h });
}
const HEAVY = /\/tts\/(kokoro\/(model|voices)\/|kokoro\/espeak-ng\.wasm|supertonic\/w\/|piper\/model\/|ort\/.*\.wasm)/;
const late = ms => new Promise(r => setTimeout(() => r(null), ms));

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  e.respondWith((async () => {
    if(HEAVY.test(url.pathname)) return isolate(await fetch(req));
    const cache = await caches.open(SHELL), hit = await cache.match(req, { ignoreSearch:true });
    const fresh = fetch(req).then(r => { if(r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    // The page itself: prefer the network so updates arrive, but never wait long on a weak signal. Everything else: the saved copy first.
    const r = req.mode === 'navigate' ? (await Promise.race([fresh, hit ? late(2500) : fresh]) || hit) : (hit || await fresh);
    return isolate(r || hit || new Response('Offline', { status:503 }));
  })());
});
