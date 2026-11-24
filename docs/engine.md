# Conversion engine

The engine has no dependency on the editor. In a browser, import the JavaScript modules and wait for any custom web fonts before measuring glyphs.

    import { DEFAULTS } from './src/engine/settings.js';
    import { decodeImage, sampleSource } from './src/engine/image.js';
    import { fontMetrics, glyphAtlas } from './src/engine/glyphs.js';
    import { gridSize } from './src/engine/math.js';
    import { convert } from './src/engine/convert.js';
    import { artworkText } from './src/engine/export.js';

    const settings = { ...DEFAULTS, mode: 'density', columns: 80, font: 'system' };
    const source = await decodeImage(localImageFile);
    const metrics = fontMetrics(settings);
    const { cols, rows } = gridSize(source.canvas.width, source.canvas.height,
      metrics.cellWidth, metrics.cellHeight, settings);
    const samples = sampleSource(source.canvas, cols, rows, settings);
    const art = convert(samples, cols, rows, glyphAtlas(settings, metrics), settings);
    console.log(artworkText(art));

`convert` runs in a worker or Node with a precomputed glyph atlas and an RGBA typed array. The sample array contains `cols × 4` by `rows × 8` pixels in row-major order.

## Grid and pipeline

Image decoding precedes optional perspective correction, cropping, flips, rotation and rescaling. The four source corners define a projective mapping from the corrected rectangle to the original image. The bounding size follows the mean length of opposing edges and bilinear resampling is alpha-aware. Correction is cached and capped at 1600 pixels on the longest edge, or 768 in Draft. Crop percentages apply to the upright, corrected source. Compare uses the same geometry as conversion. The editor caches samples by geometry and raster measurements by font metrics and ramp. Foreground, background and viewport changes redraw independently of conversion.

Preprocessing adjusts colour balance and saturation, then applies exposure, brightness, contrast around a pivot, levels and gamma. Shadows and highlights use squared weights toward their respective ends of the range. Midtones use a bell-shaped weight centred at 50%. Soften and Detail Boost use an alpha-weighted 7×7 luminance average, computed in linear time with two box passes. Seeded grain, posterization and black-and-white thresholding are applied before measuring luminance and ink polarity. Transparent samples contribute no ink. The adjusted image preview shows this processing before glyph and ink selection.

The tone curve is a piecewise-linear mapping with knots at 0%, 25%, 50%, 75% and 100% of display luminance. A 256-entry lookup table applies the same luminance offset to each RGB channel before neighbourhood filters and quantization. Masks multiply the source alpha before glyph selection. Luminance masks use adjusted luminance before hard thresholding. The colour key uses normalized RGB distance from the ungraded source. Feathering uses a smooth transition and preserves partial source opacity.

Median Cleanup mixes in the 3×3 luminance median of visible neighbours. Pixel Block Size averages RGB in alpha-weighted blocks with sides measured in conversion samples. Both filters preserve per-pixel alpha and run before the soften and detail passes.

Painted masks store strokes in normalized coordinates on the original source. The editor rasterizes them at up to 1024 pixels on the long edge, then samples the coverage through the same perspective, crop, flip and rotation as conversion. Painted coverage multiplies source alpha and the automatic mask. Restoring coverage affects the painted mask. The editor caches sampled coverage independently of tonal adjustments.

Duotone interpolates two user-chosen ink colours using each cell’s adjusted luminance. Half blocks use independent colours for their upper and lower samples.

Palette extraction samples the prepared frame at up to 100 cells on its longer axis, with tone, filters, and both kinds of mask applied. A 5-bit-per-channel histogram ignores transparent samples and weights the remaining colours by alpha. Weighted median-cut splits the histogram into up to 16 groups, uses their weighted mean RGB values as swatches, and sorts them by display luminance. Custom palette conversion assigns each cell to the nearest swatch by weighted squared RGB distance. Half blocks apply the same mapping to each half. Glyph selection still uses the source luminance.

`art.cells` is a row-major `Uint16Array` of indices into `art.glyphs`. RGBA arrays hold foreground and optional per-cell background. `opacity` controls glyph alpha. `influence` records the selected method and `usage` counts glyph IDs. The worker transfers array buffers, and the editor terminates outdated workers. Browsers that block workers use a synchronous fallback.

An atlas entry stores ink coverage, bounding box, center of mass, a 4×8 opacity mask, and a doubled-angle orientation vector derived from the gradient tensor. Width measurement rejects many incompatible glyphs. Canvas cannot reliably distinguish all missing glyphs from replacements.

## Algorithms

Let **N** be the number of cells, **G** the number of candidates, and **P** the samples per cell, currently 32.

| Method | Selection | Cost and limits |
| --- | --- | --- |
| Classic tonal | Samples a tone and chooses the nearest index in an ordered ramp. | `O(NP)` with mean sampling. Output depends on ramp order. |
| Font-aware density | Selects the nearest rasterized coverage from a sorted atlas. | `O(N(P + log G))` after sorting. Coverage is limited to the glyph set. |
| Edge-aware | Sobel, Prewitt or Scharr gradients feed a structure tensor. Candidate scores combine coverage and orientation. | `O(N(P + G))`. Junctions can cancel within a cell. |
| Shape matching | Weighs tone, direction and soft intersection-over-union errors. Final quality checks four small shifts. | `O(NGP)`. The solution is local and can vary across adjacent cells. |
| Hybrid | Routes strong, locally contrasted edges to shape matching and smoother cells to font-aware density. | Worst case `O(NGP)`. Low-contrast edges can remain in the tonal branch. |
| Braille | Thresholds a 2×4 subgrid and encodes the eight Unicode bits. | `O(NP)`. Dot appearance depends on the available font. |
| Half blocks | Thresholds upper and lower patches or encodes their colors separately. | `O(NP)`. Vertical half-cell division. |
| Fixed text | Repeats a row-order sequence and modulates opacity by tone. | `O(NP)`. Wide fallback glyphs may overlap. Text exports lose opacity variation. |

Dithering uses a Bayer matrix, seeded noise, or serpentine Floyd–Steinberg and Atkinson kernels. Error diffusion measures the selected glyph’s normalized density or on-dot fraction. Character dropout is seeded and changes the exported cells.

The cell inspector displays the selected patch, route, tone and lowest candidate errors where that method scores glyphs.
