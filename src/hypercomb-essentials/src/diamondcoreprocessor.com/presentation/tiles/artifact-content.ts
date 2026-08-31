// diamondcoreprocessor.com/presentation/tiles/artifact-content.ts
//
// THE CONTENT HOP — how any artifact points at its own bytes, under the Life
// Primitive. Shared, because it is not slide-shaped or picture-shaped: it is the
// one rule every artifact follows.
//
//     decoration -> payload.content -> { meta:1, resource:<bytes>, relation } -> bytes
//
// A payload NEVER names raw bytes. It names a typed incidence, and the
// incidence names the bytes. Two consequences fall out with no per-feature work:
//
//   • `content` is a declared EDGE field (core/edge-registry.ts), so every
//     precise closure walker carries the envelope, and `nestedResourceSigs`
//     carries the bytes behind it — sharing and adoption just work;
//   • the artifact never reaches into anything else. It names ONE thing,
//     through one hop, which is what lets any artifact be the root of another
//     tree without knowing it was ever part of one.
//
// `relation` is the slot the incidence is held in ('slide', 'picture', …). It is
// descriptive: it makes the same bytes in two different roles two different
// envelopes, so a diagram used as a slide and as a picture dedups per role
// rather than colliding.
//
// The retired shape — a raw resource signature sitting directly in a payload
// field (`contentSig`, a bare entry in `images[]`) — stays READ-ONLY. Every
// reader here accepts both and nothing mints the old one again.
//
// See documentation/website-artifact-paradigm.md.

import { isMetaEnvelope, metaPayloadOf, mintMetaEnvelope } from '@hypercomb/core'

const SIG = /^[0-9a-f]{64}$/

export type MintStore = { putResource(blob: Blob): Promise<string> }
export type ReadStore = {
  getResourceLocal(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}

/**
 * The typed incidence around an artifact's bytes. Pure and deterministic: the
 * same bytes in the same relation mint the same envelope, so two authors
 * attaching the same file converge on one record.
 */
export function contentEnvelope(bytesSig: string, relation: string): Record<string, unknown> {
  if (!SIG.test(bytesSig)) throw new Error('[artifact-content] content must be a resource signature')
  return mintMetaEnvelope({ resource: bytesSig.toLowerCase(), relation })
}

/** Store the incidence and return ITS signature — what a payload holds. Never
 *  the bytes' own signature: that would be an untyped hop, and the Life
 *  Primitive has none. */
export async function mintContentRef(
  store: MintStore,
  bytesSig: string,
  relation: string,
): Promise<string> {
  const envelope = contentEnvelope(bytesSig, relation)
  return await store.putResource(new Blob([JSON.stringify(envelope)], { type: 'application/json' }))
}

/** The hop a payload declares, canonical field first, retired field second.
 *  Returns a signature that still has to be RESOLVED — it is the envelope, not
 *  the bytes. */
export function contentRefOf(
  payload: Record<string, unknown> | null | undefined,
  canonicalField = 'content',
  legacyField = 'contentSig',
): string | null {
  const canonical = String(payload?.[canonicalField] ?? '')
  if (SIG.test(canonical)) return canonical.toLowerCase()
  const legacy = String(payload?.[legacyField] ?? '')
  return SIG.test(legacy) ? legacy.toLowerCase() : null
}

/**
 * Follow a content hop to the TERMINAL byte signature. Distinct from
 * `resolveLocalResourceReference`, which hands back bytes: a renderer needs the
 * terminal SIG so it can fetch the media through the host-falling-back
 * `getResource` (an envelope is small and local; the media may not be). A
 * retired raw signature resolves to itself, so both shapes take one path.
 */
export async function terminalContentSig(
  store: ReadStore,
  ref: string,
  maxDepth = 4,
): Promise<string | null> {
  if (!SIG.test(ref)) return null
  let current = ref.toLowerCase()
  const seen = new Set<string>()
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (seen.has(current)) return null
    seen.add(current)
    let blob: Blob | null = null
    try { blob = await store.getResourceLocal(current) } catch { return current }
    // Absent locally = nothing to follow; the signature is the best answer we
    // have and the media fetch will try the host with it.
    if (!blob || blob.size > 64 * 1024) return current
    let parsed: unknown
    try { parsed = JSON.parse(await blob.text()) } catch { return current }
    if (!isMetaEnvelope(parsed)) return current
    const payload = metaPayloadOf(parsed)
    if (!payload || payload.kind !== 'resource') return null
    current = payload.sig
  }
  return null
}

/**
 * Fetch the bytes BEHIND a content hop, with a caller-supplied fetcher.
 *
 * `terminalContentSig` answers "which signature holds the bytes" from local
 * reads alone. This is the other half, for a caller that already has a fetch
 * cascade of its own (local → host → mesh) and needs the bytes rather than the
 * name: hand it `store.getResource` and it follows the alternation using that.
 *
 * WHY IT EXISTS: `Store.getResource` does NOT follow the hop — only
 * `getResourceResolvedLocal` and `getLayerBytes` do. Any consumer that fetches a
 * payload reference straight through `getResource` will get the ENVELOPE's JSON
 * and try to render it as content. Every such call site goes through here.
 *
 * A retired raw signature returns its own bytes on the first pass, so both
 * shapes take one path.
 */
export async function fetchThroughContentHop(
  sig: string,
  fetch: (signature: string) => Promise<Blob | null>,
  maxDepth = 4,
): Promise<Blob | null> {
  if (!SIG.test(sig)) return null
  let current = sig.toLowerCase()
  const seen = new Set<string>()
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (seen.has(current)) return null
    seen.add(current)
    const blob = await fetch(current)
    if (!blob) return null
    // An envelope is small JSON; anything larger is the content itself.
    if (blob.size > 64 * 1024) return blob
    let parsed: unknown
    try { parsed = JSON.parse(await blob.text()) } catch { return blob }
    if (!isMetaEnvelope(parsed)) return blob
    const payload = metaPayloadOf(parsed)
    if (!payload || payload.kind !== 'resource') return null
    current = payload.sig
  }
  return null
}
