'use strict';
/* Small readers for the binary formats the app writes, written from the specs, used to check headers. */
const { PNG } = require('pngjs');

/** Parse a ZIP archive's end record, central directory and local headers (no ZIP64, no comment). */
function parseZip(buf) {
  const eocdAt = buf.length - 22;
  if (eocdAt < 0 || buf.readUInt32LE(eocdAt) !== 0x06054b50) throw new Error('No end of central directory record at the end of the file');
  const eocd = {
    at: eocdAt,
    disk: buf.readUInt16LE(eocdAt + 4),
    cdDisk: buf.readUInt16LE(eocdAt + 6),
    entriesOnDisk: buf.readUInt16LE(eocdAt + 8),
    entries: buf.readUInt16LE(eocdAt + 10),
    cdSize: buf.readUInt32LE(eocdAt + 12),
    cdOffset: buf.readUInt32LE(eocdAt + 16),
    commentLength: buf.readUInt16LE(eocdAt + 20)
  };

  const central = [];
  let p = eocd.cdOffset;
  for (let i = 0; i < eocd.entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory signature at ' + p);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    central.push({
      at: p,
      versionMadeBy: buf.readUInt16LE(p + 4),
      versionNeeded: buf.readUInt16LE(p + 6),
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      nameLength, extraLength, commentLength,
      diskStart: buf.readUInt16LE(p + 34),
      localOffset: buf.readUInt32LE(p + 42),
      nameBytes: buf.subarray(p + 46, p + 46 + nameLength)
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  const cdEnd = p;

  const local = central.map((c) => {
    const q = c.localOffset;
    if (buf.readUInt32LE(q) !== 0x04034b50) throw new Error('Bad local header signature at ' + q);
    const nameLength = buf.readUInt16LE(q + 26);
    const extraLength = buf.readUInt16LE(q + 28);
    const dataStart = q + 30 + nameLength + extraLength;
    const compressedSize = buf.readUInt32LE(q + 18);
    return {
      at: q,
      versionNeeded: buf.readUInt16LE(q + 4),
      flags: buf.readUInt16LE(q + 6),
      method: buf.readUInt16LE(q + 8),
      time: buf.readUInt16LE(q + 10),
      date: buf.readUInt16LE(q + 12),
      crc: buf.readUInt32LE(q + 14),
      compressedSize,
      size: buf.readUInt32LE(q + 22),
      nameLength, extraLength,
      nameBytes: buf.subarray(q + 30, q + 30 + nameLength),
      dataStart,
      dataEnd: dataStart + compressedSize
    };
  });

  return { eocd, central, cdEnd, local };
}

/** Decode a DOS date and time pair into its parts. */
function dosDateTime(date, time) {
  return {
    year: 1980 + (date >> 9),
    month: (date >> 5) & 0x0f,
    day: date & 0x1f,
    hours: time >> 11,
    minutes: (time >> 5) & 0x3f,
    seconds: (time & 0x1f) * 2
  };
}

/** Parse an ICO file's header and directory entries. */
function parseIco(buf) {
  const header = { reserved: buf.readUInt16LE(0), type: buf.readUInt16LE(2), count: buf.readUInt16LE(4) };
  const entries = [];
  for (let i = 0; i < header.count; i++) {
    const p = 6 + 16 * i;
    const size = buf.readUInt32LE(p + 8);
    const offset = buf.readUInt32LE(p + 12);
    entries.push({
      widthByte: buf.readUInt8(p),
      heightByte: buf.readUInt8(p + 1),
      colors: buf.readUInt8(p + 2),
      reserved: buf.readUInt8(p + 3),
      planes: buf.readUInt16LE(p + 4),
      bitCount: buf.readUInt16LE(p + 6),
      size,
      offset,
      data: buf.subarray(offset, offset + size)
    });
  }
  return { header, entries };
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('Not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Make a PNG of the given size, filled by `pixel(x, y) -> [r, g, b, a]`. */
function makePng(width, height, pixel) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

/** Decode a PNG into { width, height, data } with RGBA pixels. */
function readPng(buf) {
  return PNG.sync.read(buf);
}

/** An exact ArrayBuffer copy of a Buffer's bytes. */
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

module.exports = { parseZip, dosDateTime, parseIco, pngSize, makePng, readPng, toArrayBuffer };
