'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const { unzipSync } = require('fflate');
const { loadScripts, toBuffer } = require('../helpers/load');
const { parseZip, dosDateTime } = require('../helpers/formats');

const { Zip } = loadScripts();
const enc = new TextEncoder();

const SAMPLE_FILES = () => [
  { name: 'hello.txt', data: enc.encode('Hello, world!\n') },
  { name: 'café-ñandú-Ångström.txt', data: enc.encode('Accents in the name') },
  { name: 'emoji-😀-👨‍👩‍👧-🇵🇰.txt', data: enc.encode('Emoji in the name: 👍🏽') },
  { name: 'empty.bin', data: new Uint8Array(0) },
  { name: 'folder/nested.txt', data: enc.encode('nested') },
  { name: 'big.bin', data: new Uint8Array(crypto.randomBytes(5 * 1024 * 1024)) }
];

test('crc32 matches zlib.crc32', async (t) => {
  const cases = {
    'empty input': new Uint8Array(0),
    'one byte': new Uint8Array([0]),
    'short text': enc.encode('The quick brown fox jumps over the lazy dog'),
    'UTF-8 text': enc.encode('Café 😀 👨‍👩‍👧'),
    'all byte values': Uint8Array.from({ length: 256 }, (_, i) => i),
    'large random data (8 MB)': new Uint8Array(crypto.randomBytes(8 * 1024 * 1024))
  };
  for (const [label, bytes] of Object.entries(cases)) {
    await t.test(label, () => {
      assert.equal(Zip.crc32(bytes), zlib.crc32(bytes));
    });
  }
});

test('crc32 gives the standard check value for "123456789"', () => {
  assert.equal(Zip.crc32(enc.encode('123456789')), 0xcbf43926);
});

test('crc32 always returns an unsigned 32-bit number', () => {
  const value = Zip.crc32(enc.encode('a'));
  assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff);
});

test('make returns an application/zip Blob', () => {
  const blob = Zip.make([{ name: 'a.txt', data: enc.encode('a') }]);
  assert.equal(blob.type, 'application/zip');
});

test('fflate reads every file back byte-for-byte', async () => {
  const files = SAMPLE_FILES();
  const buf = await toBuffer(Zip.make(files));
  const out = unzipSync(new Uint8Array(buf));

  assert.deepEqual(Object.keys(out).sort(), files.map((f) => f.name).sort());
  for (const f of files) {
    assert.ok(Buffer.from(out[f.name]).equals(Buffer.from(f.data)), `${f.name} came back different`);
  }
});

test('an empty archive is valid', async () => {
  const buf = await toBuffer(Zip.make([]));
  assert.equal(buf.length, 22);
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(buf))), []);
});

const hasUnzip = spawnSync('unzip', ['-v']).status === 0;

test('unzip -t accepts the archive', { skip: !hasUnzip && 'unzip is not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favicon-zip-'));
  try {
    const file = path.join(dir, 'test.zip');
    fs.writeFileSync(file, await toBuffer(Zip.make(SAMPLE_FILES())));
    const result = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No errors detected/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('header fields are consistent', async () => {
  const files = SAMPLE_FILES();
  const buf = await toBuffer(Zip.make(files));
  const zip = parseZip(buf);

  // End of central directory
  assert.equal(zip.eocd.disk, 0);
  assert.equal(zip.eocd.cdDisk, 0);
  assert.equal(zip.eocd.entriesOnDisk, files.length);
  assert.equal(zip.eocd.entries, files.length);
  assert.equal(zip.eocd.commentLength, 0);
  assert.equal(zip.cdEnd, zip.eocd.at, 'central directory ends where the end record starts');
  assert.equal(zip.eocd.cdOffset + zip.eocd.cdSize, zip.eocd.at, 'central directory size and offset add up');

  let expectedOffset = 0;
  files.forEach((f, i) => {
    const c = zip.central[i];
    const l = zip.local[i];
    const name = Buffer.from(enc.encode(f.name));
    const crc = zlib.crc32(f.data);

    // Central directory entry
    assert.equal(c.versionNeeded, 20);
    assert.equal(c.flags, 0x0800, 'UTF-8 flag (bit 11) and nothing else');
    assert.equal(c.method, 0, 'stored');
    assert.equal(c.crc, crc);
    assert.equal(c.size, f.data.length);
    assert.equal(c.compressedSize, f.data.length);
    assert.ok(c.nameBytes.equals(name), 'central name bytes are UTF-8');
    assert.equal(c.extraLength, 0);
    assert.equal(c.commentLength, 0);
    assert.equal(c.diskStart, 0);
    assert.equal(c.localOffset, expectedOffset, 'local header offset');

    // Local header matches the central entry
    assert.equal(l.versionNeeded, 20);
    assert.equal(l.flags, 0x0800);
    assert.equal(l.method, 0);
    assert.equal(l.time, c.time);
    assert.equal(l.date, c.date);
    assert.equal(l.crc, crc);
    assert.equal(l.size, f.data.length);
    assert.equal(l.compressedSize, f.data.length);
    assert.ok(l.nameBytes.equals(name), 'local name bytes are UTF-8');
    assert.equal(l.extraLength, 0);
    assert.ok(buf.subarray(l.dataStart, l.dataEnd).equals(Buffer.from(f.data)), 'stored data');

    expectedOffset = l.dataEnd;
  });
  assert.equal(zip.eocd.cdOffset, expectedOffset, 'central directory starts right after the last file');
});

test('DOS date and time are valid and close to now', async () => {
  const before = Date.now();
  const zip = parseZip(await toBuffer(Zip.make([{ name: 'a.txt', data: enc.encode('a') }])));
  const d = dosDateTime(zip.central[0].date, zip.central[0].time);

  assert.ok(d.month >= 1 && d.month <= 12, 'month');
  assert.ok(d.day >= 1 && d.day <= 31, 'day');
  assert.ok(d.hours <= 23, 'hours');
  assert.ok(d.minutes <= 59, 'minutes');
  assert.ok(d.seconds <= 58, 'seconds');

  const stamp = new Date(d.year, d.month - 1, d.day, d.hours, d.minutes, d.seconds).getTime();
  assert.ok(Math.abs(stamp - before) < 2 * 60 * 1000, 'within two minutes of now (local time)');
});

test('DOS date and time encode a fixed local time exactly', async () => {
  const { Zip: FixedZip } = loadScripts({ now: new Date(2026, 10, 21, 17, 4, 59) });
  const zip = parseZip(await toBuffer(FixedZip.make([{ name: 'a.txt', data: enc.encode('a') }])));
  const c = zip.central[0];

  assert.equal(c.time, (17 << 11) | (4 << 5) | 29, 'time (seconds are stored in 2-second steps)');
  assert.equal(c.date, ((2026 - 1980) << 9) | (11 << 5) | 21, 'date');
  assert.deepEqual(dosDateTime(c.date, c.time), { year: 2026, month: 11, day: 21, hours: 17, minutes: 4, seconds: 58 });
});
