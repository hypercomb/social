// sharing/take-home.ts
//
// TAKE HOME (documentation/swarm-pools.md, step six). A room is entered at the
// host's swarm door — another origin, with its own storage — so what a
// participant collected there lives in THAT hive. Taking it home hands it to
// their own hive by signature, through the paths both already have:
//
//   1. the tile's closure (its layer, its children, its notes and their
//      envelopes, its category tree) is put on the room's host — the host
//      that keeps the room — as flat signed atoms, every one checked against
//      its name (HostSync.publishAtoms);
//   2. a hive-link bundle naming that tile — `{ segments: [tile], rootSig,
//      hosts: [room host], pubkey }` — is put there too, by its signature;
//   3. their own hive opens at `<home>/#take=<bundle sig>@<host>`: it reads
//      the bundle from that host, checks it against its signature, and takes
//      it the way it takes any hive link (hive-visit: offered at the top
//      level, adopted as it is entered).
//
// Nothing is copied that the tile does not name, nothing leaves the device
// but signed public atoms the participant chose to take home, and the home
// address is theirs to name — remembered on this device (`hc:my-hive`, the
// key the visitor door already reads), asked for once.

import { HIVE_LINK_KIND, HIVE_LINK_VERSION, MY_HIVE_KEY, validateHiveLinkBundle, type HiveLinkBundle } from './hive-link.js'
import { nestedSigs } from './nested-sigs.js'

export const TAKE_PREFIX = '#take='
/** The participant's own hive — the key the visitor door already reads. */
export const HOME_KEY = MY_HIVE_KEY
/** A tile is a handful of layers and notes; a cap keeps a walk from running away. */
export const TAKE_CLOSURE_MAX = 4_000
const SIG_RE = /^[0-9a-f]{64}$/
const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/
const LOOPBACK_RE = /^(?:(?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[::1\])(?::\d{1,5})?$/

/** A home address as typed — `hypercomb.io`, `https://jwize.com/`,
 *  `localhost:4250` — as an origin, or '' when it is not one. A loopback home
 *  is `http`, every other `https`. */
export function normalizeHome(raw: unknown): string {
  let text = String(raw ?? '').trim()
  if (!text) return ''
  if (!/^https?:\/\//i.test(text)) {
    const bare = text.replace(/\/.*$/, '').toLowerCase()
    text = `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${text}`
  }
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_RE.test(url.host))) return ''
    return url.origin
  } catch { return '' }
}

/** The take-home link: `<home>/#take=<sig>@<host>`. The fragment never reaches
 *  a server; the host only says where the bundle is fetched from. */
export function takeLinkText(home: string, sig: string, host: string): string {
  return `${home.replace(/\/+$/, '')}/${TAKE_PREFIX}${sig}@${host}`
}

/** Read a take-home fragment (with or without `#take=`), or null. */
export function parseTake(raw: string): { sig: string; host: string } | null {
  let body = String(raw ?? '').trim()
  if (body.startsWith(TAKE_PREFIX)) body = body.slice(TAKE_PREFIX.length)
  else if (body.startsWith('take=')) body = body.slice('take='.length)
  const at = body.indexOf('@')
  if (at < 0) return null
  const sig = body.slice(0, at).toLowerCase()
  const host = decodeURIComponent(body.slice(at + 1)).trim().toLowerCase()
  return SIG_RE.test(sig) && HOST_RE.test(host) ? { sig, host } : null
}

/** The bundle that names a taken tile — a hive link with its head given. */
export function takeBundle(tile: string, rootSig: string, host: string, pubkey: string, at = Date.now()): HiveLinkBundle {
  return { kind: HIVE_LINK_KIND, v: HIVE_LINK_VERSION, segments: [tile], pubkey, hosts: [host], rootSig, createdAt: at }
}

/** Every signature the tile names that this hive holds bytes for, from its
 *  head down — the closure taken home. A name with no bytes here (a lineage
 *  address, a key) is not part of it. */
export async function takeClosure(
  rootSig: string,
  bytesOf: (sig: string) => Promise<Uint8Array | null>,
  max = TAKE_CLOSURE_MAX,
): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const queue = [rootSig]
  while (queue.length && out.length < max) {
    const sig = queue.shift()!
    if (seen.has(sig) || !SIG_RE.test(sig)) continue
    seen.add(sig)
    const bytes = await bytesOf(sig)
    if (!bytes) continue
    out.push(sig)
    if (bytes.length > 256 * 1024) continue
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { continue }
    for (const next of nestedSigs(parsed)) if (!seen.has(next)) queue.push(next)
  }
  return out
}

export function readHome(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): string {
  try { return normalizeHome(storage?.getItem(HOME_KEY) ?? '') } catch { return '' }
}

export function writeHome(home: string, storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null): boolean {
  const origin = normalizeHome(home)
  if (!origin) return false
  try { storage?.setItem(HOME_KEY, origin); return true } catch { return false }
}

/** The taken bundle, read from the room's host by its signature: the bytes
 *  must hash to the name, and be a hive link that names a head. Null on any
 *  failure — a link that cannot be read takes nothing. */
export async function fetchTakeBundle(sig: string, host: string, fetcher: typeof fetch = fetch): Promise<HiveLinkBundle | null> {
  if (!SIG_RE.test(sig) || !HOST_RE.test(host)) return null
  const scheme = LOOPBACK_RE.test(host) ? 'http' : 'https'
  try {
    const res = await fetcher(`${scheme}://${host}/${sig}`, { cache: 'no-store' })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))]
      .map(b => b.toString(16).padStart(2, '0')).join('')
    if (hash !== sig) return null
    const bundle = validateHiveLinkBundle(JSON.parse(new TextDecoder().decode(bytes)))
    return bundle?.rootSig ? bundle : null
  } catch { return null }
}
