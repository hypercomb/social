// src/app/core/compile-payload.ts
import type { ActionPayloadV1 } from '@hypercomb/core'

type CompileLoader = 'ts' | 'js'

let worker: Worker | null = null
let pending: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null

const ensureWorker = (): Worker => {
  if (worker) return worker

  worker = new Worker(new URL('../dcp/dcp-worker', import.meta.url), { type: 'module' })

  worker.onmessage = e => {
    if (!pending) return

    const msg = e.data

    if (msg.type === 'compiled') pending.resolve(msg.code)
    else pending.reject(new Error(msg.message ?? 'compilation failed'))

    pending = null
  }

  return worker
}

const inferLoader = (entry: string): CompileLoader => {
  const clean = (entry ?? '').trim().toLowerCase()
  if (clean.endsWith('.js')) return 'js'
  return 'ts'
}

export const compilePayload = (payload: ActionPayloadV1): Promise<string> => {
  const sourceMeta = payload.source
  if (!sourceMeta?.entry) return Promise.reject(new Error('payload has no source entry'))

  const encoded = sourceMeta.files?.[sourceMeta.entry]
  if (!encoded) return Promise.reject(new Error('entry source file not found'))

  // this is the file. nothing else.
  const source = atob(encoded)
  const loader = inferLoader(sourceMeta.entry)

  const w = ensureWorker()

  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    w.postMessage({ type: 'compile', source, loader })
  })
}
