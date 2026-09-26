// sharing/code-trust.ts
//
// WHOSE CODE MAY RUN HERE — one consent, one pool of meaning (jwize
// 2026-09-25: "use pools of meaning or they are not extendable").
//
// Two gates used to keep two browser-only lists for the same consent: the
// activation prompt (TrustService, `hc:community:domains`) and the host
// directory's "their code from then on" (`hc:hosts:code-trusted`). Both answer
// one question — may this domain's code run your hive — so both now write the
// `trust:code` pool: one record per domain, named by its own content, exactly
// like a community host. The pool IS the set.
//
// THE SYNC CACHE. Every gate reads synchronously, and several live below this
// package (the service worker's domain list, the shell's TrustService), so
// `hc:community:domains` stays the read cache they already read. Writes go to
// both; `reconcileCodeTrust` (sharing.boot.drone.ts, once the store is up)
// unions the pool and the cache into each other, so a cleared browser gets
// its consents back from the pool and an older writer's cache-only entry is
// backfilled. The host directory's own list drains in once and is removed —
// a withdrawn consent must not come back from a key nobody writes.
//
// Withdrawing (`trust remove <domain>`) takes the domain out of both.

import { SignatureService } from '@hypercomb/core'

export const CODE_TRUST_MEANING = 'trust:code'
/** The synchronous read cache. Its name is older than the pool. */
export const CODE_TRUST_CACHE_KEY = 'hc:community:domains'
/** The host directory's former list: a drain source, read once. */
const LEGACY_HOST_TRUST_KEY = 'hc:hosts:code-trusted'
const RECORD_KIND = 'trust:code'
const STORE_KEY = '@hypercomb.social/Store'

type PoolStore = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }

/** Scheme, trailing slash and case folded out — the shape TrustService reads. */
export const trustDomain = (raw: unknown): string =>
  String(raw ?? '').trim().replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()

const readList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.map(trustDomain).filter(Boolean) : []
  } catch { return [] }
}

const writeCache = (domains: Iterable<string>): void => {
  try { localStorage.setItem(CODE_TRUST_CACHE_KEY, JSON.stringify([...new Set(domains)])) } catch { /* private mode — the pool still holds it */ }
}

const encoder = new TextEncoder()
/** The record's exact bytes: it is named by them and written as them. */
const recordBytes = (domain: string): ArrayBuffer => {
  const bytes = encoder.encode(JSON.stringify({ kind: RECORD_KIND, domain }))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
const recordName = (domain: string): Promise<string> => SignatureService.sign(recordBytes(domain))

const pool = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const store = (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(STORE_KEY) as PoolStore | undefined
    return (await store?.getPool?.(CODE_TRUST_MEANING)) ?? null
  } catch { return null }
}

const writeRecord = async (dir: FileSystemDirectoryHandle, domain: string): Promise<void> => {
  const handle = await dir.getFileHandle(await recordName(domain), { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(recordBytes(domain)) } finally { await writable.close() }
}

const readPool = async (dir: FileSystemDirectoryHandle): Promise<Set<string>> => {
  const out = new Set<string>()
  try {
    for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== 'file') continue
      try {
        const record = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as { kind?: unknown; domain?: unknown }
        const domain = record?.kind === RECORD_KIND ? trustDomain(record.domain) : ''
        if (domain) out.add(domain)
      } catch { /* not a record — skip it */ }
    }
  } catch { /* unreadable pool — treat as empty */ }
  return out
}

/** The trusted domains, synchronously — the cache every gate reads. */
export const trustedCodeDomains = (): Set<string> => new Set(readList(CODE_TRUST_CACHE_KEY))

/** Trust a domain's code. The cache is written first, so the gate that asked
 *  sees the answer at once; the pool record follows. Returns the domain. */
export async function trustCode(raw: unknown): Promise<string> {
  const domain = trustDomain(raw)
  if (!domain) return ''
  const cached = readList(CODE_TRUST_CACHE_KEY)
  if (!cached.includes(domain)) writeCache([...cached, domain])
  const dir = await pool()
  if (dir) { try { await writeRecord(dir, domain) } catch { /* the next reconcile backfills it */ } }
  return domain
}

/** Withdraw a domain's code trust from the pool and the cache together. With
 *  no pool it changes nothing — a cache-only removal would come back on the
 *  next reconcile. True when the domain is no longer trusted. */
export async function untrustCode(raw: unknown): Promise<boolean> {
  const domain = trustDomain(raw)
  if (!domain) return false
  const dir = await pool()
  if (!dir) return false
  try { await dir.removeEntry(await recordName(domain)) } catch { /* no record — the cache may still hold it */ }
  const cached = readList(CODE_TRUST_CACHE_KEY)
  if (cached.includes(domain)) writeCache(cached.filter(d => d !== domain))
  return true
}

/** Union the pool, the cache and the drained host-directory list into each
 *  other. Returns how many domains are trusted. */
export async function reconcileCodeTrust(): Promise<number> {
  const dir = await pool()
  const cached = readList(CODE_TRUST_CACHE_KEY)
  const legacy = readList(LEGACY_HOST_TRUST_KEY)
  if (!dir) return cached.length
  const held = await readPool(dir)
  const all = new Set([...cached, ...held, ...legacy])
  if (all.size > cached.length) writeCache([...cached, ...[...all].filter(d => !cached.includes(d))])
  let backfilled = true
  for (const domain of all) {
    if (held.has(domain)) continue
    try { await writeRecord(dir, domain) } catch { backfilled = false }
  }
  if (legacy.length && backfilled) { try { localStorage.removeItem(LEGACY_HOST_TRUST_KEY) } catch { /* drains next boot */ } }
  return all.size
}
