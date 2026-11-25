'use strict';
/* js/store.js with a stand-in IndexedDB: a database that answers late, and requests that never finish. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('../helpers/load');

const SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');

/** A localStorage that works. */
function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => Array.from(map.keys())[i] || null,
    get length() { return map.size; }
  };
}

/**
 * A stand-in IndexedDB. `openAfter` is how long open takes (ms); with `hang`, transactions never finish.
 * Its records are in `records`.
 */
function fakeIndexedDb({ openAfter = 0, hang = false } = {}) {
  const records = new Map();
  const database = {
    createObjectStore() {},
    transaction() {
      const tx = {};
      const store = {
        put(value, key) { records.set(key, value); return { result: key }; },
        get(key) { return { result: records.get(key) }; },
        getAllKeys() { return { result: Array.from(records.keys()) }; },
        delete(key) { records.delete(key); return { result: undefined }; },
        clear() { records.clear(); return { result: undefined }; }
      };
      tx.objectStore = () => store;
      if (!hang) setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    }
  };
  return {
    records,
    api: {
      open() {
        const req = {};
        setTimeout(() => { req.result = database; if (req.onupgradeneeded) req.onupgradeneeded(); req.onsuccess(); }, openAfter);
        return req;
      }
    }
  };
}

function loadStore(indexedDB) {
  const context = vm.createContext({ localStorage: fakeLocalStorage(), indexedDB, setTimeout, clearTimeout, Map, Set, Uint8Array, Promise, Date, Math, crypto: globalThis.crypto });
  vm.runInContext(SOURCE + '\nthis.Store = Store;', context);
  return context.Store;
}

const image = (n) => ({ type: 'image/png', name: 'a.png', bytes: new Uint8Array([n, n, n]) });

test('a database that opens at once is used', async () => {
  const idb = fakeIndexedDb();
  const Store = loadStore(idb.api);
  assert.equal(await Store.init(), true);
  await Store.putImage('a', image(1));
  assert.ok(idb.records.has('a'));
});

test('a database that answers late is used from then on, with the images kept in memory meanwhile', async () => {
  const idb = fakeIndexedDb({ openAfter: 2600 }); // after init stops waiting (2 s)
  const Store = loadStore(idb.api);
  let told = false;
  assert.equal(await Store.init(), false, 'not yet: the page carries on in memory');
  Store.onPersistent(() => { told = true; });
  await Store.putImage('early', image(2));
  assert.equal(idb.records.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(Store.persistent(), true, 'the late database is used');
  assert.equal(told, true, 'the page hears of it');
  assert.ok(idb.records.has('early'), 'the image kept in memory moved into it');
  const back = await Store.getImage('early');
  assert.deepEqual(Array.from(back.bytes), [2, 2, 2]);
});

test('a request the database never finishes fails over to memory instead of waiting forever', { timeout: 30000 }, async () => {
  const idb = fakeIndexedDb({ hang: true });
  const Store = loadStore(idb.api);
  assert.equal(await Store.init(), true);
  const start = Date.now();
  await Store.putImage('x', image(3)); // the put never finishes: kept in memory after the limit
  const got = await Store.getImage('x');
  assert.deepEqual(Array.from(got.bytes), [3, 3, 3]);
  await Store.collect(new Set(['x'])); // what the page's start waits for
  assert.ok(Date.now() - start < 25000, 'two requests at 10 s each: nothing waits forever');
});
