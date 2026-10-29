// hypercomb-runtime/src/early-runtime.ts
//
// THE VISITOR'S FIRST MODULE. A normal request runs a compiled, minified
// runtime from the shared content heap, plugged in before the readable import
// map. A debug request keeps the readable runtime, so the source stays
// inspectable (documentation/build-debug-isolation.md).
//
// The heap is the sig-named content root: `/content/<sig>`. The runtime is
// one member of it. Every door on the deploy reads that same member, and a
// resource named by signature is the same member too.

import { isSandboxLabel } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/

/** The pin file beside `head`. Its body is the runtime's signature. */
export const RUNTIME_PIN = 'runtime'

/** Where the readable runtime stays, for a debug request and for a build
 *  that stamped no pin. */
export const READABLE_RUNTIME_URL = '/hypercomb-core.runtime.js'

/** A debug request: the visitor turned `hc:verbose` on, or this host is a
 *  sandbox door. The label check is the one predicate in sandbox-door.ts. */
export const isDebugRequest = (hostname: string, verbose = false): boolean => {
  if (verbose) return true
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '')
  const label = host.split('.')[0] ?? ''
  return isSandboxLabel(label)
}

/** The module a normal request runs first. Null keeps the readable runtime. */
export const earlyRuntimeUrl = (runtimeSig: string | null | undefined, debug: boolean): string | null => {
  const sig = String(runtimeSig ?? '').trim().toLowerCase()
  if (debug || !SIG_RE.test(sig)) return null
  return `/content/${sig}`
}

/** Read a pin file. Anything that is not one signature is no pin. */
export const parseRuntimePin = (text: string | null | undefined): string | null => {
  const line = String(text ?? '').trim().toLowerCase()
  return SIG_RE.test(line) ? line : null
}
