# Favicon Generator

A favicon generator built with plain HTML, CSS and JavaScript. Make an icon from text, an emoji or your own image, then download every file a website needs. No frameworks, no build step, and your image never leaves your browser.

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
├── index.html   # Page markup
├── style.css    # Styles
├── script.js    # Drawing, ICO and ZIP builders, and UI
└── README.md
```

## Getting started

No installation needed.

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

Add a license of your choice (for example MIT) in a `LICENSE` file.
