#!/usr/bin/env python3
"""
Builds the bundled icon fonts in assets/fonts/ from their upstream sources.
For maintainers only: the page never runs this, and nothing here is needed to use or test the app.

    python -m pip install fonttools brotli
    python tools/build-fonts.py [cache folder] [--text-only]

--text-only keeps the existing emoji font, which takes several minutes to compress.

For each font it:
- downloads the upstream file and its OFL license (google/fonts and googlefonts/noto-emoji),
- keeps only Latin and Latin Extended (plus combining accents) and drops hinting, which differs per platform,
- writes regular and bold as static woff2 files, or one variable woff2 when that is smaller,
- keeps only the kerning feature, so each character is always one glyph (no ligatures or contextual
  alternates), which lets favicon.svg draw the same outlines as the canvas,
- writes the glyph outlines of each weight as compact path data (<font>-<weight>.glyphs.js), loaded only
  when a page builds favicon.svg,
- writes a tiny "name" font with just the letters of its label, for the font menu,
- writes the characters each font really has into js/fonts.js, between the GENERATED markers.
"""
import io
import json
import os
import re
import sys
import tempfile
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
from fontTools.varLib import instancer
from fontTools.pens.basePen import BasePen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'fonts')
FONTS_JS = os.path.join(ROOT, 'js', 'fonts.js')
GF = 'https://raw.githubusercontent.com/google/fonts/main/'
NOTO = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/'

# key: (label, style, generic fallback, sources, license URL)
# sources: {"var": url} for a variable font, or {400: url, 700: url} for static files.
FONTS = {
    'sans': ('Inter', 'Sans', 'sans-serif', {'var': GF + 'ofl/inter/Inter%5Bopsz,wght%5D.ttf'}, GF + 'ofl/inter/OFL.txt'),
    'rounded': ('Nunito', 'Rounded', 'sans-serif', {'var': GF + 'ofl/nunito/Nunito%5Bwght%5D.ttf'}, GF + 'ofl/nunito/OFL.txt'),
    # Not Lora: its license reserves the name "Lora", which a subset (a modified version) may not use.
    'serif': ('Source Serif 4', 'Serif', 'serif', {'var': GF + 'ofl/sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf'}, GF + 'ofl/sourceserif4/OFL.txt'),
    'slab': ('Zilla Slab', 'Slab', 'serif', {400: GF + 'ofl/zillaslab/ZillaSlab-Regular.ttf', 700: GF + 'ofl/zillaslab/ZillaSlab-Bold.ttf'}, GF + 'ofl/zillaslab/OFL.txt'),
    'mono': ('JetBrains Mono', 'Mono', 'monospace', {'var': GF + 'ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf'}, GF + 'ofl/jetbrainsmono/OFL.txt'),
    'display': ('Anton', 'Display', 'sans-serif', {400: GF + 'ofl/anton/Anton-Regular.ttf'}, GF + 'ofl/anton/OFL.txt'),
    'geometric': ('Montserrat', 'Geometric', 'sans-serif', {'var': GF + 'ofl/montserrat/Montserrat%5Bwght%5D.ttf'}, GF + 'ofl/montserrat/OFL.txt'),
    'handwritten': ('Caveat', 'Handwritten', 'cursive', {'var': GF + 'ofl/caveat/Caveat%5Bwght%5D.ttf'}, GF + 'ofl/caveat/OFL.txt'),
}
EMOJI = (NOTO + '2D/fonts/Noto-COLRv1.ttf', NOTO + 'LICENSE')

LICENSE_NOTE = 'Font Software under the SIL Open Font License 1.1, see OFL.txt in this folder.'

# Latin and Latin Extended, as Google Fonts splits them, plus all combining accents (U+0300-036F).
LATIN = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,'
         'U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,'
         'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0300-036F,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,'
         'U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF')


def parse_ranges(text):
    out = set()
    for part in text.split(','):
        a, _, b = part.strip()[2:].partition('-')
        out.update(range(int(a, 16), int(b or a, 16) + 1))
    return out


def to_ranges(codepoints):
    cps = sorted(codepoints)
    ranges, start, prev = [], None, None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    if start is not None:
        ranges.append((start, prev))
    return ranges


def fetch(url, cache):
    path = os.path.join(cache, re.sub(r'[^\w.-]', '_', url.split('/', 3)[-1]))
    if not os.path.exists(path):
        print('  downloading', url)
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def subset(font, unicodes, keep_layout=True):
    opts = Options()
    opts.hinting = False
    opts.desubroutinize = True
    # Kerning only: no ligatures or contextual alternates, so each character is one glyph everywhere.
    opts.layout_features = ['kern'] if keep_layout else []
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.notdef_outline = True
    s = Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    return font


def woff2_bytes(font):
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


class CompactPen(BasePen):
    """Glyph outlines as a short SVG-like path: relative whole numbers in font units, y up."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.parts = []
        self.cur = (0, 0)
        self.start = (0, 0)

    def _add(self, cmd, *pts):
        nums = []
        for x, y in pts:
            nums += [round(x) - self.cur[0], round(y) - self.cur[1]]
        self.parts.append(cmd + ' '.join(str(n) for n in nums).replace(' -', '-'))
        self.cur = (round(pts[-1][0]), round(pts[-1][1]))

    def _moveTo(self, pt):
        self._add('m', pt)
        self.start = self.cur

    def _lineTo(self, pt):
        self._add('l', pt)

    def _qCurveToOne(self, pt1, pt2):
        # Both points relative to the current point, as in SVG.
        x0, y0 = self.cur
        self.parts.append('q' + ' '.join(str(n) for n in [round(pt1[0]) - x0, round(pt1[1]) - y0,
                                                            round(pt2[0]) - x0, round(pt2[1]) - y0]).replace(' -', '-'))
        self.cur = (round(pt2[0]), round(pt2[1]))

    def _curveToOne(self, pt1, pt2, pt3):
        x0, y0 = self.cur
        nums = [round(p[i]) - (x0, y0)[i] for p in (pt1, pt2, pt3) for i in (0, 1)]
        self.parts.append('c' + ' '.join(str(n) for n in nums).replace(' -', '-'))
        self.cur = (round(pt3[0]), round(pt3[1]))

    def _closePath(self):
        self.parts.append('z')
        self.cur = self.start

    def value(self):
        return ''.join(self.parts)


def glyph_paths(data, codepoints):
    """{code point: compact path} for a static font given as woff2 bytes."""
    font = TTFont(io.BytesIO(data))
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    out = {}
    for cp in sorted(codepoints):
        pen = CompactPen(glyph_set)
        glyph_set[cmap[cp]].draw(pen)
        out[str(cp)] = pen.value()
    return font['head'].unitsPerEm, out


def reload(font):
    """Save and reopen, so later steps see plain tables (fontTools loads some tables lazily)."""
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return TTFont(buf)


def pin_other_axes(font):
    """Pin every axis except wght to its default (Inter has an optical size axis)."""
    if 'fvar' not in font:
        return font
    pins = {a.axisTag: a.defaultValue for a in font['fvar'].axes if a.axisTag != 'wght'}
    return instancer.instantiateVariableFont(font, pins) if pins else font


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    text_only = '--text-only' in sys.argv
    cache = args[0] if args else os.path.join(tempfile.gettempdir(), 'favicon-maker-fonts')
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    latin = parse_ranges(LATIN)
    manifest = {}
    total = 0
    glyph_total = [0]

    for key, (label, style, generic, sources, license_url) in FONTS.items():
        print(key, label)
        folder = os.path.join(OUT, key)
        os.makedirs(folder, exist_ok=True)
        for old in os.listdir(folder):
            os.remove(os.path.join(folder, old))
        slug = re.sub(r'\W', '', label.lower())

        candidates = {}
        if 'var' in sources:
            src = fetch(sources['var'], cache)
            axis = {a.axisTag: a for a in TTFont(src)['fvar'].axes}['wght']
            weights = [w for w in (400, 700) if axis.minValue <= w <= axis.maxValue]
            base = reload(subset(TTFont(src), latin))
            base = reload(pin_other_axes(base))
            # Option A: one variable file limited to 400-700.
            var = instancer.instantiateVariableFont(reload(base), {'wght': (min(weights), max(weights))})
            candidates['var'] = {'variable': woff2_bytes(reload(var))}
            # Option B: one static file per weight.
            candidates['static'] = {}
            for w in weights:
                inst = instancer.instantiateVariableFont(reload(base), {'wght': w})
                candidates['static'][w] = woff2_bytes(reload(inst))
        else:
            weights = sorted(sources)
            candidates['static'] = {w: woff2_bytes(subset(TTFont(fetch(sources[w], cache)), latin)) for w in weights}

        size = lambda files: sum(len(b) for b in files.values())
        kind = min(candidates, key=lambda k: size(candidates[k]))
        files = {}
        for w, data in candidates[kind].items():
            name = f'{slug}-{w}.woff2' if w != 'variable' else f'{slug}-variable.woff2'
            with open(os.path.join(folder, name), 'wb') as f:
                f.write(data)
            files[str(w)] = f'{key}/{name}'
            total += len(data)

        # Characters every weight really has (they match, but take the intersection to be safe).
        covered = None
        for data in candidates[kind].values():
            cmap = set(TTFont(io.BytesIO(data)).getBestCmap())
            covered = cmap if covered is None else covered & cmap

        # Glyph outlines per weight, from the static instances (the same outlines the browser draws).
        glyph_files = {}
        for w in weights:
            upm, paths = glyph_paths(candidates['static'][w], covered)
            name = f'{slug}-{w}.glyphs.js'
            text = (f'/* Glyph outlines of {label} {w} for favicon.svg, made by tools/build-fonts.py. {LICENSE_NOTE} */\n'
                    + f'Fonts.addGlyphs({json.dumps(key)}, {w}, ' + json.dumps({'upm': upm, 'glyphs': paths}, separators=(',', ':')) + ');\n')
            with open(os.path.join(folder, name), 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
            glyph_files[str(w)] = f'{key}/{name}'
            glyph_total[0] += len(text.encode('utf-8'))

        # Tiny font with only the letters of the menu label, for showing each option in its own font.
        preview_text = f'{label} ({style})'
        first = candidates[kind][next(iter(candidates[kind]))]
        preview = reload(subset(TTFont(io.BytesIO(first)), {ord(c) for c in preview_text}, keep_layout=False))
        if 'fvar' in preview:
            preview = reload(instancer.instantiateVariableFont(preview, {'wght': 400}))
        preview_data = woff2_bytes(preview)
        with open(os.path.join(folder, f'{slug}-name.woff2'), 'wb') as f:
            f.write(preview_data)
        total += len(preview_data)

        with open(fetch(license_url, cache), 'rb') as src_license:
            license_text = src_license.read()
        with open(os.path.join(folder, 'OFL.txt'), 'wb') as f:
            f.write(license_text)

        manifest[key] = {
            'label': label, 'style': style, 'generic': generic,
            'weights': sorted(int(w) for w in weights),
            'variable': kind == 'var',
            'files': files,
            'preview': f'{key}/{slug}-name.woff2',
            'glyphs': glyph_files,
            'ranges': ','.join(f'U+{a:04X}' + (f'-{b:04X}' if b != a else '') for a, b in to_ranges(covered)),
        }
        print(f'  {kind}: ' + ', '.join(f'{w}={len(d) // 1024} KB' for w, d in candidates[kind].items())
              + f', name preview {len(preview_data)} B, {len(covered)} characters')

    # Emoji: Noto Color Emoji in COLRv1 format, as one woff2 file.
    print('emoji Noto Color Emoji')
    folder = os.path.join(OUT, 'emoji')
    os.makedirs(folder, exist_ok=True)
    emoji_path = os.path.join(folder, 'noto-color-emoji.woff2')
    if text_only and os.path.exists(emoji_path):
        with open(emoji_path, 'rb') as f:
            emoji_data = f.read()
    else:
        emoji_data = woff2_bytes(TTFont(fetch(EMOJI[0], cache)))
        with open(emoji_path, 'wb') as f:
            f.write(emoji_data)
    with open(fetch(EMOJI[1], cache), 'rb') as src_license:
        license_text = src_license.read()
    with open(os.path.join(folder, 'OFL.txt'), 'wb') as f:
        f.write(license_text)
    print(f'  {len(emoji_data) // 1024} KB')

    # Write the font list into js/fonts.js.
    with open(FONTS_JS, encoding='utf-8') as f:
        js = f.read()
    block = '  const FONT_LIST = ' + json.dumps(manifest, indent=2, ensure_ascii=False).replace('\n', '\n  ') + ';\n'
    js = re.sub(r'(/\* GENERATED by tools/build-fonts\.py: do not edit by hand\. \*/\n).*?(\n\s*/\* END GENERATED \*/)',
                lambda m: m.group(1) + block.rstrip('\n') + m.group(2), js, flags=re.S)
    with open(FONTS_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)

    print(f'Text fonts and name previews: {total / 1024:.0f} KB. Glyph outlines: {glyph_total[0] / 1024:.0f} KB. '
          f'Emoji: {len(emoji_data) / 1024:.0f} KB.')


if __name__ == '__main__':
    main()
