// src/app/dcp/esbuild-runtime.ts
import * as esbuild from 'esbuild-wasm'

let initPromise: Promise<void> | null = null

export const ensureEsbuild = async (): Promise<typeof esbuild> => {
  if (!initPromise) {
    initPromise = esbuild.initialize({
      wasmURL: '/esbuild.wasm',
      worker: true
    })
  }

  await initPromise
  return esbuild
}
