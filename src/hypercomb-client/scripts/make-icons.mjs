// hypercomb-client/scripts/make-icons.mjs
//
// Produce the platform icon set from `app/icons/icon.ico`.
//
// WHY THIS EXISTS RATHER THAN `cargo tauri icon`:
//
//   The only master art in the tree is the .ico, and it is not a container of
//   one image — it holds SIX frames (16, 32, 48, 64, 128, 256), each stored at
//   its native size as uncompressed 32-bit BGRA. Every size macOS wants up to
//   256 is therefore already present, drawn at that size. Resampling one
//   master down would throw that away and hand back something softer than
//   what we started with.
//
//   So this script RESAMPLES NOTHING. It transcodes each frame to PNG and
//   assembles them into an .icns. The only cost is the ceiling: 256 is the
//   largest frame, so the 512/1024 Retina slots are left empty and macOS
//   upscales for the handful of surfaces that need them (Finder's largest
//   icon preview, Quick Look). Supply a 1024x1024 master and the ceiling
//   lifts — nothing else here changes.
//
//   Run after changing the art:  node hypercomb-client/scripts/make-icons.mjs

import { deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const icons = join(here, '../app/icons')

// ---------------------------------------------------------------------------
// ICO -> raw RGBA
// ---------------------------------------------------------------------------

/** Decode every frame of an .ico into `{ size, rgba }`, top-row-first. */
function readIco(bytes) {
  const count = bytes.readUInt16LE(4)
  const frames = []

  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    const size = bytes[entry] === 0 ? 256 : bytes[entry]
    const offset = bytes.readUInt32LE(entry + 12)

    // Each frame is a BITMAPINFOHEADER followed by pixel data. The header's
    // height counts the colour rows AND the AND-mask rows, hence the halving.
    const headerSize = bytes.readUInt32LE(offset)
    const width = bytes.readInt32LE(offset + 4)
    const height = bytes.readInt32LE(offset + 8) / 2
    const depth = bytes.readUInt16LE(offset + 14)

    if (depth !== 32) throw new Error(`frame ${size}: expected 32bpp, got ${depth}`)
    if (width !== size || height !== size) {
      throw new Error(`frame ${size}: header says ${width}x${height}`)
    }

    // DIB rows run BOTTOM-UP and pixels are BGRA; PNG wants top-down RGBA.
    const pixels = offset + headerSize
    const rgba = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      const from = pixels + (size - 1 - y) * size * 4
      for (let x = 0; x < size; x++) {
        const s = from + x * 4
        const d = (y * size + x) * 4
        rgba[d] = bytes[s + 2]
        rgba[d + 1] = bytes[s + 1]
        rgba[d + 2] = bytes[s]
        rgba[d + 3] = bytes[s + 3]
      }
    }

    frames.push({ size, rgba })
  }

  return frames
}

// ---------------------------------------------------------------------------
// raw RGBA -> PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Encode top-down RGBA as a PNG. Filter 0 on every scanline — the art is
 *  small and flat, so deflate does the work and the encoder stays trivial. */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  // 10..12 = compression, filter, interlace — all 0

  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// PNGs -> ICNS
// ---------------------------------------------------------------------------

// macOS 10.7+ reads PNG payloads from these slots. A size can legitimately
// appear twice: 32 is both "32" and "16@2x", 256 is both "256" and "128@2x",
// and Finder picks by slot, not by pixels — so both are written.
const ICNS_SLOTS = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32], // 16@2x
  ['icp6', 64],
  ['ic12', 64], // 32@2x
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256], // 128@2x
]

function buildIcns(pngBySize) {
  const entries = []
  for (const [type, size] of ICNS_SLOTS) {
    const png = pngBySize.get(size)
    if (!png) continue
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    entries.push(header, png)
  }

  const body = Buffer.concat(entries)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ---------------------------------------------------------------------------

const frames = readIco(readFileSync(join(icons, 'icon.ico')))
const pngBySize = new Map(frames.map(f => [f.size, encodePng(f.size, f.rgba)]))
console.log(`[icons] read ${frames.length} native frames: ${frames.map(f => f.size).join(', ')}`)

// The PNG names Tauri's bundler expects, plus a master for `cargo tauri icon`
// to regenerate from later if a bigger source ever lands.
const PNG_OUTPUTS = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 256],
]

for (const [name, size] of PNG_OUTPUTS) {
  const png = pngBySize.get(size)
  if (!png) throw new Error(`${name}: no ${size}x${size} frame in the .ico`)
  writeFileSync(join(icons, name), png)
  console.log(`[icons] ${name} (${size}x${size}, ${png.length} bytes)`)
}

const icns = buildIcns(pngBySize)
writeFileSync(join(icons, 'icon.icns'), icns)
console.log(`[icons] icon.icns (${ICNS_SLOTS.length} slots, ${icns.length} bytes)`)
