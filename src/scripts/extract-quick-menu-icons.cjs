// Regenerates hypercomb-essentials/src/quickmenu/quick-menu.icons.ts.
//
//   node scripts/extract-quick-menu-icons.cjs            # rewrite the module
//   node scripts/extract-quick-menu-icons.cjs --check    # exit 1 when it is stale
//   node scripts/extract-quick-menu-icons.cjs --probe add terminal   # print paths
//
// The quick-menu ring is a DETACHED inline <svg>, so it cannot lean on the icon
// font: a ligature in a detached tree races the font load, and a name missing
// from the shipped subset prints the WORD (project_icon_font_subset_stale_cache).
// The ring wears the very same glyphs as the rest of the UI instead, as path
// data lifted out of the shipped font, so the ring and the flower (which does
// use the font) are one set of drawings.
//
// This reads the SUBSET the web shell ships (public/fonts/material-symbols-all.woff2),
// so a glyph that is not in icons.txt cannot be extracted and the script says so.
// It decodes the WOFF2 container itself (brotli from node:zlib, glyf transform
// per the W3C spec) and reads the default instance of the variable font, which
// is the one this repo asks for: wght 400, FILL 0, GRAD 0, opsz 24. The glyph
// is returned on its own 24 x 24 grid, y down, quadratic curves kept as Q.

'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const REPO = path.resolve(__dirname, '..')
const FONT = path.join(REPO, 'hypercomb-web/public/fonts/material-symbols-all.woff2')
const OUT = path.join(REPO, 'hypercomb-essentials/src/quickmenu/quick-menu.icons.ts')
const GRID = 24

// The glyph names the quick menu wears, in the order the module lists them.
// This is the whole vocabulary of quickmenu slot icons plus the two injected
// cells (back, cancel) and the empty-label stand-in. Add a name here when a
// slot gains a new icon, then re-run the script.
const NAMES = [
  'terminal', 'folder_open', 'sell', 'history', 'account_tree', 'layers',
  'center_focus_strong', 'slideshow', 'palette', 'dashboard', 'view_module', 'web',
  'school', 'play_arrow', 'skip_next', 'stop', 'view_list', 'add', 'save', 'build',
  'hexagon', 'chevron_right', 'chevron_left', 'skip_previous', 'check', 'check_circle',
  'select_all', 'edit', 'category', 'hub', 'search', 'explore', 'share', 'cloud_upload',
  'sync', 'key', 'person_add', 'notifications', 'visibility_off', 'delete', 'bookmark',
  'arrow_back', 'close', 'more_horiz', 'tips_and_updates',
]

// ── woff2 container ────────────────────────────────────────────────────

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca',
  'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL',
  'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
]

function readTables(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file')
  const numTables = buf.readUInt16BE(12)
  const totalCompressed = buf.readUInt32BE(20)
  let at = 48
  const base128 = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[at++]
      value = value * 128 + (b & 0x7f)
      if (!(b & 0x80)) return value
    }
    throw new Error('bad UIntBase128')
  }
  const entries = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at++]
    let tag
    if ((flags & 0x3f) === 0x3f) { tag = buf.toString('latin1', at, at + 4); at += 4 } else tag = KNOWN_TAGS[flags & 0x3f]
    const version = flags >> 6
    const origLength = base128()
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
    const length = transformed ? base128() : origLength
    entries.push({ tag, origLength, length, transformed })
  }
  const data = zlib.brotliDecompressSync(buf.subarray(at, at + totalCompressed))
  const tables = {}
  let cursor = 0
  for (const e of entries) {
    tables[e.tag] = { ...e, data: data.subarray(cursor, cursor + e.length) }
    cursor += e.length
  }
  return tables
}

// ── glyf (transformed) ─────────────────────────────────────────────────

function decodeGlyf(table, numGlyphsHint) {
  if (!table.transformed) throw new Error('untransformed glyf is not supported by this extractor')
  const d = table.data
  const numGlyphs = d.readUInt16BE(4)
  if (numGlyphsHint && numGlyphsHint !== numGlyphs) throw new Error('glyph count mismatch')
  const sizes = []
  for (let i = 0; i < 7; i++) sizes.push(d.readUInt32BE(8 + i * 4))
  let p = 8 + 28
  const slice = (n) => { const s = d.subarray(p, p + n); p += n; return s }
  const nContourStream = slice(sizes[0])
  const nPointsStream = slice(sizes[1])
  const flagStream = slice(sizes[2])
  const glyphStream = slice(sizes[3])
  const compositeStream = slice(sizes[4])
  const bboxStream = slice(sizes[5])
  // sizes[6] = instruction stream, never needed.
  const bitmapBytes = ((numGlyphs + 31) >> 5) << 2
  const bboxBitmap = bboxStream.subarray(0, bitmapBytes)

  let nContourAt = 0, nPointsAt = 0, flagAt = 0, glyphAt = 0, compositeAt = 0, bboxAt = bitmapBytes
  const u255 = (s, at) => {
    const code = s[at.v++]
    if (code === 253) { const v = (s[at.v] << 8) | s[at.v + 1]; at.v += 2; return v }
    if (code === 255) return s[at.v++] + 253
    if (code === 254) return s[at.v++] + 506
    return code
  }
  const pointsAt = { v: 0 }
  const glyphAtRef = { v: 0 }
  const compositeAtRef = { v: 0 }
  void nPointsAt; void glyphAt; void compositeAt

  const glyphs = []
  for (let g = 0; g < numGlyphs; g++) {
    const nContours = nContourStream.readInt16BE(nContourAt); nContourAt += 2
    const hasBox = (bboxBitmap[g >> 3] & (0x80 >> (g & 7))) !== 0
    if (nContours === 0) { glyphs.push({ contours: [] }); continue }
    if (nContours > 0) {
      const counts = []
      let total = 0
      for (let c = 0; c < nContours; c++) { const n = u255(nPointsStream, pointsAt); counts.push(n); total += n }
      const flags = flagStream.subarray(flagAt, flagAt + total); flagAt += total
      const xs = new Array(total), ys = new Array(total), on = new Array(total)
      let x = 0, y = 0
      for (let i = 0; i < total; i++) {
        const f = flags[i]
        on[i] = (f & 0x80) === 0
        const k = f & 0x7f
        const sign = (flag, v) => (flag & 1 ? v : -v)
        const s = glyphStream
        let dx, dy
        if (k < 10) { dx = 0; dy = sign(k, ((k & 14) << 7) + s[glyphAtRef.v]); glyphAtRef.v += 1 }
        else if (k < 20) { dx = sign(k, (((k - 10) & 14) << 7) + s[glyphAtRef.v]); dy = 0; glyphAtRef.v += 1 }
        else if (k < 84) {
          const b0 = k - 20, b1 = s[glyphAtRef.v]
          dx = sign(k, 1 + (b0 & 0x30) + (b1 >> 4)); dy = sign(k >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); glyphAtRef.v += 1
        } else if (k < 120) {
          const b0 = k - 84
          dx = sign(k, 1 + (Math.floor(b0 / 12) << 8) + s[glyphAtRef.v])
          dy = sign(k >> 1, 1 + (((b0 % 12) >> 2) << 8) + s[glyphAtRef.v + 1]); glyphAtRef.v += 2
        } else if (k < 124) {
          const b2 = s[glyphAtRef.v + 1]
          dx = sign(k, (s[glyphAtRef.v] << 4) + (b2 >> 4)); dy = sign(k >> 1, ((b2 & 0x0f) << 8) + s[glyphAtRef.v + 2]); glyphAtRef.v += 3
        } else {
          dx = sign(k, (s[glyphAtRef.v] << 8) + s[glyphAtRef.v + 1]); dy = sign(k >> 1, (s[glyphAtRef.v + 2] << 8) + s[glyphAtRef.v + 3]); glyphAtRef.v += 4
        }
        x += dx; y += dy
        xs[i] = x; ys[i] = y
      }
      u255(glyphStream, glyphAtRef) // instruction length; the bytes live in the instruction stream
      const contours = []
      let i = 0
      for (const n of counts) {
        const pts = []
        for (let j = 0; j < n; j++, i++) pts.push({ x: xs[i], y: ys[i], on: on[i] })
        contours.push(pts)
      }
      if (hasBox) bboxAt += 8
      glyphs.push({ contours })
    } else {
      // Composite: components are placed by an offset (and optionally a scale).
      const parts = []
      let more = true, haveInstructions = false
      while (more) {
        const flags = compositeStream.readUInt16BE(compositeAtRef.v)
        const index = compositeStream.readUInt16BE(compositeAtRef.v + 2)
        compositeAtRef.v += 4
        const words = (flags & 1) !== 0
        let a, b
        if (words) { a = compositeStream.readInt16BE(compositeAtRef.v); b = compositeStream.readInt16BE(compositeAtRef.v + 2); compositeAtRef.v += 4 }
        else { a = compositeStream.readInt8(compositeAtRef.v); b = compositeStream.readInt8(compositeAtRef.v + 1); compositeAtRef.v += 2 }
        let sx = 1, sy = 1
        if (flags & 0x08) { sx = sy = compositeStream.readInt16BE(compositeAtRef.v) / 16384; compositeAtRef.v += 2 }
        else if (flags & 0x40) { sx = compositeStream.readInt16BE(compositeAtRef.v) / 16384; sy = compositeStream.readInt16BE(compositeAtRef.v + 2) / 16384; compositeAtRef.v += 4 }
        else if (flags & 0x80) throw new Error('2x2 composite transform not supported')
        if (!(flags & 2)) throw new Error('point-matched composite not supported')
        parts.push({ index, dx: a, dy: b, sx, sy })
        more = (flags & 0x20) !== 0
        if (flags & 0x100) haveInstructions = true
      }
      if (haveInstructions) u255(glyphStream, glyphAtRef)
      if (hasBox) bboxAt += 8
      glyphs.push({ parts })
    }
  }
  void bboxAt
  // Resolve composites (components always reference earlier or later simple glyphs).
  const resolve = (g, depth = 0) => {
    if (g.contours) return g.contours
    if (depth > 8) throw new Error('composite nesting too deep')
    const out = []
    for (const part of g.parts) {
      for (const contour of resolve(glyphs[part.index], depth + 1)) {
        out.push(contour.map(pt => ({ x: pt.x * part.sx + part.dx, y: pt.y * part.sy + part.dy, on: pt.on })))
      }
    }
    return out
  }
  return glyphs.map(g => resolve(g))
}

// ── cmap + GSUB ligatures ──────────────────────────────────────────────

function readCmap(buf) {
  const map = new Map()
  const n = buf.readUInt16BE(2)
  let chosen = -1
  for (let i = 0; i < n; i++) {
    const platform = buf.readUInt16BE(4 + i * 8), encoding = buf.readUInt16BE(6 + i * 8), offset = buf.readUInt32BE(8 + i * 8)
    const format = buf.readUInt16BE(offset)
    if (format === 12 || (format === 4 && chosen < 0) || (platform === 0 && chosen < 0)) chosen = offset
    void encoding
  }
  if (chosen < 0) throw new Error('no usable cmap')
  const format = buf.readUInt16BE(chosen)
  if (format === 4) {
    const segX2 = buf.readUInt16BE(chosen + 6), seg = segX2 / 2
    const endAt = chosen + 14, startAt = endAt + segX2 + 2, deltaAt = startAt + segX2, rangeAt = deltaAt + segX2
    for (let s = 0; s < seg; s++) {
      const end = buf.readUInt16BE(endAt + s * 2), start = buf.readUInt16BE(startAt + s * 2)
      const delta = buf.readInt16BE(deltaAt + s * 2), range = buf.readUInt16BE(rangeAt + s * 2)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid
        if (range === 0) gid = (c + delta) & 0xffff
        else {
          const at = rangeAt + s * 2 + range + (c - start) * 2
          gid = buf.readUInt16BE(at)
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid) map.set(gid, c)
      }
    }
  } else if (format === 12) {
    const groups = buf.readUInt32BE(chosen + 12)
    for (let g = 0; g < groups; g++) {
      const at = chosen + 16 + g * 12
      const start = buf.readUInt32BE(at), end = buf.readUInt32BE(at + 4), gid = buf.readUInt32BE(at + 8)
      for (let c = start; c <= end; c++) map.set(gid + (c - start), c)
    }
  } else throw new Error(`cmap format ${format} not supported`)
  return map // gid -> code point
}

function readCoverage(buf, at) {
  const format = buf.readUInt16BE(at), count = buf.readUInt16BE(at + 2)
  const glyphs = []
  if (format === 1) for (let i = 0; i < count; i++) glyphs.push(buf.readUInt16BE(at + 4 + i * 2))
  else for (let i = 0; i < count; i++) {
    const start = buf.readUInt16BE(at + 4 + i * 6), end = buf.readUInt16BE(at + 6 + i * 6)
    for (let g = start; g <= end; g++) glyphs.push(g)
  }
  return glyphs
}

function readLigatures(gsub, charOf) {
  const lookupList = gsub.readUInt16BE(8)
  const count = gsub.readUInt16BE(lookupList)
  const out = new Map() // spelled name -> ligature glyph id (aliases share a glyph)
  for (let l = 0; l < count; l++) {
    const lookup = lookupList + gsub.readUInt16BE(lookupList + 2 + l * 2)
    let type = gsub.readUInt16BE(lookup)
    const subCount = gsub.readUInt16BE(lookup + 4)
    for (let s = 0; s < subCount; s++) {
      let sub = lookup + gsub.readUInt16BE(lookup + 6 + s * 2)
      type = gsub.readUInt16BE(lookup)
      if (type === 7) { // extension
        type = gsub.readUInt16BE(sub + 2)
        sub += gsub.readUInt32BE(sub + 4)
      }
      if (type !== 4) continue
      const coverage = readCoverage(gsub, sub + gsub.readUInt16BE(sub + 2))
      const sets = gsub.readUInt16BE(sub + 4)
      for (let k = 0; k < sets; k++) {
        const set = sub + gsub.readUInt16BE(sub + 6 + k * 2)
        const n = gsub.readUInt16BE(set)
        for (let m = 0; m < n; m++) {
          const lig = set + gsub.readUInt16BE(set + 2 + m * 2)
          const glyph = gsub.readUInt16BE(lig), comps = gsub.readUInt16BE(lig + 2)
          const chain = [coverage[k]]
          for (let c = 0; c < comps - 1; c++) chain.push(gsub.readUInt16BE(lig + 4 + c * 2))
          const spelled = chain.map(g => String.fromCodePoint(charOf.get(g) ?? 63)).join('')
          out.set(spelled, glyph)
        }
      }
    }
  }
  return out
}

// ── outline to path ────────────────────────────────────────────────────

const round = (n) => {
  const v = Math.round(n * 100) / 100
  return Object.is(v, -0) ? 0 : v
}

function contourToPath(points, unit, offsetY) {
  const X = (p) => p.x / unit
  const Y = (p) => (offsetY - p.y) / unit
  const n = points.length
  if (n < 2) return ''
  // Start at an on-curve point, or the midpoint of two off-curve neighbours.
  let first = points.findIndex(p => p.on)
  let start
  let order
  if (first >= 0) {
    start = { x: X(points[first]), y: Y(points[first]) }
    order = [...points.slice(first + 1), ...points.slice(0, first)]
  } else {
    const a = points[0], b = points[n - 1]
    start = { x: (X(a) + X(b)) / 2, y: (Y(a) + Y(b)) / 2 }
    order = [...points]
  }
  let d = `M${round(start.x)} ${round(start.y)}`
  let current = start
  let pending = null
  const same = (a, b) => round(a.x) === round(b.x) && round(a.y) === round(b.y)
  const flush = (target) => {
    // A segment that goes nowhere (an off-curve point sitting on its neighbours) is dropped.
    if (same(target, current) && (!pending || same(pending, current))) { pending = null; return }
    if (pending) { d += `Q${round(pending.x)} ${round(pending.y)} ${round(target.x)} ${round(target.y)}`; pending = null }
    else d += `L${round(target.x)} ${round(target.y)}`
    current = target
  }
  for (const p of order) {
    const q = { x: X(p), y: Y(p) }
    if (p.on) flush(q)
    else {
      if (pending) flush({ x: (pending.x + q.x) / 2, y: (pending.y + q.y) / 2 })
      pending = q
    }
  }
  if (pending) d += `Q${round(pending.x)} ${round(pending.y)} ${round(start.x)} ${round(start.y)}`
  void current
  return d + 'Z'
}

function area(points) {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function extract(names) {
  const tables = readTables(fs.readFileSync(FONT))
  const head = tables.head.data
  const unitsPerEm = head.readUInt16BE(18)
  const glyphs = decodeGlyf(tables.glyf)
  const charOf = readCmap(tables.cmap.data)
  const ligatures = readLigatures(tables.GSUB.data, charOf)
  const byName = new Map()
  for (const [spelled, gid] of ligatures) byName.set(spelled, gid)
  const fvar = tables.fvar?.data
  const axes = []
  if (fvar) {
    const off = fvar.readUInt16BE(4), count = fvar.readUInt16BE(8), size = fvar.readUInt16BE(10)
    for (let i = 0; i < count; i++) {
      const at = off + i * size
      axes.push({ tag: fvar.toString('latin1', at, at + 4), min: fvar.readInt32BE(at + 4) / 65536, def: fvar.readInt32BE(at + 8) / 65536, max: fvar.readInt32BE(at + 12) / 65536 })
    }
  }
  // The em box is 1 em tall; Material draws on a square of unitsPerEm units whose
  // baseline is y = 0 (the published SVGs use viewBox "0 -960 960 960", em 960).
  const unit = unitsPerEm / GRID
  const result = {}
  const missing = []
  for (const name of names) {
    const gid = byName.get(name)
    if (gid === undefined) { missing.push(name); continue }
    // A contour with no area is a variable-font stub (it opens up at FILL 1); drop it.
    result[name] = glyphs[gid].filter(c => Math.abs(area(c)) > unit * unit).map(c => contourToPath(c, unit, unitsPerEm)).join('')
  }
  return { result, missing, unitsPerEm, axes }
}

// ── module writer ──────────────────────────────────────────────────────

function render(result, names) {
  const lines = names.map(name => `  ${JSON.stringify(name)}: ${JSON.stringify(result[name])},`)
  return `// quickmenu/quick-menu.icons.ts
//
// GENERATED by scripts/extract-quick-menu-icons.cjs — do not hand-edit; add a
// name to that script's NAMES and run it again.
//
// The quick-menu ring is a detached inline <svg>, so it wears its icons as
// path data instead of a font ligature: no font race on first summon, no
// "word where an icon should be" when the subset lacks a name, no shipped-font
// regeneration. The drawings are the same Material Symbols Outlined glyphs the
// rest of the UI uses (weight 400, FILL 0, GRAD 0, optical size 24), lifted from
// the subset the web shell ships (Apache 2.0, licensed with the font). Every
// path lives on its own ${GRID} x ${GRID} grid, y down.

/** The grid every path below is drawn on. */
export const ICON_GRID = ${GRID}

/** Material Symbols glyph name to path data on the ${GRID} grid. */
export const ICON_PATHS: Readonly<Record<string, string>> = {
${lines.join('\n')}
}

/** Path data for a glyph name, or undefined when the ring has no drawing for it. */
export function iconPath(name: string | undefined): string | undefined {
  if (!name) return undefined
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name) ? ICON_PATHS[name] : undefined
}
`
}

function main() {
  const args = process.argv.slice(2)
  const probe = args.indexOf('--probe')
  if (probe >= 0) {
    const wanted = args.slice(probe + 1)
    const { result, missing, unitsPerEm, axes } = extract(wanted)
    console.log(JSON.stringify({ unitsPerEm, axes }))
    for (const n of wanted) console.log(n, result[n] ?? '(missing)')
    if (missing.length) process.exitCode = 1
    return
  }
  const { result, missing } = extract(NAMES)
  if (missing.length) {
    console.error(`not in the shipped subset: ${missing.join(', ')} — add them to scripts/icon-names.extra.txt and re-run fetch-fonts first`)
    process.exit(1)
  }
  const next = render(result, NAMES)
  if (args.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (current.replace(/\r\n/g, '\n') !== next) { console.error('quick-menu.icons.ts is stale — run scripts/extract-quick-menu-icons.cjs'); process.exit(1) }
    console.log('ok       quick-menu.icons.ts is current')
    return
  }
  fs.writeFileSync(OUT, next)
  console.log(`wrote ${path.relative(REPO, OUT)} (${NAMES.length} glyphs)`)
}

main()
