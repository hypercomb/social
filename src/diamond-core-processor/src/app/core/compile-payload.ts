// src/app/core/compile-payload.ts
import type { ActionPayloadV1 } from '@hypercomb/core'

let worker: Worker | null = null
let pending:
  | { resolve: (code: string) => void; reject: (err: Error) => void }
  | null = null

const ensureWorker = (): Worker => {
  if (worker) return worker

  worker = new Worker(
    new URL('../dcp/dcp-worker', import.meta.url),
    { type: 'module' }
  )

  worker.onmessage = e => {
    if (!pending) return

    const msg = e.data

    if (msg.type === 'compiled') {
      pending.resolve(msg.code)
    } else {
      pending.reject(new Error(msg.message ?? 'compilation failed'))
    }

    pending = null
  }

  return worker
}

export const compilePayload = (payload: ActionPayloadV1): Promise<string> => {
  const sourceMeta = payload.source
  if (!sourceMeta?.entry) {
    return Promise.reject(new Error('payload has no source entry'))
  }

  const encoded = sourceMeta.files?.[sourceMeta.entry]
  if (!encoded) {
    return Promise.reject(new Error('entry source file not found'))
  }

  // THIS is the file. Nothing else.
  const source = atob(encoded)

  const w = ensureWorker()

  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    w.postMessage({ type: 'compile', source })
  })
}
