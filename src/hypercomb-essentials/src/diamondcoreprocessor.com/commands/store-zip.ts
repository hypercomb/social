// diamondcoreprocessor.com/commands/store-zip.ts
//
// Zero-dependency STORE-method (no compression) zip codec, shared by every
// essentials command that reads or writes a .zip. The WRITER was lifted
// verbatim from download.queen.ts; the READER is its exact inverse. Keeping
// both here means the format can never drift between a producer and a
// consumer (e.g. /download writes, /website-load reads).
//
// STORE only: no deflate, so the renderer never pulls a compression dep. For
// the sizes in play (a website branch is a few MB) the extra bytes are worth
// the zero-dep simplicity. All multi-byte integers are little-endian per the
// zip spec; CRC-32 is the standard IEEE polynomial (reversed, 0xedb88320).

// ── CRC-32 (IEEE) ─────────────────────────────────────────────

let cachedCrcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (cachedCrcTable) return cachedCrcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  cachedCrcTable = table
  return table
}

function crc32(bytes: Uint8Array, table: Uint32Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ table[(c ^ bytes[i]) & 0xff]
  }
  return (c ^ 0xffffffff) >>> 0
}

// ── Writer ────────────────────────────────────────────────────
//
// Layout produced:
//   for each file:  Local File Header | filename bytes | file bytes
//   for each file:  Central Directory File Header | filename bytes
//   End Of Central Directory Record

export function buildStoreZip(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const crcTable = getCrcTable()

  // Pre-compute per-file metadata + local headers so we can measure the final
  // buffer size in a single pass, then write everything at known offsets.
  type Encoded = {
    nameBytes: Uint8Array
    data: Uint8Array
    crc: number
    localOffset: number
  }
  const encoded: Encoded[] = []
  let cursor = 0
  for (const f of files) {
    const nameBytes = encoder.encode(f.path)
    const crc = crc32(f.bytes, crcTable)
    encoded.push({ nameBytes, data: f.bytes, crc, localOffset: cursor })
    cursor += 30 /* local header */ + nameBytes.length + f.bytes.length
  }
  const cdStart = cursor
  for (const e of encoded) {
    cursor += 46 /* central header */ + e.nameBytes.length
  }
  const cdEnd = cursor
  cursor += 22 /* EOCD */
  const total = cursor

  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  let p = 0

  // Local file headers + data
  for (const e of encoded) {
    dv.setUint32(p, 0x04034b50, true)           // signature
    dv.setUint16(p + 4, 20, true)               // version needed
    dv.setUint16(p + 6, 0, true)                // flags
    dv.setUint16(p + 8, 0, true)                // method: STORE
    dv.setUint16(p + 10, 0, true)               // mod time
    dv.setUint16(p + 12, 0, true)               // mod date
    dv.setUint32(p + 14, e.crc, true)           // crc-32
    dv.setUint32(p + 18, e.data.length, true)   // compressed size
    dv.setUint32(p + 22, e.data.length, true)   // uncompressed size
    dv.setUint16(p + 26, e.nameBytes.length, true) // filename length
    dv.setUint16(p + 28, 0, true)               // extra field length
    p += 30
    out.set(e.nameBytes, p); p += e.nameBytes.length
    out.set(e.data, p); p += e.data.length
  }

  // Central directory headers
  for (const e of encoded) {
    dv.setUint32(p, 0x02014b50, true)           // signature
    dv.setUint16(p + 4, 20, true)               // version made by
    dv.setUint16(p + 6, 20, true)               // version needed
    dv.setUint16(p + 8, 0, true)                // flags
    dv.setUint16(p + 10, 0, true)               // method
    dv.setUint16(p + 12, 0, true)               // mod time
    dv.setUint16(p + 14, 0, true)               // mod date
    dv.setUint32(p + 16, e.crc, true)           // crc
    dv.setUint32(p + 20, e.data.length, true)   // compressed size
    dv.setUint32(p + 24, e.data.length, true)   // uncompressed size
    dv.setUint16(p + 28, e.nameBytes.length, true) // filename length
    dv.setUint16(p + 30, 0, true)               // extra length
    dv.setUint16(p + 32, 0, true)               // comment length
    dv.setUint16(p + 34, 0, true)               // disk number
    dv.setUint16(p + 36, 0, true)               // internal attrs
    dv.setUint32(p + 38, 0, true)               // external attrs
    dv.setUint32(p + 42, e.localOffset, true)   // local header offset
    p += 46
    out.set(e.nameBytes, p); p += e.nameBytes.length
  }

  // End of central directory
  dv.setUint32(p, 0x06054b50, true)             // signature
  dv.setUint16(p + 4, 0, true)                  // disk number
  dv.setUint16(p + 6, 0, true)                  // cd start disk
  dv.setUint16(p + 8, encoded.length, true)     // entries on this disk
  dv.setUint16(p + 10, encoded.length, true)    // total entries
  dv.setUint32(p + 12, cdEnd - cdStart, true)   // cd size
  dv.setUint32(p + 16, cdStart, true)           // cd offset
  dv.setUint16(p + 20, 0, true)                 // comment length
  p += 22

  return out
}

// ── Reader ────────────────────────────────────────────────────
//
// The inverse of buildStoreZip: locate the End Of Central Directory, walk the
// central directory, and for each entry read its local header and slice the
// stored bytes. STORE method only (the writer never deflates) — any other
// method throws. CRC-32 is checked per entry as a cheap integrity pre-gate
// (the caller still does the authoritative sha256===filename-sig check).

export function readStoreZip(zip: Uint8Array): { path: string; bytes: Uint8Array }[] {
  if (zip.length < 22) throw new Error('not a zip (too short)')
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const decoder = new TextDecoder()
  const table = getCrcTable()

  // End Of Central Directory — scan back for its signature (the writer emits
  // no archive comment, so it's the last 22 bytes, but scan anyway).
  let eocd = -1
  for (let i = zip.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)')

  const count = dv.getUint16(eocd + 10, true)
  const cdOffset = dv.getUint32(eocd + 16, true)

  const out: { path: string; bytes: Uint8Array }[] = []
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt central-directory header')
    const method = dv.getUint16(p + 10, true)
    const crc = dv.getUint32(p + 16, true) >>> 0
    const size = dv.getUint32(p + 24, true)        // uncompressed size (== compressed for STORE)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen

    if (method !== 0) throw new Error(`unsupported zip method ${method} for "${name}" (STORE only)`)
    if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`corrupt local header for "${name}"`)
    const lNameLen = dv.getUint16(localOffset + 26, true)
    const lExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    // .slice() copies the bytes out of the source buffer so the caller can hold
    // them past the archive's lifetime and hash/store them independently.
    const bytes = zip.slice(dataStart, dataStart + size)
    if (crc32(bytes, table) !== crc) throw new Error(`crc mismatch for "${name}" (archive corrupt)`)
    out.push({ path: name, bytes })
  }
  return out
}
