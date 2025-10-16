/// <reference lib="webworker" />


addEventListener('message', async ({ data }) => {
  const { blob } = data

  const imageBitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(imageBitmap.width - 4, imageBitmap.height - 4)
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.drawImage(imageBitmap, 2, 2, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const newBlob = await canvas.convertToBlob()
    postMessage({ blob: newBlob })
  } else {
    postMessage({ error: 'Could not get canvas context' })
  }
})


