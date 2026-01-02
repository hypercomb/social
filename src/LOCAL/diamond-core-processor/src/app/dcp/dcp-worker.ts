// src/app/dcp/dcp-worker.ts
import { ensureEsbuild } from './esbuild-runtime'

self.onmessage = async (e: MessageEvent) => {
  const { type, source } = e.data

  if (type !== 'compile') return
  if (typeof source !== 'string') {
    self.postMessage({
      type: 'error',
      message: 'compile source must be a string'
    })
    return
  }

  try {
    const esbuild = await ensureEsbuild()

    const result = await esbuild.transform(source, {
      loader: 'ts',          // ← THIS IS THE FIX
      format: 'esm',
      target: 'es2022'
    })

    self.postMessage({
      type: 'compiled',
      code: result.code
    })
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: err?.message ?? String(err)
    })
  }
}
