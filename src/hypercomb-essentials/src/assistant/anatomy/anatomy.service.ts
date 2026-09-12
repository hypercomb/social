// assistant/anatomy/anatomy.service.ts
//
// THE ANATOMY AT RUNTIME. `anatomy.generated.ts` is the bytes; this is the
// service the shell asks for them, over IoC (the shell may never import a
// module). Its signature is derived here — never written down anywhere —
// and is what a conversation turn records as "the anatomy I was sent".
//
// Design: documentation/anatomy-context-need.md §2, §6, §7.

import { SignatureService } from '@hypercomb/core'
import { publishService } from '../llm-provider-registry.js'
import { ANATOMY_SOURCES, ANATOMY_TEXT } from './anatomy.generated.js'

export const ANATOMY_IOC_KEY = '@hypercomb.social/Anatomy'

export type AnatomyLike = {
  /** The static anatomy: the system prompt every provider receives first. */
  readonly text: string
  /** sign(text) — resolves once; the same string for the life of the build. */
  readonly signature: () => Promise<string>
  /** Resolves to that same sig once the bytes are a root resource on disk —
   *  a turn record (step 2) waits on this so it never names a sig that
   *  cannot be read back. */
  readonly written: Promise<string>
  /** Which documents and sections the doctrine part was lifted from. */
  readonly sources: readonly { readonly doc: string; readonly heading: string }[]
}

// THE ANATOMY IS CONTENT. Once the store is up it is written as a sig-named
// resource at the root, so a turn that recorded "anatomy: <sig>" can be
// replayed by `read(sig)` like any other document. Idempotent: same bytes,
// same sig, already there is a no-op. `emit: false` because `content:wrote`
// is the publish trigger and a system artifact must never publish itself.
// The `system:anatomy` lineage bag (marker per anatomy version) lands with
// the turn records in step 2 of anatomy-context-need.md §9.
//
// POLLED, NOT `whenReady`. This module registers early, and `window.ioc` is
// REPLACED after the first barrel modules load (llm-provider-registry.ts) —
// a `whenReady` parked on the early map never fires, which is exactly how the
// first cut of this file wrote nothing. Boot work asks for the service
// itself until it is there.
type StoreLike = { putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string> }
const STORE_KEY = '@hypercomb.social/Store'
const POLL_MS = 250
const POLL_LIMIT = 240 // a minute; past that the store is not coming this boot

// A store whose method EXISTS is not yet a store that is READY: the instance
// is registered before its OPFS root is open, and a write in that window
// rejects. So a rejection is not "no" — it is "not yet", and the poll keeps
// going. Only the limit ends it; then the anatomy still travels from memory.
const written: Promise<string> = new Promise(resolve => {
  let polls = 0
  const later = (): void => { if (++polls < POLL_LIMIT) setTimeout(tick, POLL_MS) }
  const tick = (): void => {
    const store = window.ioc?.get?.(STORE_KEY) as StoreLike | undefined
    if (!store?.putResource) return later()
    let attempt: Promise<string>
    try {
      attempt = store.putResource(new Blob([ANATOMY_TEXT], { type: 'text/markdown' }), { emit: false })
    } catch { return later() }
    attempt.then(resolve, later)
  }
  tick()
})

let signed: Promise<string> | undefined

export const anatomy: AnatomyLike = {
  text: ANATOMY_TEXT,
  signature: () => signed ??= SignatureService.sign(new TextEncoder().encode(ANATOMY_TEXT).buffer as ArrayBuffer),
  written,
  sources: ANATOMY_SOURCES,
}

// Both lines are needed. The first is what `prepare` looks for to classify
// this file as a side-effect module and load it at all; the second survives
// the early `window.ioc` map being replaced (see llm-provider-registry.ts).
window.ioc?.register(ANATOMY_IOC_KEY, anatomy)
publishService(ANATOMY_IOC_KEY, anatomy)
