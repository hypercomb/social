// Feature-detect once: iOS Safari has FileSystemFileHandle but not createWritable
const _supportsCreateWritable: boolean =
  typeof (globalThis as any).FileSystemFileHandle !== 'undefined' &&
  typeof (globalThis as any).FileSystemFileHandle.prototype.createWritable === 'function'

let _worker: Worker | null = null
let _nextId = 0
const _pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (_worker) return _worker
  // Same-origin URL so the worker shares the page's OPFS storage partition.
  // A blob: worker URL is storage-partitioned separately on iOS Safari.
  _worker = new Worker('/opfs-write.worker.js')
  _worker.onmessage = ({ data: { id, error } }: MessageEvent<{ id: number; error?: string }>) => {
    const p = _pending.get(id)
    if (!p) return
    _pending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve()
  }
  _worker.onerror = (ev) => {
    const err = new Error(ev.message ?? 'opfs-write worker error')
    for (const p of _pending.values()) p.reject(err)
    _pending.clear()
    _worker = null
  }
  return _worker
}

function writeViaWorker(dirs: string[], name: string, bytes: ArrayBuffer): Promise<void> {
  const w = ensureWorker()
  const id = _nextId++
  return new Promise<void>((resolve, reject) => {
    _pending.set(id, { resolve, reject })
    w.postMessage({ id, dirs, name, bytes }, [bytes])
  })
}

// dirs: path segments from OPFS root (e.g. ['__bees__'] or ['__layers__', 'sentinel'])
export const writeOpfsFile = async (dirs: string[], name: string, bytes: ArrayBuffer): Promise<void> => {
  if (_supportsCreateWritable) {
    const root = await navigator.storage.getDirectory()
    let dir: FileSystemDirectoryHandle = root
    for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create: true })
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await (handle as any).createWritable()
    await writable.write(bytes)
    await writable.close()
  } else {
    await writeViaWorker(dirs, name, bytes)
  }
}

export const terminateOpfsWorker = (): void => {
  if (!_worker) return
  _worker.terminate()
  _worker = null
  const err = new Error('opfs-write worker terminated')
  for (const p of _pending.values()) p.reject(err)
  _pending.clear()
}
