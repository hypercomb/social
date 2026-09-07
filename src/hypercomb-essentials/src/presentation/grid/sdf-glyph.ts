// presentation/grid/sdf-glyph.ts
// Runtime CPU signed-distance-field generator for tile labels.
//
// Rasterize a glyph on a canvas → exact Euclidean distance transform
// (Felzenszwalb/Huttenlocher — the Mapbox tiny-sdf core) → an 8-bit field where
// 0.5 == the glyph edge, >0.5 inside, <0.5 outside, saturating to 0 far
// outside. The field is written into R=G=B with A=255 (OPAQUE) so the atlas
// blit's premultiplied-alpha is a no-op (rgb × a/255 = rgb) and the exact
// distance bytes survive. The shader reads channel .r and reconstructs a
// razor-sharp edge at ANY magnification — true vector-style text.
//
// The raster is PLAIN WHITE FILL ONLY. No shadow, no stroke, no dilation —
// tile-label text must never carry an edge effect (hard user rule).
//
// Works for ANY glyph fillText can draw — CJK, emoji silhouettes, ligatures —
// no font outlines, no prebuilt atlas, so it stays compatible with dynamic,
// multilingual tile names.

// Supersample factor for the raster before the EDT. At SS 2 the working raster
// (256) equalled the output cell (256), so the field was transformed straight
// off an 18×2 = 36px rasterisation with NO box-downsample — and a distance
// field is only ever as good as the raster it is measured from. At that size a
// Light-weight stem is ~2px wide, so the EDT's edge wandered by a fraction of a
// texel row to row and the glyph read GRAINY under the ~2× magnification the
// label is displayed at. SS 4 measures the field off a 72px rasterisation and
// box-downsamples 2×2 back into the SAME 256 cell (step = W / cellDevice = 2
// below): identical GPU memory, atlas, UVs and shader — only the field gets
// more accurate.
//
// SS 4 IS LOAD-BEARING, NOT A LUXURY (2026-09-06). It was held at 2 for a week
// to save EDT time and the labels came back BROKEN on Windows: a Light stem at
// 36px is ~1.5px wide, DirectWrite's greyscale AA leaves it with almost no
// pixel above 50% coverage (81 of 1347 ink pixels for "the-waggle-dance"), so
// the "inside" seeds are a sparse chain of dots and the field along every stem
// oscillates about the 0.5 edge. Decoded at rest size that reads as glyphs
// made of fragments — Jaime: "a glitch in the font". At 72px the same stem is
// ~3px and always carries an interior (1257 seeds) — continuous strokes.
//
// The cost objection is answered below, not by lowering SS: the EDT runs only
// over the INK's bounding box (plus the SDF spread), never the full raster. A
// one-line label inks ~80 rows of a 512-row raster, so the transform touches
// roughly a fifth of the cells a full-frame SS 2 pass did. Nothing persists
// these cells yet (every reload re-bakes); when a derived pool arrives the
// cost is paid once and none of this matters.
const SS = 4
const INF = 1e20

// The atlas only ever constructs 128px cells (see HexLabelAtlas). MAXW bounds
// the working raster and all reusable scratch buffers accordingly.
const CELL_LOGICAL = 128
const MAXW = CELL_LOGICAL * SS // 512 working raster edge

// Module-level scratch — reused across every call so buildSdfCell allocates
// nothing on the (warmup/cache-miss) bake path.
const _gridOuter = new Float64Array(MAXW * MAXW)
const _gridInner = new Float64Array(MAXW * MAXW)
const _f = new Float64Array(MAXW)
const _d = new Float64Array(MAXW)
const _v = new Int16Array(MAXW)
const _z = new Float64Array(MAXW + 1)
let _cv: HTMLCanvasElement | null = null
let _ctx: CanvasRenderingContext2D | null = null

export interface SdfCellOpts {
  cellDevice?: number // output cell size in device px (RT resolution 2 → 256)
  baseFontPx?: number // MUST stay 18 — LABEL_BAND (2.0) in hex-sdf.shader.ts assumes it
  letterSpacingPx?: number
  radiusLogical?: number // SDF spread, ±px in cell-logical units
  fontFamily?: string
  rotate?: number // pre-baked rotation in radians (pivot mode → Math.PI/2)
}

/**
 * Build one atlas cell's SDF as an ImageData (cellDevice × cellDevice, RGBA,
 * field in R=G=B, A=255). 0.5 = glyph edge, high = inside, 0 = far outside.
 */
export function buildSdfCell(text: string, opts: SdfCellOpts = {}): ImageData {
  const cellDevice = opts.cellDevice ?? 256
  const baseFontPx = opts.baseFontPx ?? 18
  const letterSpacingPx = opts.letterSpacingPx ?? 1.0
  const radiusLogical = opts.radiusLogical ?? 8
  const rotate = opts.rotate ?? 0
  const fontFamily =
    opts.fontFamily ||
    getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim() ||
    "'Source Sans Pro Light', system-ui, sans-serif"

  const W = CELL_LOGICAL * SS // 512
  const H = W
  const radius = radiusLogical * SS

  // ── 1. Rasterize glyph coverage (plain white on transparent) ─────────
  if (!_cv || _cv.width !== W || _cv.height !== H) {
    _cv = document.createElement('canvas')
    _cv.width = W
    _cv.height = H
    _ctx = _cv.getContext('2d', { willReadFrequently: true })
  }
  const ctx = _ctx
  if (!ctx) return new ImageData(cellDevice, cellDevice) // no 2D context → empty cell

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${baseFontPx * SS}px ${fontFamily}`
  // letterSpacing is a 2D-context property in current engines; guard older ones.
  try {
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${letterSpacingPx * SS}px`
  } catch {
    /* older engine — spacing simply omitted */
  }

  // Fit-to-cell: over-long labels shrink UNIFORMLY so they never overflow the
  // cell into a neighbour slot (mirrors the old bitmap bake's 0.92 guard).
  const maxInkW = CELL_LOGICAL * 0.92 * SS
  const advance = ctx.measureText(text).width
  if (advance > maxInkW && advance > 0) {
    const shrunk = Math.max(1, Math.floor(baseFontPx * SS * (maxInkW / advance)))
    ctx.font = `${shrunk}px ${fontFamily}`
  }

  ctx.save()
  if (rotate) {
    ctx.translate(W / 2, H / 2)
    ctx.rotate(rotate)
    ctx.translate(-W / 2, -H / 2)
  }
  ctx.fillText(text, W / 2, H / 2)
  ctx.restore()

  const img = ctx.getImageData(0, 0, W, H).data

  // ── 2. Find the ink's bounding box, padded by the SDF spread ─────────
  // Everything farther than `radius` from any ink saturates to 0 in the field
  // anyway, so the distance transform only has to run over the ink box grown
  // by `radius`. That is what makes SS 4 affordable: a one-line label inks a
  // narrow band of the raster, and the EDT is O(area) of the band, not of the
  // frame. The stride of the compact grids is the box width, not W.
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      if (img[(row + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const out = new Uint8ClampedArray(cellDevice * cellDevice * 4)
  if (maxX < 0) {
    // No ink at all (empty or unprintable text): a far-outside field, opaque.
    for (let px = 3; px < out.length; px += 4) out[px] = 255
    return new ImageData(out, cellDevice, cellDevice)
  }
  const pad = Math.ceil(radius) + 1
  const bx0 = Math.max(0, minX - pad)
  const by0 = Math.max(0, minY - pad)
  const bx1 = Math.min(W, maxX + pad + 1) // exclusive
  const by1 = Math.min(H, maxY + pad + 1) // exclusive
  const bw = bx1 - bx0
  const bh = by1 - by0

  // ── 3. Seed inside/outside squared-distance grids (sub-pixel aware) ──
  const gridOuter = _gridOuter
  const gridInner = _gridInner
  for (let y = 0; y < bh; y++) {
    const srcRow = (by0 + y) * W + bx0
    const dstRow = y * bw
    for (let x = 0; x < bw; x++) {
      const av = img[(srcRow + x) * 4 + 3] / 255 // coverage 0..1 (glyph is white)
      const i = dstRow + x
      if (av >= 1.0) {
        gridOuter[i] = 0
        gridInner[i] = INF
      } else if (av <= 0.0) {
        gridOuter[i] = INF
        gridInner[i] = 0
      } else {
        const dd = 0.5 - av // >0 mostly outside, <0 mostly inside
        gridOuter[i] = dd > 0 ? dd * dd : 0
        gridInner[i] = dd < 0 ? dd * dd : 0
      }
    }
  }

  edt(gridOuter, bw, bh)
  edt(gridInner, bw, bh)

  // ── 4. Signed distance → 0..1, box-downsample to the device cell ─────
  // Raster cells outside the box are farther than `radius` from all ink by
  // construction, so they take the saturated far-outside value directly.
  const step = W / cellDevice
  for (let oy = 0; oy < cellDevice; oy++) {
    const sy0 = Math.floor(oy * step)
    const sy1 = Math.min(H, Math.ceil((oy + 1) * step))
    for (let ox = 0; ox < cellDevice; ox++) {
      const sx0 = Math.floor(ox * step)
      const sx1 = Math.min(W, Math.ceil((ox + 1) * step))
      let acc = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        const inRow = sy >= by0 && sy < by1
        const row = (sy - by0) * bw - bx0
        for (let sx = sx0; sx < sx1; sx++) {
          if (inRow && sx >= bx0 && sx < bx1) {
            const i = row + sx
            acc += Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]) // +outside, −inside
          } else {
            acc += radius
          }
          n++
        }
      }
      const signedPx = n > 0 ? acc / n : radius
      // 0.5 = edge; +radius (far outside) → 0; −radius (far inside) → 1
      let val = 0.5 - signedPx / (radius * 2)
      val = val < 0 ? 0 : val > 1 ? 1 : val
      const byte = Math.round(val * 255)
      const px = (oy * cellDevice + ox) * 4
      out[px] = byte
      out[px + 1] = byte
      out[px + 2] = byte
      out[px + 3] = 255 // OPAQUE → premultiply is a no-op, distance bytes survive
    }
  }
  return new ImageData(out, cellDevice, cellDevice)
}

// Felzenszwalb squared-Euclidean distance transform: rows then columns, in
// place, using the shared scratch arrays.
function edt(grid: Float64Array, width: number, height: number): void {
  const f = _f
  const d = _d
  const v = _v
  const z = _z
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    edt1d(f, d, v, z, height)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) f[x] = grid[row + x]
    edt1d(f, d, v, z, width)
    for (let x = 0; x < width; x++) grid[row + x] = d[x]
  }
}

// 1-D squared distance transform of the row/column in f[], result into d[].
function edt1d(f: Float64Array, d: Float64Array, v: Int16Array, z: Float64Array, n: number): void {
  v[0] = 0
  z[0] = -INF
  z[1] = +INF
  let k = 0
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = +INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    d[q] = dx * dx + f[v[k]]
  }
}
