/* Step-by-step image shrinking. Halving each time (a 2×2 box filter) keeps fine detail from turning jagged,
   and working in premultiplied alpha keeps transparent edges free of dark fringes. Pure: it works on
   { width, height, data } pixel buffers (RGBA, like ImageData). No dependencies. */
const Shrink = (() => {
  'use strict';

  /** Copy of RGBA pixels with each color multiplied by its alpha. */
  function premultiply(rgba) {
    const out = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      out[i] = rgba[i] * a / 255;
      out[i + 1] = rgba[i + 1] * a / 255;
      out[i + 2] = rgba[i + 2] * a / 255;
      out[i + 3] = a;
    }
    return out;
  }

  /** Copy of premultiplied RGBA pixels with colors divided by alpha again. Fully transparent stays 0. */
  function unpremultiply(rgba) {
    const out = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a === 0) continue;
      out[i] = rgba[i] * 255 / a;
      out[i + 1] = rgba[i + 1] * 255 / a;
      out[i + 2] = rgba[i + 2] * 255 / a;
      out[i + 3] = a;
    }
    return out;
  }

  /**
   * Half the size (rounded up), each pixel the average of the 2×2 block it covers. Expects and returns
   * premultiplied pixels, so a transparent neighbor adds no color, only transparency.
   * At an odd edge the last block has fewer pixels and is averaged over those.
   */
  function halve(img) {
    const { width: w, height: h, data } = img;
    const ow = Math.max(1, Math.ceil(w / 2));
    const oh = Math.max(1, Math.ceil(h / 2));
    const out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < oh; y++) {
      const y0 = y * 2;
      const y1 = Math.min(y0 + 1, h - 1);
      for (let x = 0; x < ow; x++) {
        const x0 = x * 2;
        const x1 = Math.min(x0 + 1, w - 1);
        const n = (x1 > x0 ? 2 : 1) * (y1 > y0 ? 2 : 1);
        const a = (y0 * w + x0) * 4;
        const b = (y0 * w + x1) * 4;
        const c = (y1 * w + x0) * 4;
        const d = (y1 * w + x1) * 4;
        const o = (y * ow + x) * 4;
        for (let k = 0; k < 4; k++) {
          const sum = n === 4 ? data[a + k] + data[b + k] + data[c + k] + data[d + k]
            : n === 2 ? data[a + k] + (x1 > x0 ? data[b + k] : data[c + k])
              : data[a + k];
          out[o + k] = sum / n; // Uint8ClampedArray rounds to the nearest value
        }
      }
    }
    return { width: ow, height: oh, data: out };
  }

  /**
   * Sizes of each halving step from `width` × `height` down to `min` px on the shorter side,
   * largest first, starting with the original size.
   */
  function steps(width, height, min) {
    const out = [[width, height]];
    let w = width;
    let h = height;
    while (Math.min(w, h) > (min || 1)) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      out.push([w, h]);
    }
    return out;
  }

  /**
   * Which step to draw from for a target of `w` × `h`: the smallest one still at least as big,
   * so the last shrink is less than half. `levels` are [width, height] pairs, largest first.
   */
  function pick(levels, w, h) {
    let best = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i][0] >= w && levels[i][1] >= h) best = i;
    }
    return best;
  }

  return { premultiply, unpremultiply, halve, steps, pick };
})();
