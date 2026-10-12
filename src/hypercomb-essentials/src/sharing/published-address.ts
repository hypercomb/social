// sharing/published-address.ts
//
// WHERE A PUBLISHED ADDRESS STANDS NOW. A card held by its address keeps the head you took, and is offered a
// newer one as an update (documentation/using-a-creation.md, "Holding a published item"). This answers the one
// question that needs: what head does this address serve now, and is it really its publisher's, for this address?
//
// A host keeps one door record per hostname, in the bag sign(<hostname>): { layer, pubkey, lineage, title },
// the newest marker being the current one. The record is only the host's word. The publisher's signed index is
// the proof, read the way the host worker reads it:
//   - the index names that very layer as the lineage's head;
//   - the address is bound to the lineage: signed as its own address (`addresses`), or, with no own address,
//     the address's first label IS the lineage (the worker's implicit door);
//   - when the index lists doors for the lineage, the address is on one of those zones.
// The index's signed time travels with the head, so an older head is never offered as an update.
// Only the head is read: what an outsider may see of an address is its head and what that head holds.
//
// Every read is bounded in time and size. Pure: fetch and the index read are passed in for tests. A root-path
// address (https://<zone>/<path>) is not read here yet; its door record is carried only inside its page.

import { SignatureService } from '@hypercomb/core'
import { fetchHiveIndex, type HiveIndexResult } from './hive-pointer.js'

const SIG = /^[0-9a-f]{64}$/
const MAX_LISTING = 65_536
const MAX_RECORD = 65_536
const MAX_BYTES = 262_144      // a layer, a record or a card: far more than any holds
const TIMEOUT_MS = 10_000

export type AddressHead =
  | { head: string; pubkey: string; lineage: string; title: string; host: string; publishedAt: number }
  | { error: 'not-an-address' | 'unreachable' | 'no-door' | 'unverified' }

export interface AddressHeadDeps {
  fetch?: typeof fetch
  index?: (host: string, pubkey: string) => Promise<HiveIndexResult>
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/

/** An address as typed or scanned → its URL, when it is a published door's own address (a host's root). */
export const doorUrlOf = (address: string): URL | null => {
  const raw = String(address ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.test(url.hostname))) return null
    if (url.pathname !== '/' || url.username || url.password) return null
    return url
  } catch { return null }
}

/** A body read up to a limit, or null when it runs past it. */
const capped = async (res: Response, limit: number): Promise<Uint8Array | null> => {
  if (Number(res.headers.get('content-length') ?? 0) > limit) return null
  const reader = res.body?.getReader()
  if (!reader) { const bytes = new Uint8Array(await res.arrayBuffer()); return bytes.byteLength > limit ? null : bytes }
  const parts: Uint8Array[] = []; let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel().catch(() => {}); return null }
    parts.push(value)
  }
  const out = new Uint8Array(size); let at = 0
  for (const part of parts) { out.set(part, at); at += part.byteLength }
  return out
}

const within = <T>(read: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([read, new Promise<T>(done => setTimeout(() => done(fallback), TIMEOUT_MS))])

/** Is this address bound to the lineage, the way the host worker binds it (resolveSite + opensOn)? */
const boundTo = (host: string, lineage: string, index: { addresses?: Record<string, string>; doors?: Record<string, string[]> }): boolean => {
  const own = index.addresses?.[host]
  if (own !== undefined ? own !== lineage : !host.startsWith(lineage.toLowerCase() + '.')) return false
  const doors = index.doors?.[lineage]
  if (doors === undefined) return true   // an index signed before doors existed opens as it did then
  return Array.isArray(doors) && doors.some(z => { const zone = String(z ?? '').toLowerCase(); return !!zone && (host === zone || host.endsWith('.' + zone)) })
}

export async function readAddressHead(address: string, deps: AddressHeadDeps = {}): Promise<AddressHead> {
  const url = doorUrlOf(address)
  if (!url) return { error: 'not-an-address' }
  const get = deps.fetch ?? fetch
  const host = url.hostname.toLowerCase()
  const location = await SignatureService.sign(new TextEncoder().encode(host).buffer as ArrayBuffer)
  const base = `${url.origin}/content/${location}/`

  let record: Record<string, unknown>
  try {
    const listing = await get(base, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!listing.ok) return { error: listing.status === 404 ? 'no-door' : 'unreachable' }
    const names = await capped(listing, MAX_LISTING)
    if (!names) return { error: 'no-door' }
    const marker = new TextDecoder().decode(names).split(/\r?\n/).filter(name => /^\d{8}$/.test(name)).sort().at(-1)
    if (!marker) return { error: 'no-door' }
    const res = await get(base + marker, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { error: res.status === 404 ? 'no-door' : 'unreachable' }
    const bytes = await capped(res, MAX_RECORD)
    if (!bytes) return { error: 'no-door' }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'no-door' }
    record = parsed as Record<string, unknown>
  } catch (e) { return { error: e instanceof SyntaxError ? 'no-door' : 'unreachable' } }

  const head = String(record['layer'] ?? '').toLowerCase()
  const pubkey = String(record['pubkey'] ?? '').toLowerCase()
  const lineage = String(record['lineage'] ?? '')
  if (!SIG.test(head) || !SIG.test(pubkey) || !lineage) return { error: 'no-door' }

  // the host's word, held against the publisher's signed index
  const index = await within((deps.index ?? fetchHiveIndex)(url.host, pubkey).catch((): HiveIndexResult => ({ ok: false, reason: 'unreachable' })),
    { ok: false, reason: 'unreachable' } as HiveIndexResult)
  if (!index.ok) return { error: index.reason === 'unreachable' || (index.reason === 'http' && (index.status ?? 0) >= 500) ? 'unreachable' : 'unverified' }
  if (String(index.manifest.roots[lineage] ?? '').toLowerCase() !== head) return { error: 'unverified' }
  if (!boundTo(host, lineage, index.manifest)) return { error: 'unverified' }

  const title = typeof record['title'] === 'string' ? record['title'].trim().slice(0, 120) : ''
  return { head, pubkey, lineage, title, host: url.host, publishedAt: Number(index.manifest.createdAt) || 0 }
}

/** Bytes by signature, read from one host only (the card's own) and checked against the name. Nothing about the
 *  host is remembered: reading a card you hold never makes its host a source for anything else. */
export async function readFromHost(host: string, sig: string, deps: { fetch?: typeof fetch } = {}): Promise<Uint8Array | null> {
  const s = String(sig ?? '').toLowerCase()
  if (!SIG.test(s)) return null
  const bare = String(host ?? '').toLowerCase()
  const scheme = LOOPBACK.test(bare.replace(/:\d+$/, '')) ? 'http' : 'https'
  const get = deps.fetch ?? fetch
  for (const path of [`/${s}`, `/content/${s}`]) {
    try {
      const res = await get(`${scheme}://${bare}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) continue
      const bytes = await capped(res, MAX_BYTES)
      if (!bytes) return null
      if (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) === s) return bytes
      return null
    } catch { /* the next path, or nothing */ }
  }
  return null
}
