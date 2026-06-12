// Dedicated worker for OPFS writes on iOS Safari (createWritable unavailable).
// Uses FileSystemSyncAccessHandle, which is worker-only but iOS-supported.
// Served as a same-origin file so navigator.storage shares the page's OPFS
// partition (a blob: worker URL is storage-partitioned separately on iOS).
//
// SAH ops are serialized through a promise queue — iOS has a hard limit on
// concurrent SAH instances per origin. Concurrent async onmessage handlers
// each call createSyncAccessHandle(), exhausting the limit and throwing OOM
// when many files are written at once (e.g. a 114-file bundled install).
let queue = Promise.resolve()

self.onmessage = ({ data: { id, dirs, name, bytes } }) => {
  queue = queue.then(async () => {
    try {
      const root = await navigator.storage.getDirectory()
      let dir = root
      for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create: true })
      const handle = await dir.getFileHandle(name, { create: true })
      const sah = await handle.createSyncAccessHandle()
      sah.truncate(0)
      sah.write(new Uint8Array(bytes))
      sah.flush()
      sah.close()
      self.postMessage({ id })
    } catch (e) {
      self.postMessage({ id, error: String(e) })
    }
  })
}
