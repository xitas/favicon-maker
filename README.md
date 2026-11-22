# Favicon Generator

A favicon generator built with plain HTML, CSS and JavaScript. Make an icon from text, an emoji or your own image, then download every file a website needs. No frameworks, no build step, and your image never leaves your browser.

**Live demo:** [https://xitas.github.io/favicon-maker/](https://xitas.github.io/favicon-maker/)

## Features

- **Two sources:** type up to 3 letters or emoji, or upload an image (PNG, JPG, SVG, WebP)
- **Design controls:** 8 bundled fonts, bold, text size and color, background color, transparent background, corner radius, and optional different colors in dark mode
- **Emoji style:** this device's emoji, or the same emoji everywhere with a bundled emoji font
- **Live preview:** browser tab mockups (light and dark), the icon at 16, 32, 48, 180 and 512 px, and the Android maskable icon cut to the circle, squircle, rounded square and teardrop shapes, with an optional safe zone overlay
- **All the files you need:**
  - `favicon.ico` (16, 32 and 48 px in one file, for older browsers)
  - `favicon.svg` (sharp at every size, and can switch colors in dark mode; made when the design can be a true vector)
  - `favicon-16x16.png` and `favicon-32x32.png`
  - `apple-touch-icon.png` (180 × 180)
  - `android-chrome-192x192.png` and `android-chrome-512x512.png` (Android home screen and installs)
  - `maskable-icon-192x192.png` and `maskable-icon-512x512.png` (Android icons that fill whatever shape the phone uses)
  - `site.webmanifest`
- **Download one file or everything** as a single `favicons.zip`
- **Ready-to-paste HTML** for the `<head>` of your site, with paths for the folder your files go in
- **Your work is kept:** the design is saved in your browser as you work, with undo and redo
- **My designs:** save several designs, then open, rename, duplicate or delete them, and export or import them as `.json` files
- **Share links:** the whole design in a link, with a small image included
- Light and dark theme that follows your system setting

## Project structure

```
.
├── index.html          # Page markup
├── assets/
│   └── fonts/          # Bundled icon fonts (woff2) and their glyph outlines, each with its OFL license
├── css/
│   └── style.css       # Styles
├── js/
│   ├── lib/
│   │   ├── zip.js      # ZIP archive builder (no compression, no library)
│   │   ├── ico.js      # ICO builder that packs PNG images
│   │   ├── shrink.js   # Shrinks images step by step, in premultiplied alpha
│   │   └── svg.js      # favicon.svg: glyph outlines, the SVG document, and cleaning uploaded SVGs
│   ├── fonts.js        # Bundled font list, character coverage and font loading
│   ├── draw.js         # Draws the icon on a canvas from the current settings
│   ├── outputs.js      # Generated files, manifest, HTML snippet, text and path helpers
│   ├── design.js       # Checking settings, format versions, undo history, share links, export files
│   ├── store.js        # Saving in the browser (localStorage and IndexedDB)
│   └── app.js          # Page UI: form, previews, downloads, saving and sharing
├── tests/
│   ├── helpers/        # Loads the scripts in Node, file format readers, browser setup
│   ├── unit/           # node:test unit tests
│   ├── browser/        # Playwright checks of the real page
│   └── fixtures/       # Test-only files
├── tools/
│   └── build-fonts.py  # Rebuilds assets/fonts from the upstream fonts (maintainers only)
├── LICENSE
├── package.json        # Test tools only, the page doesn't use them
└── README.md
```

The scripts are plain (non-module) scripts loaded in order, so the page still works when you open `index.html` straight from disk. Each file exposes one object (`Zip`, `Ico`, `Shrink`, `Svg`, `Fonts`, `Draw`, `Outputs`, `Design`, `Store`) that the files after it use.

The page makes no requests to other sites. The interface uses your system's fonts; the icons use fonts bundled in `assets/fonts/`, so an icon looks the same whichever computer it's made on.

## Getting started

No installation needed. You can use the [live demo](https://xitas.github.io/favicon-maker/) or run it locally.

1. Clone the repository:
   ```bash
   git clone https://github.com/xitas/favicon-maker.git
   cd favicon-maker
   ```
2. Open `index.html` in your browser.

Optionally, serve it locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Running tests

The page itself needs nothing installed. The tests use Node.js 22 or newer and a few development-only packages.

```bash
npm ci                              # install the test tools
npm test                            # unit tests for the ZIP, ICO and output builders
npx playwright install chromium firefox   # once, for the browser checks
npm run test:browser                # opens the page in Chromium and Firefox from file:// and a local server
```

The font checks also run in Chrome and Edge when they are installed, and skip them otherwise.

Known bugs are recorded as todo tests: they show in the results but don't fail the run. GitHub Actions runs both on every push and pull request.

## Using the generated files

1. In **Where will the files go?**, enter the folder on your site that will hold the files. Leave it as `/` for the root of your site. For a GitHub Pages project site, use `/your-repo-name/`. Slashes at either end are optional.
2. Click **Download all (.zip)** and unzip it.
3. Copy the files into that folder.
4. Click **Copy** and paste the HTML into the `<head>` of every page. For the site root it looks like this:

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

The icon paths inside `site.webmanifest` are relative to the manifest, so they work in any folder without changes.

## How it works

- Each size is drawn on its own `<canvas>`, so small sizes are drawn directly at that size instead of being shrunk from a large image. This keeps 16 px icons sharp.
- A large uploaded image is shrunk in steps, halving each time, before the last small step to the icon size. This keeps detail from turning jagged at 16, 32 and 48 px. It works in premultiplied alpha, so transparent edges get no dark fringe. SVG uploads are drawn straight at each size.
- `favicon.ico` is built in the browser from PNG images at 16, 32 and 48 px.
- `favicon.svg` works without any font, because browsers don't load other files for an SVG favicon. Text is turned into outlines from glyph data made from the bundled fonts, placed exactly where the PNGs draw it. An uploaded SVG is used as it is, inside the background, corners and padding, after anything that could run code or load other files has been removed: scripts, event attributes such as `onload`, `<foreignObject>`, outside links and references, animations and style imports.
- There is no `favicon.svg` for emoji or for characters outside the chosen font (they come from your system's fonts), or for PNG, JPG and WebP uploads. The file list says why, and browsers use the PNG files.
- With **Different colors in dark mode**, `favicon.svg` holds both color sets and switches with `prefers-color-scheme`. PNG and ICO files can't switch, so they keep the normal colors.
- In the snippet, the ICO is marked `32x32` and the SVG `sizes="any"`: Chrome, Edge and Firefox then use the SVG. Listing 16 and 32 px on the ICO made Chrome and Edge use the ICO instead. Browsers without SVG favicons skip the SVG link by its `type` and use the ICO and PNGs. Without an SVG, the ICO lists all of its sizes.
- The ZIP file is built in the browser too, with no library.
- `apple-touch-icon.png` is always a full square with a solid background, because iOS adds its own rounded corners and does not support transparency. If you choose a transparent background, it uses white.
- The maskable icons are full squares too, with no rounded corners and no transparency, because Android cuts them to its own shape. Only the middle circle (80% across) is sure to show, so your design is drawn inside it. Use **Maskable padding** to shrink it further. The manifest lists them with `"purpose": "maskable"`, separately from the normal icons, which have `"purpose": "any"`.

## Saving, undo and sharing

- **Autosave:** the design is saved in your browser shortly after each change and comes back when you open the page again. Settings are kept in `localStorage` and uploaded images in IndexedDB. Nothing is sent anywhere. If the browser doesn't allow saving (a private window, for example), the app keeps working and says that designs can't be saved in that window.
- **Undo and redo:** Ctrl+Z (⌘Z on a Mac) undoes and Ctrl+Shift+Z or Ctrl+Y redoes, or use the buttons above the controls. In a text field these keys undo your typing instead, as usual. Dragging a slider counts as one step, and the last 100 steps are kept. **Reset to default** can be undone too.
- **My designs:** save the current design under a name. Opening another design asks first if the current one has changes you haven't saved. A deleted design can be brought back with **Undo** for a few seconds. **Export .json** saves the design, with its image, as a file you can back up or import on another device. **Forget all saved data** removes everything this app saved in your browser.
- **Share links:** **Share link** puts the design in the link itself, after the `#`, so it never reaches a server. The settings are compressed (deflate) and written in base64url after a version prefix (`#d1=`) and a CRC-32 checksum, so a damaged or cut-off link is noticed and changes nothing. An uploaded image is included only if the link stays under 8,000 characters; otherwise the link has the settings only and the page says so. A link made from a page opened from disk points to https://xitas.github.io/favicon-maker/.
- **Safety:** links and imported files are treated as untrusted. Every setting is checked against its allowed values and anything else falls back to the default; SVG images go through the same cleaning as uploads every time; and nothing from a link or file is ever put into the page as HTML.
- **Versions:** saved designs, exported files and links carry a format version, and older versions are upgraded when they are opened, so designs made now keep working as the app gains options.

## Tips

- Use one or two characters. The text box holds up to 3, because more doesn't read at 16 px. An emoji, a flag or an accented letter counts as one.
- Pick high contrast between the text and the background.
- For an image, a simple square logo with a bit of padding works best.

## Fonts

The icon fonts are bundled in `assets/fonts/`, trimmed to Latin and Latin Extended characters and to their kerning (no ligatures or alternate letter forms), so each character is always one outline and `favicon.svg` matches the PNGs. A font is downloaded only when you choose it (345 KB for all eight; 30 to 105 KB each). Its glyph outlines (90 to 390 KB per weight) are loaded only when `favicon.svg` is made. Each folder has the font's license next to it.

| Style | Font | Designer | License |
|---|---|---|---|
| Sans | [Inter](https://github.com/rsms/inter) | Rasmus Andersson | SIL Open Font License 1.1 |
| Rounded | [Nunito](https://github.com/googlefonts/nunito) | Vernon Adams, Cyreal, Jacques Le Bailly | SIL Open Font License 1.1 |
| Serif | [Source Serif 4](https://github.com/adobe-fonts/source-serif) | Frank Grießhammer (Adobe) | SIL Open Font License 1.1 |
| Slab | [Zilla Slab](https://github.com/mozilla/zilla-slab) | Typotheque, for Mozilla | SIL Open Font License 1.1 |
| Mono | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | JetBrains, Philipp Nurullin, Konstantin Bulenkov | SIL Open Font License 1.1 |
| Display | [Anton](https://github.com/googlefonts/AntonFont) | Vernon Adams | SIL Open Font License 1.1 |
| Geometric | [Montserrat](https://github.com/JulietaUla/Montserrat) | Julieta Ulanovsky, Sol Matas, Juan Pablo del Peral, Jacques Le Bailly | SIL Open Font License 1.1 |
| Handwritten | [Caveat](https://github.com/googlefonts/caveat) | Impallari Type | SIL Open Font License 1.1 |
| Emoji | [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) | Google | SIL Open Font License 1.1 |

Characters a font doesn't have, such as Urdu, Arabic, Chinese or Hindi, are drawn with your system's font, and the page tells you they may look different on other computers.

The emoji font (1.9 MB) is downloaded only when you choose **Same everywhere**. It uses the COLRv1 color font format, which Chrome, Edge and Firefox draw on a canvas. A browser that can't draw it falls back to its own emoji and says so.

To rebuild the fonts from their upstream sources: `python -m pip install fonttools brotli`, then `python tools/build-fonts.py`.

## License

This project is free for personal and other non-commercial use. Commercial use needs permission. To ask about commercial use, [open an issue on GitHub](https://github.com/xitas/favicon-maker/issues).

The full terms are in the [LICENSE](LICENSE) file (PolyForm Noncommercial License 1.0.0).