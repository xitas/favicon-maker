/* The files the generator produces, and how to build each one. Depends on Draw, Ico, Zip. */
const Outputs = (() => {
  'use strict';

  const FILES = [
    { name: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], note: 'Legacy browsers. Holds 16, 32 and 48 px.', dims: '16, 32, 48' },
    { name: 'favicon-16x16.png', kind: 'png', size: 16, note: 'Browser tab', dims: '16 × 16' },
    { name: 'favicon-32x32.png', kind: 'png', size: 32, note: 'Browser tab on high-DPI screens', dims: '32 × 32' },
    { name: 'apple-touch-icon.png', kind: 'png', size: 180, apple: true, note: 'iPhone and iPad home screen (square, no transparency)', dims: '180 × 180' },
    { name: 'android-chrome-192x192.png', kind: 'png', size: 192, note: 'Android home screen', dims: '192 × 192' },
    { name: 'android-chrome-512x512.png', kind: 'png', size: 512, note: 'Android splash screen and installs', dims: '512 × 512' },
    { name: 'site.webmanifest', kind: 'manifest', note: 'Web app manifest that points to the Android icons', dims: 'JSON' }
  ];

  const SNIPPET = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">'
  ].join('\n');

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  function manifestText(s) {
    const color = s.transparent ? '#ffffff' : s.bg;
    return JSON.stringify({
      name: s.appName,
      short_name: s.appName.slice(0, 12),
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
      ],
      theme_color: color,
      background_color: color,
      display: 'standalone'
    }, null, 2) + '\n';
  }

  /** Build one entry of FILES as a Blob, using the current settings. */
  async function build(file, s) {
    if (file.kind === 'manifest') {
      return new Blob([manifestText(s)], { type: 'application/manifest+json' });
    }
    if (file.kind === 'ico') {
      const blobs = await Promise.all(file.sizes.map((z) => toBlob(Draw.render(z, s))));
      const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      return new Blob([Ico.make(file.sizes, buffers)], { type: 'image/x-icon' });
    }
    return toBlob(Draw.render(file.size, s, file.apple));
  }

  /** Build every file and pack them into one ZIP Blob. */
  async function buildZip(s) {
    const entries = [];
    for (const file of FILES) {
      const blob = await build(file, s);
      entries.push({ name: file.name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    return Zip.make(entries);
  }

  return { FILES, SNIPPET, build, buildZip };
})();
