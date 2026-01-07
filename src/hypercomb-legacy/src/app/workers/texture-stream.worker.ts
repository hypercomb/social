// texture-stream.worker.ts
// Runs in a separate thread — no direct DOM access.

self.onmessage = async (event: MessageEvent) => {
  const { id, cacheId, blob } = event.data as { id: string; cacheId: number; blob: Blob }

  try {
    // decode the image off-thread
    const bitmap = await createImageBitmap(blob)
    // send back transferable ImageBitmap
    self.postMessage({ id, cacheId, bitmap }, [bitmap])
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
