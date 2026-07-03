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
import { buildStoreZip } from './store-zip.js'

export class DownloadQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'download'
  override readonly aliases = ['export']
  override description = 'Download an OPFS zip snapshot of the full client state'
  override examples = [{ input: '/download', result: 'Browser saves a .zip snapshot of all OPFS state' }]

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

// The STORE-method zip writer lives in ./store-zip.ts (shared with
// /website-save so the format can never drift between producers/consumers).

// ── Registration ──────────────────────────────────────────────

const _download = new DownloadQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/DownloadQueenBee', _download)
