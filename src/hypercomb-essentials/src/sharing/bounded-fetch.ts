// sharing/bounded-fetch.ts
//
// A READ OF A HOST HAS A DEADLINE, AND A READ OF MANY HOSTS HAS A BOUND.
//
// Bytes reach a reader by replication from the hosts the participant follows
// (documentation/install-by-replication.md, pools-across-hosts.md), so every
// act that reads a host is only as fast as the slowest host it asks. A bare
// `fetch` has no deadline: one host that accepts the connection and never
// answers holds the act (a publish, a status read, a probe) open for as long
// as the browser cares to wait, and a loop over hosts waits for each in turn.
//
// This file adds NO request. It only bounds the ones that already exist:
//
//   · fetchWithDeadline  — one fetch, aborted after `timeoutMs` (and by a
//     caller's own signal, whichever comes first). The deadline covers the
//     body read too, because the signal stays live after the headers arrive.
//   · mapBounded         — run `fn` over the items, at most `limit` at once,
//     results in input order.
//   · firstBounded       — the same fan-out for a read that needs ONE good
//     answer: the first accepted result wins and the rest are aborted.
//
// A host that timed out is remembered, in memory only. It is not skipped —
// a host that is down today may be fine in a minute — it is asked LAST the
// next round, so it can no longer sit in front of the hosts that answer. Any
// answer from it (even a 404) clears the mark. Nothing here retries.

/** How long one host gets to answer before the act moves on without it. */
export const FETCH_DEADLINE_MS = 8_000

/** How many hosts one act asks at once (4–8: enough that a hung host never
 *  stalls the rest, few enough not to flood the participant's connection). */
export const HOST_CONCURRENCY = 6

export interface DeadlineOptions {
  /** Defaults to FETCH_DEADLINE_MS. */
  readonly timeoutMs?: number
  /** The caller's own cancellation, composed with the deadline. */
  readonly signal?: AbortSignal
}

/** host → when it last timed out. Memory only: a fact about the network right
 *  now, never stored, never a reason to stop asking. */
const timedOut = new Map<string, number>()

/** The host part of a URL (or of a bare host string), lowercased. */
export const hostOfUrl = (url: string): string => {
  try { return new URL(url).host.toLowerCase() } catch { return String(url ?? '').toLowerCase() }
}

/** True when the host's last ask ended in a deadline and it has not answered since. */
export const isSlowHost = (host: string): boolean => timedOut.has(hostOfUrl(host))

/** Test seam. */
export const _resetBackoff = (): void => { timedOut.clear(); forced = null }

/** Test seam: every deadline becomes `ms` (a spec cannot wait out eight seconds). */
let forced: number | null = null
export const _forceDeadlineMs = (ms: number | null): void => { forced = ms }

/** True for the error a deadline (or a caller's abort) raises. */
export const isDeadlineError = (error: unknown): boolean => {
  const name = (error as { name?: string } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

const anySignal = (signals: readonly AbortSignal[]): AbortSignal => {
  if (signals.length === 1) return signals[0]!
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([...signals])
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/** `fetch` that gives up after `timeoutMs`. Rejects with a TimeoutError (or the
 *  caller's abort reason), exactly as a fetch would; callers keep the `catch`
 *  they already have. */
export const fetchWithDeadline = async (url: string, init: RequestInit = {}, options: DeadlineOptions = {}): Promise<Response> => {
  const deadline = AbortSignal.timeout(forced ?? options.timeoutMs ?? FETCH_DEADLINE_MS)
  const signals = [deadline, init.signal, options.signal].filter((signal): signal is AbortSignal => !!signal)
  const host = hostOfUrl(url)
  try {
    const response = await fetch(url, { ...init, signal: anySignal(signals) })
    timedOut.delete(host)
    return response
  } catch (error) {
    // The deadline, not the caller (nor the network), ended it.
    if (deadline.aborted && !options.signal?.aborted && !init.signal?.aborted) timedOut.set(host, Date.now())
    throw error
  }
}

/** The items in the order they should be asked: hosts that are answering first
 *  (in the order given), hosts that timed out last (the longest-ago first). */
const askOrder = <T>(items: readonly T[], hostOf?: (item: T) => string): T[] => {
  if (!hostOf) return [...items]
  const at = (item: T): number => timedOut.get(hostOfUrl(hostOf(item))) ?? 0
  return items
    .map((item, index) => ({ item, index, at: at(item) }))
    .sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || a.at - b.at || a.index - b.index)
    .map(entry => entry.item)
}

const width = (limit: number, count: number): number =>
  Math.max(1, Math.min(Math.floor(Number.isFinite(limit) ? limit : HOST_CONCURRENCY), count))

/** `fn` over every item, at most `limit` at once. Results are in INPUT order;
 *  an item whose `fn` throws yields `undefined` and never fails the others.
 *  With `hostOf`, hosts that recently timed out are asked last. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: { readonly hostOf?: (item: T) => string } = {},
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined)
  if (!items.length) return results
  const entries = items.map((item, index) => ({ item, index }))
  const ordered = options.hostOf ? askOrder(entries, entry => options.hostOf!(entry.item)) : entries
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < ordered.length) {
      const { item, index } = ordered[next++]!
      try { results[index] = await fn(item, index) } catch { results[index] = undefined }
    }
  }
  await Promise.all(Array.from({ length: width(limit, items.length) }, worker))
  return results
}

export interface FirstBounded<T, R> {
  /** The first accepted answer, or null when no host gave one. */
  readonly winner: { readonly item: T; readonly result: R } | null
  /** Every result that settled, in input order; `undefined` for a host not
   *  asked, aborted after a winner, or whose `fn` threw. When there is no
   *  winner every host was asked and settled. */
  readonly results: (R | undefined)[]
}

/** Ask the items, at most `limit` at once, until one answer is accepted. The
 *  first accepted answer wins (latency decides — the caller verifies what it
 *  gets, so order is never trust), the remaining requests are aborted through
 *  the signal handed to `fn`, and no new one starts. */
export async function firstBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, signal: AbortSignal) => Promise<R>,
  accept: (result: R) => boolean,
  options: { readonly hostOf?: (item: T) => string; readonly signal?: AbortSignal } = {},
): Promise<FirstBounded<T, R>> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined)
  if (!items.length) return { winner: null, results }
  const stop = new AbortController()
  const signal = options.signal ? anySignal([stop.signal, options.signal]) : stop.signal
  const entries = items.map((item, index) => ({ item, index }))
  const ordered = options.hostOf ? askOrder(entries, entry => options.hostOf!(entry.item)) : entries
  let winner: { item: T; result: R } | null = null
  let next = 0
  const worker = async (): Promise<void> => {
    while (!winner && !signal.aborted && next < ordered.length) {
      const { item, index } = ordered[next++]!
      let result: R
      try { result = await fn(item, signal) } catch { continue }
      if (winner) return
      results[index] = result
      if (accept(result)) { winner = { item, result }; stop.abort() }
    }
  }
  await Promise.all(Array.from({ length: width(limit, items.length) }, worker))
  return { winner, results }
}
