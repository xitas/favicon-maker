/* ICO file builder that stores PNG images (supported by all current browsers). */
const Ico = (() => {
  'use strict';

  /**
   * @param {number[]} sizes        pixel size of each image
   * @param {ArrayBuffer[]} buffers PNG data, same order as `sizes`
   * @returns {ArrayBuffer}
   */
  function make(sizes, buffers) {
    const n = sizes.length;
    let offset = 6 + 16 * n;
    const total = offset + buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    const bytes = new Uint8Array(out);

    // ICONDIR header
    dv.setUint16(0, 0, true);
    dv.setUint16(2, 1, true); // type: icon
    dv.setUint16(4, n, true);

    // ICONDIRENTRY per image, followed by the image data
    sizes.forEach((size, i) => {
      const p = 6 + 16 * i;
      dv.setUint8(p, size >= 256 ? 0 : size);
      dv.setUint8(p + 1, size >= 256 ? 0 : size);
      dv.setUint8(p + 2, 0);
      dv.setUint8(p + 3, 0);
      dv.setUint16(p + 4, 1, true);
      dv.setUint16(p + 6, 32, true);
      dv.setUint32(p + 8, buffers[i].byteLength, true);
      dv.setUint32(p + 12, offset, true);
      bytes.set(new Uint8Array(buffers[i]), offset);
      offset += buffers[i].byteLength;
    });
    return out;
  }

  return { make };
})();
