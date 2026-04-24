// diamondcoreprocessor.com/commands/download.queen.ts
//
// /download — walk the entire OPFS root (history, resources, bees,
// dependencies, user content) and emit a .zip file the browser saves
// to disk. Content-addressed resources plus the history tree make the
// zip a complete, restorable snapshot of the client's state — useful
// for pre-migration safety dumps, for handing state off to another
// device, and for bug reports.
//
// The zip is hand-built with the STORE method (no compression) so we
// don't need to add a dep or pull deflate into the renderer. For the
// sizes we're dealing with (tens of MB at most), the extra bytes are
// worth the zero-dep simplicity. All multi-byte integers are written
// little-endian per the zip spec. CRC-32 is computed per file with
// the standard IEEE polynomial (reversed, 0xedb88320).

import { QueenBee } from '@hypercomb/core'

export class DownloadQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'download'
  override readonly aliases = ['export']
  override description = 'Download an OPFS zip snapshot of the full client state'

  protected async execute(_args: string): Promise<void> {
    const opfsRoot = await navigator.storage?.getDirectory?.()
    if (!opfsRoot) return

    const files: { path: string; bytes: Uint8Array }[] = []
    await walkDir(opfsRoot, '', files)
    if (files.length === 0) return

    const zip = buildStoreZip(files)
    const blob = new Blob([zip as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `hypercomb-opfs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      // Revoke after a tick so the navigation has time to pick up the
      // blob URL; Safari in particular is finicky about instant revoke.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }
}

// ── OPFS walk ─────────────────────────────────────────────────

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: { path: string; bytes: Uint8Array }[],
): Promise<void> {
  for await (const [name, handle] of (dir as any).entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') {
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const bytes = new Uint8Array(await file.arrayBuffer())
        out.push({ path, bytes })
      } catch { /* unreadable file — skip rather than abort the dump */ }
    } else if (handle.kind === 'directory') {
      await walkDir(handle as FileSystemDirectoryHandle, path, out)
    }
  }
}

// ── Zip (STORE, no compression) ───────────────────────────────
//
// Layout produced:
//   for each file:
//     Local File Header | filename bytes | file bytes
//   for each file (repeated):
//     Central Directory File Header | filename bytes
//   End Of Central Directory Record

function buildStoreZip(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const crcTable = getCrcTable()

  // Pre-compute per-file metadata + local headers so we can measure
  // the final buffer size in a single pass, then write everything in
  // a second pass at known offsets. Two-pass keeps memory bounded
  // (one allocation for the result) and avoids re-computing CRC.
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

// ── Registration ──────────────────────────────────────────────

const _download = new DownloadQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/DownloadQueenBee', _download)
