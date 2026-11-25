/*
 * Service worker: keeps the app's own files so it works offline. Registered by app.js over https or on
 * localhost only; opened from disk (file://) there is none. It never keeps anyone's images or designs:
 * those stay in the page's IndexedDB and localStorage, and only the files listed below are ever cached.
 *
 * The lists below, with a hash of each file's contents, are written by tools/build-sw.js
 * (npm run build-sw); a unit test fails if a file changed without it.
 *
 * - Core files are kept when this version installs, in a cache named after the version. Old versions'
 *   caches are deleted when a new version activates.
 * - Optional files (fonts, glyph outlines, the emoji font, the icon library) are kept the first time the
 *   page uses them, in one cache that lasts across versions. Each is kept under its address plus its hash,
 *   so a changed file is fetched again, and old copies are deleted when a new version activates.
 * - A new version waits until the person clicks Reload in the page ("skip-waiting"): nothing reloads by
 *   itself.
 */
'use strict';

// <files> written by tools/build-sw.js; do not edit by hand
var VERSION = "75c61568b920";
var CORE = {
  "index.html": "f0639f7f38ce5618",
  "manifest.webmanifest": "3fa9991e5862b77d",
  "css/style.css": "fb22d221314cf5d6",
  "js/app.js": "197304b0e5dec790",
  "js/checks.js": "bb9bef75791567e5",
  "js/design.js": "6c8ab277a811f8c1",
  "js/dialog.js": "eeedbea06092c76b",
  "js/draw.js": "d4ec99186b402f1d",
  "js/fonts.js": "c7f8c943e5160634",
  "js/icons.js": "6285bf293b94e5f6",
  "js/imagetools.js": "e36dc5dcbe0ad246",
  "js/lib/ico.js": "ff412876c5136fc6",
  "js/lib/shrink.js": "79c1916aae87a16c",
  "js/lib/svg.js": "440b485feafbae13",
  "js/lib/zip.js": "2b1af98edf649073",
  "js/outputs.js": "d445f206c28a836f",
  "js/previews.js": "8a8f067f9be0df3c",
  "js/store.js": "d688d27b432d990f",
  "js/templates.js": "10076c5185477c29",
  "js/theme.js": "fe6717f2ac1cec04",
  "assets/fonts/display/anton-name.woff2": "f6b0a10bcea248ae",
  "assets/fonts/geometric/montserrat-name.woff2": "3d20eb4b0ba070f0",
  "assets/fonts/handwritten/caveat-name.woff2": "4685c19d2a680b1a",
  "assets/fonts/mono/jetbrainsmono-name.woff2": "aead94fe17a625e3",
  "assets/fonts/rounded/nunito-name.woff2": "411ea389bee0b1e9",
  "assets/fonts/sans/inter-name.woff2": "b00058e32c11545b",
  "assets/fonts/serif/sourceserif4-name.woff2": "fd9ba13f294e5c58",
  "assets/fonts/slab/zillaslab-name.woff2": "d97252d3d7468d9c",
  "assets/app-icon/android-chrome-192x192.png": "20f9bc48834b5593",
  "assets/app-icon/android-chrome-512x512.png": "db91bcbcfb45eab8",
  "assets/app-icon/apple-touch-icon.png": "d6855820bfbfd796",
  "assets/app-icon/favicon-16x16.png": "a4d581b952d7ef80",
  "assets/app-icon/favicon-32x32.png": "340e8cca40f9adb1",
  "assets/app-icon/favicon.ico": "a9d327017eaf3e7b",
  "assets/app-icon/favicon.svg": "0acb8642dbdcffa6",
  "assets/app-icon/maskable-icon-192x192.png": "aa511a1f8e3af136",
  "assets/app-icon/maskable-icon-512x512.png": "28bc6371fa0c5ece"
};
var OPTIONAL = {
  "assets/fonts/display/anton-400.glyphs.js": ["7227754f74080dad", 184898],
  "assets/fonts/display/anton-400.woff2": ["0635d22b722cae23", 21404],
  "assets/fonts/emoji/noto-color-emoji.woff2": ["4a9fbf7ae6788fbd", 1997128],
  "assets/fonts/geometric/montserrat-400.glyphs.js": ["46c9cc3943b7e465", 241105],
  "assets/fonts/geometric/montserrat-400.woff2": ["9b2aa0e0dbcceb38", 30768],
  "assets/fonts/geometric/montserrat-700.glyphs.js": ["fc30520e4e46c858", 242352],
  "assets/fonts/geometric/montserrat-700.woff2": ["35816e63faee33bf", 31940],
  "assets/fonts/handwritten/caveat-400.glyphs.js": ["5964080f7d0e6506", 391501],
  "assets/fonts/handwritten/caveat-700.glyphs.js": ["6d243eafd9103481", 395633],
  "assets/fonts/handwritten/caveat-variable.woff2": ["51458b1960655180", 49788],
  "assets/fonts/mono/jetbrainsmono-400.glyphs.js": ["7efa47a647e1de32", 97431],
  "assets/fonts/mono/jetbrainsmono-700.glyphs.js": ["3e9b328d85adb960", 98143],
  "assets/fonts/mono/jetbrainsmono-variable.woff2": ["b5758a84b80cdb8b", 18672],
  "assets/fonts/rounded/nunito-400.glyphs.js": ["f17d9a9ad24380d6", 233386],
  "assets/fonts/rounded/nunito-700.glyphs.js": ["fe28aa5a4633194b", 239573],
  "assets/fonts/rounded/nunito-variable.woff2": ["1fc271bf5bd7020d", 36968],
  "assets/fonts/sans/inter-400.glyphs.js": ["cfd1c99c30577bfe", 320238],
  "assets/fonts/sans/inter-700.glyphs.js": ["7b881d0ecdbb120a", 320911],
  "assets/fonts/sans/inter-variable.woff2": ["30404efe0ea176b4", 71060],
  "assets/fonts/serif/sourceserif4-400.glyphs.js": ["868da49967a264d5", 202293],
  "assets/fonts/serif/sourceserif4-700.glyphs.js": ["79afe8def6b68f44", 202433],
  "assets/fonts/serif/sourceserif4-variable.woff2": ["564e3d817ed9a77b", 41560],
  "assets/fonts/slab/zillaslab-400.glyphs.js": ["a14f013d39f6d47d", 93729],
  "assets/fonts/slab/zillaslab-400.woff2": ["eb26b7c7e1743b48", 18252],
  "assets/fonts/slab/zillaslab-700.glyphs.js": ["c3924df53a386ae7", 93856],
  "assets/fonts/slab/zillaslab-700.woff2": ["00b4a61643755b2b", 18348],
  "assets/icons/lucide.js": ["9395594db508a8b0", 610938]
};
// </files>

var PREFIX = 'favicon-maker-';
var CORE_CACHE = PREFIX + 'core-' + VERSION;
var OPTIONAL_CACHE = PREFIX + 'optional';
var SCOPE = self.registration.scope; // https://.../favicon-maker/
var INDEX = SCOPE + 'index.html';

/** The address an optional file is kept under: its plain address plus its hash. */
function optionalKey(file) {
  return SCOPE + file + '?h=' + OPTIONAL[file][0];
}

self.addEventListener('install', function (event) {
  // Each file is fetched fresh (the hash in the query gets past HTTP caches) and kept under its plain address.
  event.waitUntil(caches.open(CORE_CACHE).then(function (cache) {
    return Promise.all(Object.keys(CORE).map(function (file) {
      return fetch(new Request(SCOPE + file + '?h=' + CORE[file], { cache: 'no-cache' })).then(function (response) {
        if (!response.ok) throw new Error('Could not fetch ' + file);
        return cache.put(SCOPE + file, response);
      });
    }));
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    // Other versions' core files go.
    return Promise.all(keys.filter(function (k) {
      return k.indexOf(PREFIX) === 0 && k !== CORE_CACHE && k !== OPTIONAL_CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () {
    // Optional files that changed (or are no longer used) go; unchanged ones stay.
    var current = {};
    Object.keys(OPTIONAL).forEach(function (f) { current[optionalKey(f)] = true; });
    return caches.open(OPTIONAL_CACHE).then(function (cache) {
      return cache.keys().then(function (requests) {
        return Promise.all(requests.filter(function (r) { return !current[r.url]; }).map(function (r) { return cache.delete(r); }));
      });
    });
  }).then(function () { return self.clients.claim(); }));
});

/** Which optional files are kept: [{ file, bytes, cached }]. */
function optionalStatus() {
  return caches.open(OPTIONAL_CACHE).then(function (cache) {
    return Promise.all(Object.keys(OPTIONAL).map(function (file) {
      return cache.match(optionalKey(file)).then(function (hit) {
        return { file: file, bytes: OPTIONAL[file][1], cached: !!hit };
      });
    }));
  });
}

self.addEventListener('message', function (event) {
  var data = event.data || {};
  // The page asks the waiting version to take over, after the person clicked Reload.
  if (data.type === 'skip-waiting') self.skipWaiting();
  // The page asks what is kept for offline use.
  if (data.type === 'status' && event.ports && event.ports[0]) {
    var port = event.ports[0];
    event.waitUntil(optionalStatus().then(function (files) {
      port.postMessage({ version: VERSION, files: files });
    }));
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.href.indexOf(SCOPE) !== 0) return;
  var file = decodeURIComponent(url.pathname.slice(new URL(SCOPE).pathname.length));

  // The page itself (any address in the scope, with any query or hash): the kept index.html.
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(INDEX, { cacheName: CORE_CACHE }).then(function (kept) {
      return kept || fetch(req);
    }));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(CORE, file)) {
    event.respondWith(caches.match(SCOPE + file, { cacheName: CORE_CACHE }).then(function (kept) {
      return kept || fetch(req);
    }));
    return;
  }
  if (Object.prototype.hasOwnProperty.call(OPTIONAL, file)) {
    // Kept the first time it is used. Offline and not kept yet, the request fails, and the page says so.
    var key = optionalKey(file);
    event.respondWith(caches.open(OPTIONAL_CACHE).then(function (cache) {
      return cache.match(key).then(function (kept) {
        if (kept) return kept;
        return fetch(new Request(key, { cache: 'no-cache' })).then(function (response) {
          if (!response.ok) return response;
          // Kept before it's handed over, so the page's offline status is right as soon as it arrives.
          return cache.put(key, response.clone()).then(function () { return response; });
        });
      });
    }));
  }
  // Anything else (there is nothing else the page loads) goes to the network as usual.
});
