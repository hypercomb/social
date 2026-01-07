/// <reference lib="webworker" />

self.onmessage = async (event) => {
  const { blobs, positions, width, height } = event.data

  const canvas = new OffscreenCanvas(2048, 2048)
  const ctx = canvas.getContext('2d')

  // guard for strict null checks
  if (!ctx) {
    // you can also throw here, but posting an error is safer in workers
    self.postMessage({ error: "2d context unavailable" })
    return
  }

  for (let i = 0; i < blobs.length; i++) {
    const bmp = await createImageBitmap(blobs[i])
    const { x, y } = positions[i]
    ctx.drawImage(bmp, x, y, width, height)
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  self.postMessage({ blob })
}
