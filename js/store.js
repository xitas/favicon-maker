/* Saving designs in the browser: settings in localStorage, images in IndexedDB (they can be too big for
   localStorage). Every call is wrapped, and when either store is unavailable (private browsing, or
   IndexedDB on file:// in some browsers) the app keeps working in memory. Nothing leaves the device. */
const Store = (() => {
  'use strict';

  const PREFIX = 'favicon-maker.';
  const DB_NAME = 'favicon-maker';
  const DB_STORE = 'images';

  const memory = { local: new Map(), images: new Map() };
  let localOk = false;
  let db = null;

  function testLocal() {
    try {
      const key = PREFIX + 'test';
      localStorage.setItem(key, '1');
      const ok = localStorage.getItem(key) === '1';
      localStorage.removeItem(key);
      return ok;
    } catch (e) {
      return false;
    }
  }

  const lateListeners = [];

  /**
   * Open the image database. Some browsers never answer on file:// or in private windows, so the page
   * carries on in memory after a moment. A slow device may still answer later: then the database is used
   * from then on, the images kept in memory meanwhile move into it, and onPersistent listeners hear of it.
   */
  function openDb() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      setTimeout(() => finish(null), 2000);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          try { req.result.createObjectStore(DB_STORE); } catch (e) { /* already there */ }
        };
        req.onsuccess = () => {
          if (!done) { finish(req.result); return; }
          if (!db) adoptLate(req.result);
        };
        req.onerror = () => finish(null);
        req.onblocked = () => finish(null);
      } catch (e) {
        finish(null);
      }
    });
  }

  async function adoptLate(opened) {
    db = opened;
    for (const [id, value] of Array.from(memory.images)) {
      try {
        await request('readwrite', (s) => s.put(value, id));
        memory.images.delete(id);
      } catch (e) { /* stays in memory */ }
    }
    if (persistent()) lateListeners.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* none */ } });
  }

  /** Call `fn` if the image database opens only after init() gave up waiting (a slow device). */
  function onPersistent(fn) {
    lateListeners.push(fn);
  }

  /** Find out what can be used. Resolves to true when designs can be saved (both stores work). */
  async function init() {
    localOk = testLocal();
    db = await openDb();
    return persistent();
  }

  /** True when settings and images both survive a reload. */
  function persistent() {
    return localOk && !!db;
  }

  /* ---------- Settings and lists (localStorage) ---------- */

  function getJson(name) {
    let text = null;
    if (localOk) {
      try { text = localStorage.getItem(PREFIX + name); } catch (e) { text = null; }
    } else {
      text = memory.local.has(name) ? memory.local.get(name) : null;
    }
    if (text === null) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /** Save JSON. Resolves false when it didn't fit (quota) and was kept in memory only. */
  function setJson(name, value) {
    const text = JSON.stringify(value);
    if (localOk) {
      try {
        localStorage.setItem(PREFIX + name, text);
        return true;
      } catch (e) {
        memory.local.set(name, text);
        return false;
      }
    }
    memory.local.set(name, text);
    return true;
  }

  /* ---------- Images (IndexedDB) ---------- */

  // A request the database doesn't finish by then fails, and the caller falls back to memory: the page
  // never waits on it forever (it once kept a busy test browser from ever finishing its start).
  const REQUEST_LIMIT = 10000;

  function request(mode, fn) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the image database did not answer')), REQUEST_LIMIT);
      const done = (f) => (value) => { clearTimeout(timer); f(value); };
      try {
        const tx = db.transaction(DB_STORE, mode);
        const req = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = () => done(resolve)(req ? req.result : undefined);
        tx.onerror = () => done(reject)(tx.error);
        tx.onabort = () => done(reject)(tx.error);
      } catch (e) {
        done(reject)(e);
      }
    });
  }

  async function putImage(id, image) {
    const value = { type: image.type, name: image.name || '', bytes: image.bytes.slice().buffer };
    if (db) {
      try { await request('readwrite', (s) => s.put(value, id)); return; } catch (e) { /* fall through */ }
    }
    memory.images.set(id, value);
  }

  async function getImage(id) {
    if (!id) return null;
    let value = memory.images.get(id) || null;
    if (!value && db) {
      try { value = (await request('readonly', (s) => s.get(id))) || null; } catch (e) { value = null; }
    }
    return value ? { type: value.type, name: value.name, bytes: new Uint8Array(value.bytes) } : null;
  }

  async function imageIds() {
    const ids = new Set(memory.images.keys());
    if (db) {
      try { for (const k of (await request('readonly', (s) => s.getAllKeys())) || []) ids.add(k); } catch (e) { /* none */ }
    }
    return ids;
  }

  async function deleteImage(id) {
    memory.images.delete(id);
    if (db) {
      try { await request('readwrite', (s) => s.delete(id)); } catch (e) { /* nothing to do */ }
    }
  }

  /** Remove images that nothing points to any more. */
  async function collect(keep) {
    for (const id of await imageIds()) if (!keep.has(id)) await deleteImage(id);
  }

  // Page preferences, not design data: Forget all saved data leaves them (the theme is saved by Theme).
  const PREFERENCES = [PREFIX + 'theme'];

  /** Clear everything this app saved: its localStorage keys (except page preferences) and its IndexedDB images. */
  async function forgetAll() {
    memory.local.clear();
    memory.images.clear();
    if (localOk) {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0 && PREFERENCES.indexOf(k) === -1) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* nothing more to do */ }
    }
    if (db) {
      try { await request('readwrite', (s) => s.clear()); } catch (e) { /* nothing more to do */ }
    }
  }

  function newId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* use the fallback */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  return { init, onPersistent, persistent, getJson, setJson, putImage, getImage, deleteImage, collect, forgetAll, newId };
})();
