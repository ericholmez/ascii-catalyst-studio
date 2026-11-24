# ASCII-CATALYST

**Text as medium. Data as material.**

ASCII-CATALYST is a browser-local tool for transforming images into character art. Import an image or use a built-in sample, choose a conversion method, and change the result through glyph selection, layout, colour, and tone. Images and projects stay in the browser. The app requires no account or image-processing API.

## Run locally

Use Node.js 22 or later. The app has no npm dependencies.

    npm run dev

Open [ASCII-CATALYST locally](http://127.0.0.1:4173/). The dev server also serves the [portfolio route](http://127.0.0.1:4173/tools/ascii-catalyst/).

    npm test
    npm run bench
    npm run build

Deploy the contents of `dist/` to any static server. Use a trailing slash for subdirectory URLs so relative module, worker, and font URLs resolve correctly. See the [integration guide](docs/integration.md).

## Workspaces

| Workspace | Available in v0.2 |
| --- | --- |
| Create | Original, comparison, adjusted and artwork views. Eight conversion methods, 18 built-in styles, local presets, seeded variations, histogram, and cell inspector. |
| Character Lab | Editable ramps, fonts, glyph coverage, bounding dimensions, axis bias, artwork usage, sorting, and text export. |
| Compositor | Glyph brush, eraser, and typography layers with order, position, rotation, opacity and blending. |
| Text Lab | Repeated text sequences with image-driven glyph opacity. |
| Motion | Local video, browser-dependent animated GIF decoding, procedural loop, playback, stepping, freeze, PNG capture, and supported WebM recording. |
| Archive | IndexedDB named projects, duplication, portable files, and recovery of the most recent autosave. |
| Output | PNG, JPEG, WebP, raster PDF, UTF-8 and strict ASCII text, ANSI, CP437 NFO, Markdown, editable SVG, HTML, JSON and project files. |
| Index | Interactive explanations and a per-cell matching inspector. |

Open **Tonal range**, **Texture**, or **Colour and dithering** for fine adjustments. **Preview adjustments** shows the processed image that feeds the character conversion. Use **Vary style** to try a seeded change to tone, grain and dithering, or **Save preset** to reuse your settings on another image. Press **F** for presentation mode, **Esc** to return, and **Ctrl/Cmd+Z** or **Ctrl/Cmd+Shift+Z** for undo and redo.

## Compatibility and storage

- Image decoding uses browser capabilities. The standard import freezes one frame. SVG import accepts a restricted subset of static drawing elements and strips external references and scripts.
- GIF timing is sampled at the target frame rate. WebM recording depends on MediaRecorder and canvas capture support.
- The grid has a 115,200-cell limit. Exports have canvas size limits. Draft quality caps columns at 84. CPU and font rasterization vary across devices.
- Clear browsing data or private-session expiry can remove saved projects. Download `.acatalyst` files for durable backups.
- Layered typography exports as raster or project data. SVG and HTML export the fixed grid and depend on the viewer’s available fonts. Strict ASCII and CP437 exports reject unrepresentable characters.

See the [engine reference](docs/engine.md), [project format](docs/project-format.md), [research notes](docs/research.md), [roadmap](ROADMAP.md), [contributing guide](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
