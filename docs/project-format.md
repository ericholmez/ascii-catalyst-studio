# Version 1 project files

An `.acatalyst` file is UTF-8 JSON. The root `format` is `"ASCII-CATALYST"` and `version` is `1`.

| Field | Meaning |
| --- | --- |
| `name` | Display name. |
| `settings` | Conversion, preprocessing, type, colour, seed and quality fields. See `src/engine/settings.js`. |
| `layers` | Typography layers in render order with `name`, `text`, `visible`, `opacity`, `x`, `y`, `rotation`, `size`, `color`, and `blend`. Offsets and sizes are logical pixels. |
| `edits` | Zero-based row-major cell indices mapped to a single glyph. A space erases the generated glyph. |
| `editGrid` | Layout the edits belong to, stored as `columnsxrows`. |
| `exportOptions` | Format, pixel margin, text trimming, and source embedding preference. |
| `source` | A built-in `sample` reference, an object with `name` and an embedded base64 image `data` URL, or `null`. IndexedDB stores a Blob instead of the URL. |

An omitted source leaves the workspace empty with its settings loaded. Browser fonts and media decoders can affect regenerated artwork. Image and character-data exports preserve the rendered artwork or grid directly.

When set, perspective is eight normalized coordinates in top-left, top-right, bottom-right, bottom-left order. Crop coordinates refer to the corrected image. Projects saved before v0.4 default to an uncorrected source with the new filters off.

The settings object stores the custom palette as an ordered array of 1–16 HEX RGB values. A colour mode of `"palette"` applies those swatches to the artwork. Older projects receive the default swatches while retaining their existing colour mode.

`colorDither`, `colorDitherStrength`, and `colorDitherSeed` store the independent ink pass. Projects saved before v0.7 default to colour dithering off. The `dither` and `intensity` settings continue to control glyph density.

Painted masks use the optional top-level fields `maskStrokes` and `paintMaskEnabled`. Each stroke stores `mode` (`hide` or `restore`), `size` as a percentage of the shorter source edge, `hardness` from 0 to 100, and `points` as a flat array of normalized x/y pairs in original source coordinates. The project format limits masks to 160 strokes with up to 1024 points each. A missing `paintMaskEnabled` means enabled, and a missing `maskStrokes` means empty.
