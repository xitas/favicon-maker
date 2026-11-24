'use strict';
/* A tiny static file server for the project root, on a random local port. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { ROOT } = require('./load');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * @param {object} [options]
 * @param {string} [options.root]  folder to serve (default: the project)
 * @param {(pathname: string) => number} [options.delay]  milliseconds to wait before answering, per file
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function startServer(options = {}) {
  const root = options.root || ROOT;
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
    if (!file.startsWith(root + path.sep) || file.includes(path.sep + 'node_modules' + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const wait = options.delay ? options.delay(pathname) : 0;
    setTimeout(() => fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      // No HTTP caching, like a fresh visit: what the service worker keeps is all there is.
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    }), wait);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

module.exports = { startServer };
