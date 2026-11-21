# Favicon Generator

A favicon generator built with plain HTML, CSS and JavaScript. Make an icon from text, an emoji or your own image, then download every file a website needs. No frameworks, no build step, and your image never leaves your browser.

**Live demo:** [https://xitas.github.io/favicon-maker/](https://xitas.github.io/favicon-maker/)

## Features

- **Two sources:** type a letter, word or emoji, or upload an image (PNG, JPG, SVG, WebP)
- **Design controls:** font, bold, text size and color, background color, transparent background and corner radius
- **Live preview:** browser tab mockups (light and dark) and the icon at 16, 32, 48, 180 and 512 px
- **All the files you need:**
  - `favicon.ico` (16, 32 and 48 px in one file)
  - `favicon-16x16.png` and `favicon-32x32.png`
  - `apple-touch-icon.png` (180 × 180)
  - `android-chrome-192x192.png` and `android-chrome-512x512.png`
  - `site.webmanifest`
- **Download one file or everything** as a single `favicons.zip`
- **Ready-to-paste HTML** for the `<head>` of your site
- Light and dark theme that follows your system setting

## Project structure

```
.
├── index.html          # Page markup
├── css/
│   └── style.css       # Styles
├── js/
│   ├── lib/
│   │   ├── zip.js      # ZIP archive builder (no compression, no library)
│   │   └── ico.js      # ICO builder that packs PNG images
│   ├── draw.js         # Draws the icon on a canvas from the current settings
│   ├── outputs.js      # List of generated files, manifest and HTML snippet
│   └── app.js          # Page UI: form, previews, downloads
├── tests/
│   ├── helpers/        # Loads the scripts in Node, file format readers, browser setup
│   ├── unit/           # node:test unit tests
│   └── browser/        # Playwright checks of the real page
├── LICENSE
├── package.json        # Test tools only, the page doesn't use them
└── README.md
```

The scripts are plain (non-module) scripts loaded in order, so the page still works when you open `index.html` straight from disk. Each file exposes one object (`Zip`, `Ico`, `Draw`, `Outputs`) that the files after it use.

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
npx playwright install chromium     # once, for the browser checks
npm run test:browser                # opens the page in Chromium from file:// and a local server
```

Known bugs are recorded as todo tests: they show in the results but don't fail the run. GitHub Actions runs both on every push and pull request.

## Using the generated files

1. Click **Download all (.zip)** and unzip it.
2. Copy the files into the root folder of your website.
3. Paste this into the `<head>` of every page:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

If your site lives in a subfolder (for example GitHub Pages at `/<your-repo>/`), remove the leading `/` from each path, and from the two `src` paths in `site.webmanifest`.

## How it works

- Each size is drawn on its own `<canvas>`, so small sizes are drawn directly at that size instead of being shrunk from a large image. This keeps 16 px icons sharp.
- `favicon.ico` is built in the browser from PNG images at 16, 32 and 48 px.
- The ZIP file is built in the browser too, with no library.
- `apple-touch-icon.png` is always a full square with a solid background, because iOS adds its own rounded corners and does not support transparency. If you choose a transparent background, it uses white.

## Tips

- Use one or two characters. Longer text becomes hard to read at 16 px.
- Pick high contrast between the text and the background.
- For an image, a simple square logo with a bit of padding works best.

## License

This project is free for personal and other non-commercial use. Commercial use needs permission. To ask about commercial use, [open an issue on GitHub](https://github.com/xitas/favicon-maker/issues).

The full terms are in the [LICENSE](LICENSE) file (PolyForm Noncommercial License 1.0.0).