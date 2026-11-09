// sharing/pool-listing.ts
//
// THE ONE WAY A HIVE ASKS A HOST FOR A POOL'S LISTING (2026-11-09: "I still
// see these 404 errors all the time ... we really need to make this foolproof").
//
// A pool is a directory at `sign(meaning)/`, and every word, name and record
// is an address a hive derives for itself and asks of EVERY host it follows
// (pools-across-hosts.md). Most hosts hold nothing there, and say so with a
// 404 — which a browser prints as a red console line whatever the page does
// with the answer. Three names asked of twenty hosts was sixty errors, on a
// hive that was working exactly as designed.
//
// So the question is asked one way, here:
//
//   · with `?held` — a host that knows the flag (the worker, the relay, the
//     native host) answers "no pool here" with a quiet 204 instead of a 404.
//     A host that does not know it answers 404 as before;
//   · once — the same host is never asked the same address twice at once;
//   · and a miss is REMEMBERED for a while, so a host that said no is not
//     asked again on every head change, every hover, every refresh. A listing
//     that answers forgets the miss at once.
//
// It adds no request and decides nothing: the listing is entry NAMES, never
// trusted on their own — every caller still re-reads each member's own signed
// word. Memory only: a fact about the network right now, never stored.

import { fetchWithDeadline } from './bounded-fetch.js'

/** How long a host's "no pool at this address" stands before it is asked again. */
export const POOL_ABSENT_QUIET_MS = 5 * 60_000

export interface PoolListingOptions {
  /** Defaults to bounded-fetch's deadline. */
  readonly timeoutMs?: number
  /** The caller's own cancellation. */
  readonly signal?: AbortSignal
  /** Ask the host even when it said no a moment ago (a write just landed). */
  readonly fresh?: boolean
}

/** What a host said about a pool:
 *  - `listed`  — it answered a listing (`text` may be empty: a pool with no members);
 *  - `absent`  — it said there is no pool at this address (now, or remembered);
 *  - `silent`  — it did not answer, or answered something that is not a listing. */
export type PoolListing =
  | { readonly state: 'listed'; readonly text: string }
  | { readonly state: 'absent' }
  | { readonly state: 'silent' }

// Pinned on globalThis like the index misses (hive-pointer.ts): one memory per
// page however many bundles carry this file.
type Memory = { absent: Map<string, number>; flight: Map<string, Promise<PoolListing>> }
const memory: Memory =
  ((globalThis as { __hypercombPoolListing?: Memory }).__hypercombPoolListing ??= { absent: new Map(), flight: new Map() })

/** Forget every remembered miss — a test world's reset, or a host given back. */
export const forgetPoolMisses = (): void => { memory.absent.clear(); memory.flight.clear() }

/** The listing URL for a pool on a host origin (`https://host`, or with a base
 *  path such as `https://host/content`). */
export const poolListingUrl = (origin: string, address: string): string =>
  `${String(origin ?? '').replace(/\/+$/, '')}/${address}/`

/** Ask one host for one pool's listing. Never throws. */
export const askPoolListing = (origin: string, address: string, options: PoolListingOptions = {}): Promise<PoolListing> => {
  const url = poolListingUrl(origin, address)
  if (!options.fresh && (memory.absent.get(url) ?? 0) > Date.now()) return Promise.resolve({ state: 'absent' })
  // One question in flight per address — unless the caller brought its own
  // cancellation, which must not end somebody else's ask.
  if (!options.signal) {
    const flying = memory.flight.get(url)
    if (flying) return flying
  }
  const ask = (async (): Promise<PoolListing> => {
    let response: Response
    try {
      response = await fetchWithDeadline(`${url}?held`, { cache: 'no-store' }, { timeoutMs: options.timeoutMs, signal: options.signal })
    } catch { return { state: 'silent' } }
    // No pool here: a quiet 204 from a host that knows `?held`, a 404 (or a
    // 410) from one that does not — one answer, remembered for a while.
    if (response.status === 204 || response.status === 404 || response.status === 410) {
      memory.absent.set(url, Date.now() + POOL_ABSENT_QUIET_MS)
      return { state: 'absent' }
    }
    if (!response.ok) return { state: 'silent' }
    // A page where a listing should be (an SPA fallback) is not a listing.
    if ((response.headers?.get?.('content-type') ?? '').toLowerCase().includes('text/html')) return { state: 'silent' }
    let text: string
    try { text = await response.text() } catch { return { state: 'silent' } }
    if (text.includes('<')) return { state: 'silent' }
    memory.absent.delete(url)
    return { state: 'listed', text }
  })()
  if (!options.signal) {
    memory.flight.set(url, ask)
    void ask.finally(() => { if (memory.flight.get(url) === ask) memory.flight.delete(url) })
  }
  return ask
}

/** The listing's body, or null when the host listed nothing it could be read
 *  from (no pool there, no answer, a page). The common shape callers want. */
export const readPoolListing = async (origin: string, address: string, options: PoolListingOptions = {}): Promise<string | null> => {
  const said = await askPoolListing(origin, address, options)
  return said.state === 'listed' ? said.text : null
}
