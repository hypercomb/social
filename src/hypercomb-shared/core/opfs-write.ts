// Centralised OPFS file write.
//
// Chrome / Firefox / desktop Safari expose FileSystemWritableFileStream via
// `handle.createWritable()`. iOS Safari has OPFS but NOT createWritable — its
// only write primitive is FileSystemSyncAccessHandle, which is worker-only.
// There, writes are routed through a dedicated SAME-ORIGIN worker
// (`/opfs-write.worker.js`): same-origin so it shares the page's storage
// partition (a blob: worker URL is partitioned separately on iOS), and the
// worker serializes its SAH ops because iOS caps concurrent SAH handles per
// origin (concurrency throws OOM during large bundled installs).

const supportsCreateWritable =
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof (FileSystemFileHandle as unknown as { prototype?: { createWritable?: unknown } })
    .prototype?.createWritable === 'function'

// True on engines (iOS Safari) that lack createWritable. Also gates the
// module-import path elsewhere: a blob: module URL has an opaque origin and
// cannot see the page import map on iOS, so bees/deps are imported from
// same-origin /opfs/ service-worker URLs instead of blob/bare-alias.
export const OPFS_SYNC_ONLY = !supportsCreateWritable

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

const ensureWorker = (): Worker => {
  if (worker) return worker
  worker = new Worker('/opfs-write.worker.js')
  worker.onmessage = ({ data }: MessageEvent<{ id: number; error?: string }>) => {
    const p = pending.get(data.id)
    if (!p) return
    pending.delete(data.id)
    if (data.error) p.reject(new Error(data.error))
    else p.resolve()
  }
  worker.onerror = (ev) => {
    const err = new Error(ev.message ?? 'opfs-write worker error')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    worker = null
  }
  return worker
}

const writeViaWorker = (dirs: string[], name: string, bytes: ArrayBuffer): Promise<void> => {
  const w = ensureWorker()
  const id = nextId++
  return new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    // No transfer list: structured-clone the bytes so callers that reuse the
    // buffer after the write (e.g. mirror writes, content:wrote emit) keep it.
    w.postMessage({ id, dirs, name, bytes })
  })
}

const encoder = new TextEncoder()
const toArrayBuffer = async (
  data: Blob | ArrayBuffer | ArrayBufferView | string,
): Promise<ArrayBuffer> => {
  if (typeof data === 'string') return encoder.encode(data).buffer
  if (data instanceof Blob) return await data.arrayBuffer()
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  return data
}

// Write `data` to `<dir>/<name>` in OPFS, transparently using the SAH worker
// on iOS. `dir` may be nested (e.g. a sigbag dir); its path from the OPFS
// root is recovered via `root.resolve(dir)` for the worker's path-based
// navigation, since a handle does not expose its own parent path.
export const writeOpfsFile = async (
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | ArrayBuffer | ArrayBufferView | string,
): Promise<void> => {
  if (supportsCreateWritable) {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(data as FileSystemWriteChunkType)
    } finally {
      await writable.close()
    }
    return
  }
  const bytes = await toArrayBuffer(data)
  const root = await navigator.storage.getDirectory()
  const dirs = (await root.resolve(dir)) ?? (dir.name ? [dir.name] : [])
  await writeViaWorker(dirs, name, bytes)
}
