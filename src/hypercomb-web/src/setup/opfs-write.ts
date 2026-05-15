let _worker: Worker | null = null
let _nextId = 0
const _pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

const WORKER_SRC = `
self.onmessage = async ({ data: { id, dir, name, bytes } }) => {
  try {
    const handle = await dir.getFileHandle(name, { create: true })
    const sah = await handle.createSyncAccessHandle()
    sah.truncate(0)
    sah.write(new Uint8Array(bytes), { at: 0 })
    sah.flush()
    sah.close()
    self.postMessage({ id })
  } catch (e) {
    self.postMessage({ id, error: String(e) })
  }
}
`

function ensureWorker(): Worker {
  if (_worker) return _worker
  const blob = new Blob([WORKER_SRC], { type: 'application/javascript' })
  _worker = new Worker(URL.createObjectURL(blob))
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

function writeViaWorker(dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> {
  const w = ensureWorker()
  const id = _nextId++
  return new Promise<void>((resolve, reject) => {
    _pending.set(id, { resolve, reject })
    w.postMessage({ id, dir, name, bytes }, [bytes])
  })
}

export const writeOpfsFile = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  if (typeof (handle as any).createWritable === 'function') {
    const writable = await (handle as any).createWritable()
    await writable.write(bytes)
    await writable.close()
  } else {
    await writeViaWorker(dir, name, bytes)
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
