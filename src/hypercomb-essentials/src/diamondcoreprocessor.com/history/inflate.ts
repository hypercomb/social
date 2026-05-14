// hypercomb-essentials/src/diamondcoreprocessor.com/history/inflate.ts
//
// Recursive sig → JSON inflater.
//
// A layer's bytes are content-addressed JSON. Slot values are either
// scalars or arrays of 64-hex sigs. Each sig points at another piece
// of content — a child layer, a participant layer, or a resource.
// Inflation walks the merkle DAG bottom-up: every leaf is loaded and
// parsed first, every branch substitutes its already-inflated children,
// and the root assembly is a pure substitution over fully-resolved
// values. Hand any sig to this and the result is a self-contained
// JSON tree — no further sigs, no follow-up reads.
//
// "Bottom-up" matters because sigs in layer JSON sit as bare string
// values (e.g. `"children":["abc…","def…"]`). Trying to substitute at
// the textual level is unsafe — the surrounding quotes would either
// stay (giving a quoted JSON object as a string, useless) or be
// stripped (breaking when a sig appears as a key name or inside a
// larger string). Parsing first, recursing on parsed values, and
// substituting at the structured level sidesteps that entirely.
//
// Resolution order for a sig:
//   1. HistoryService.getLayerBySig — most sigs in this system are
//      layer sigs that live in __history__ bags.
//   2. Store.resolve — sigs whose bytes are JSON (participant bodies,
//      manifests, sig arrays).
//   3. Store.getResource — sigs whose bytes are not JSON (HTML, images,
//      anything content-typed). Returned as a binary descriptor so the
//      DAG inflates to something legible without forcing a parse.
//   4. Opaque marker { $sig, $missing: true } — couldn't resolve at all.
//      Returned rather than thrown so a partial DAG still inflates to
//      something the caller can audit.
//
// Cycles (a child sig that loops back to an ancestor) get an
// { $cycle: sig } marker instead of infinite recursion.

import { isSignature } from '@hypercomb/core'

type LayerLike = {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

type HistoryServiceLike = {
  getLayerBySig: (sig: string) => Promise<LayerLike | null>
}

type StoreLike = {
  resolve: <T = unknown>(value: unknown) => Promise<T>
  getResource?: (sig: string) => Promise<Blob | null>
}

const getIoc = <T>(key: string): T | undefined =>
  (window as { ioc?: { get: <U>(k: string) => U | undefined } }).ioc?.get<T>(key)

/** Marker for binary / non-JSON resources — the bytes exist but they're
 *  not a JSON tree we can recurse into. Carries a short text snippet
 *  when the bytes are valid UTF-8 so HTML / plain text pages stay
 *  human-readable in inflate output. */
type BinaryDescriptor = {
  $sig: string
  $bytes: number
  $contentType: 'text' | 'binary'
  $preview?: string
}

const PREVIEW_LIMIT = 280

/** One sig → its raw parsed value, or a binary descriptor when the
 *  resource exists but isn't JSON, or null when nothing addressable
 *  matches. */
const resolveOne = async (sig: string): Promise<unknown | null> => {
  const history = getIoc<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
  if (history?.getLayerBySig) {
    try {
      const layer = await history.getLayerBySig(sig)
      if (layer) return layer
    } catch { /* fall through */ }
  }

  const store = getIoc<StoreLike>('@hypercomb.social/Store')
  if (store?.resolve) {
    const resolved = await store.resolve<unknown>(sig)
    // Store.resolve returns the input unchanged when the resource isn't
    // JSON-parseable (or doesn't exist). Distinguish the two by reading
    // the raw blob — present-but-binary deserves a real descriptor.
    if (resolved !== sig) return resolved
    if (store.getResource) {
      try {
        const blob = await store.getResource(sig)
        if (!blob) return null
        const buffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let preview: string | undefined
        let contentType: 'text' | 'binary' = 'binary'
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          contentType = 'text'
          preview = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text
        } catch { /* keep binary */ }
        const descriptor: BinaryDescriptor = {
          $sig: sig,
          $bytes: bytes.byteLength,
          $contentType: contentType,
        }
        if (preview !== undefined) descriptor.$preview = preview
        return descriptor
      } catch { /* fall through to null */ }
    }
  }

  return null
}

/** Reserved keys minted by the inflater itself. An object carrying any
 *  of these is a system marker (binary descriptor, missing, cycle) and
 *  should be returned untouched — recursing into it would re-resolve
 *  the very sig that produced the marker. */
const MARKER_KEYS = ['$sig', '$cycle', '$missing', '$bytes'] as const

const isMarker = (value: unknown): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  MARKER_KEYS.some(k => k in (value as Record<string, unknown>))

/**
 * Recursively inflate a value: every 64-hex sig is replaced with the
 * fully-inflated content it points to. Non-sig scalars pass through.
 *
 * `visited` is shared across the whole walk to detect cycles. Pass
 * one in if you're inflating multiple roots and want a single cycle
 * report; otherwise the default is per-call.
 */
export const inflate = async (
  value: unknown,
  visited: Set<string> = new Set(),
): Promise<unknown> => {
  if (isSignature(value)) {
    const sig = value as string
    if (visited.has(sig)) return { $cycle: sig }
    visited.add(sig)
    const raw = await resolveOne(sig)
    if (raw === null) return { $sig: sig, $missing: true }
    if (isMarker(raw)) return raw
    return await inflate(raw, visited)
  }

  if (Array.isArray(value)) {
    const out = new Array(value.length)
    for (let i = 0; i < value.length; i++) {
      out[i] = await inflate(value[i], visited)
    }
    return out
  }

  if (value && typeof value === 'object') {
    if (isMarker(value)) return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await inflate(v, visited)
    }
    return out
  }

  return value
}
