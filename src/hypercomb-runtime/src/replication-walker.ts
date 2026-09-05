// hypercomb-runtime/src/replication-walker.ts
//
// The shell-embedded replication client (documentation/install-by-replication.md,
// migration step 1). Browser-side twin of the relay's replicate.js: given
// identity — one root signature, or an exact inventory of signatures — resolve
// the atoms into the local heap through an injected io. Every fetched atom is
// verified against its name before write; present atoms are reused; a repeated
// call is an idempotent delta repair. Complete-or-absent: callers gate on
// `holes.length === 0` and runtime never verifies again (admission is the
// trust boundary).
//
// SQUEAKY CLEAN RULE: this module knows nothing about pools, kinds, `.js`
// suffixes, legacy `__x__` dirs, or URL shapes. All placement, naming, and
// drain-window fallbacks belong to the caller's io implementation — the
// protocol must never grow a second dialect.

import { SignatureService } from '@hypercomb/core'

export const SIGNATURE_RE = /^[a-f0-9]{64}$/

const DEFAULT_LIMIT = 20_000
const DEFAULT_CONCURRENCY = 6

/** How the walker touches the world. `read` probes the local heap, `fetch`
 *  asks the content origin, `write` admits verified bytes. All three are
 *  addressed by bare signature — never by path, extension, or kind. */
export type ReplicationIo = {
  read(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  fetch(signature: string): Promise<Uint8Array<ArrayBuffer> | null>
  write(signature: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
}

export type ReplicationResult = {
  root: string
  total: number
  present: number
  fetched: number
  held: string[]
  holes: string[]     // unreachable — origin had nothing for the signature
  refused: string[]   // origin served bytes that do not hash to the signature
  limited: boolean
}

export type ReplicationOptions = {
  limit?: number
  concurrency?: number
  /** How a held atom names its children. Defaults to {@link mineSignatures} —
   *  every literal signature in the bytes. A caller that knows the record
   *  shape passes a selector instead, which is how a STRUCTURED closure (a
   *  layer's declared `cells`, say) is walked without the protocol learning
   *  anything about that shape. Same dialect, narrower frontier. */
  children?: (bytes: Uint8Array<ArrayBuffer>) => string[]
}

export const isComplete = (result: ReplicationResult): boolean =>
  !result.limited && result.holes.length === 0 && result.refused.length === 0

const verify = async (bytes: Uint8Array<ArrayBuffer>, signature: string): Promise<boolean> =>
  (await SignatureService.sign(bytes.buffer)) === signature

/** Text atoms may refer to more atoms by their 64-hex identities. Opaque
 *  binary atoms are leaves. Deliberately follows only literal signatures —
 *  the same fallback rule the relay applies host-side. */
export const mineSignatures = (bytes: Uint8Array): string[] => {
  const text = new TextDecoder().decode(bytes)
  if (text.includes('�')) return []
  return [...text.matchAll(/[a-f0-9]{64}/g)].map(match => match[0])
}

/** Resolve one atom into the heap: reuse a verified local copy, otherwise
 *  fetch, verify, admit. Returns the bytes only when the heap holds them. */
const resolveOne = async (
  signature: string,
  io: ReplicationIo,
  result: ReplicationResult,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  let bytes = await io.read(signature)
  if (bytes && !(await verify(bytes, signature))) bytes = null
  if (bytes) {
    result.present++
  } else {
    bytes = await io.fetch(signature)
    if (!bytes) { result.holes.push(signature); return null }
    if (!(await verify(bytes, signature))) { result.refused.push(signature); return null }
    await io.write(signature, bytes)
    result.fetched++
  }
  result.held.push(signature)
  return bytes
}

/** Resolve the reachable signature closure of one root: walk every signature
 *  the held atoms name, breadth-first, until the frontier is dry. What "name"
 *  means is the `children` option's business — literal mining by default. */
export const resolveSignatureClosure = async (
  root: string,
  io: ReplicationIo,
  options: ReplicationOptions = {},
): Promise<ReplicationResult> => {
  if (!SIGNATURE_RE.test(root)) throw new TypeError('root must be a lowercase 64-hex signature')
  const limit = options.limit ?? DEFAULT_LIMIT
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const childrenOf = options.children ?? mineSignatures
  const seen = new Set([root])
  const queue = [root]
  const result: ReplicationResult = { root, total: 0, present: 0, fetched: 0, held: [], holes: [], refused: [], limited: false }

  while (queue.length && result.total < limit) {
    const room = limit - result.total
    const frontier = queue.splice(0, Math.min(concurrency, room)).filter(sig => SIGNATURE_RE.test(sig))
    result.total += frontier.length
    await Promise.all(frontier.map(async (signature) => {
      const bytes = await resolveOne(signature, io, result)
      if (!bytes) return
      for (const child of childrenOf(bytes)) {
        if (seen.has(child)) continue
        seen.add(child)
        queue.push(child)
      }
    }))
  }
  result.limited = queue.length > 0
  return result
}

/** Resolve an exact enumerated inventory — no mining, no recursion. This is
 *  the sealed-package / active-genome shape: the verified record that named
 *  these signatures IS the inventory identity, so nothing outside the list is
 *  a candidate. `root` labels the result (the record's own signature). */
export const resolveInventory = async (
  root: string,
  signatures: string[],
  io: ReplicationIo,
  options: ReplicationOptions = {},
): Promise<ReplicationResult> => {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const unique = [...new Set(signatures)].filter(sig => SIGNATURE_RE.test(sig))
  const result: ReplicationResult = { root, total: unique.length, present: 0, fetched: 0, held: [], holes: [], refused: [], limited: false }

  for (let i = 0; i < unique.length; i += concurrency) {
    await Promise.all(unique.slice(i, i + concurrency).map(signature => resolveOne(signature, io, result)))
  }
  return result
}
