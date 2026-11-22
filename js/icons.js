/* The bundled icon set (Lucide, ISC license): loading it, looking icons up and searching them.
   Each icon is one SVG path on a 24 × 24 grid, drawn with a round stroke and no fill. The set
   (assets/icons/lucide.js) is loaded with a <script> tag only when the Icon source is chosen. */
const Icons = (() => {
  'use strict';

  const DATA = 'assets/icons/lucide.js';
  /** Size of the grid the icons are drawn on. */
  const GRID = 24;
  const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  let set = null;     // { version, icons: { name: [tags, path] } }
  let names = [];
  let loading = null;

  /** Called by the data file. */
  function addSet(data) {
    set = data && data.icons ? data : { version: '', icons: {} };
    names = Object.keys(set.icons).sort();
  }

  const loaded = () => !!set;
  const count = () => names.length;
  const version = () => (set ? set.version : '');

  /** True for a name that could be an icon (lowercase words joined by hyphens). */
  function validName(name) {
    return typeof name === 'string' && name.length <= 64 && NAME.test(name);
  }

  /** The icon's path, or null when the set isn't loaded or has no icon by that name. */
  function get(name) {
    if (!set || !validName(name) || !Object.prototype.hasOwnProperty.call(set.icons, name)) return null;
    return set.icons[name][1];
  }

  /** Load the set once. Resolves true when it is ready. Works from file://, unlike fetch. */
  function load() {
    if (set) return Promise.resolve(true);
    if (typeof document === 'undefined') return Promise.resolve(false);
    if (!loading) {
      loading = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = DATA;
        script.onload = () => resolve(!!set);
        script.onerror = () => {
          loading = null;
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }
    return loading;
  }

  /**
   * Icons matching a search, best first: the exact name, then names starting with it, then names whose
   * words start with every search word, then icons whose name or tags contain every word.
   * An empty search lists every icon by name.
   */
  function search(query, list) {
    const all = list || (set ? set.icons : {});
    const keys = list ? Object.keys(list).sort() : names;
    const q = String(query || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!q) return keys.slice();
    const words = q.split(/[\s-]+/).filter(Boolean);
    const joined = words.join('-');
    const scored = [];
    for (const name of keys) {
      const parts = name.split('-');
      const tags = all[name][0];
      let score = 0;
      if (name === joined) score = 4;
      else if (name.indexOf(joined) === 0) score = 3;
      else if (words.every((w) => parts.some((p) => p.indexOf(w) === 0))) score = 2;
      else if (words.every((w) => name.indexOf(w) !== -1 || (' ' + tags + ' ').indexOf(' ' + w) !== -1)) score = 1;
      if (score) scored.push([score, name]);
    }
    scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return scored.map((x) => x[1]);
  }

  return { GRID, addSet, loaded, count, version, validName, get, load, search };
})();
