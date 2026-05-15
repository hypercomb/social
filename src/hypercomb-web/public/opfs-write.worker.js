// Dedicated worker for OPFS writes on iOS Safari (createWritable unavailable).
// Uses FileSystemSyncAccessHandle, which is worker-only but iOS-supported.
// Served as a same-origin file so navigator.storage shares the page's OPFS partition.
self.onmessage = async ({ data: { id, dirs, name, bytes } }) => {
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
}
