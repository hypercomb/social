// sharing/host-welcome.ts
//
// A ZONE'S CARD — what a front door calls itself — as a pool of meaning.
//
// A host card used to take its name from `welcome.json`, a file staged next to
// the shim. Every zone a worker fronts shares that one origin, so the file could
// only ever name all of them at once, and only whoever could deploy it could
// change it. The card is an atom instead — `{ title, tagline, links }`, carrying
// the zone it names — sent to the host under the participant's key and named in
// their signed index as `welcome:<zone>`. The host gathers every card ever named
// into the pool sign('welcome:<zone>') (hypercomb-relay worker.js
// noteSharedPools), so the history only grows and replicates like any pool,
// and the front door wears the one the zone's own publishers sign now
// (worker.js welcomeCard). jwize 2026-10-07: "it is extensible if it uses
// pools, otherwise it is not".
//
// A CARD MAY CARRY THE ROOM (jwize 2026-10-24: "the way to host a swarm should
// be a link on the home page at the top of a domain … That way we can
// obfuscate the location and password"). `swarm` is a sealed swarm link
// (swarm-link.ts, #swarm=<sig>@<host>~<key>): the front door draws it as "Join
// the swarm" at its top. It is PUBLIC BY DESIGN — whoever opens the page holds
// the link, so whoever opens the page can join. It hides the room and its
// secret from the address bar and the page text; it does not keep them. `room
// host <domain>` sets it from inside the room, `room host off <domain>` takes
// it down, and a card's history is never deleted — so closing the room for good
// is changing its secret.

import { SignatureService } from '@hypercomb/core'
import { fetchHiveIndex, setHiveRoot, type HiveIndexResult } from './hive-pointer.js'
import { HOST_DOOR_LABEL } from './zone-door.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

/** The index key — and the pool's meaning — for one zone's card. */
export const welcomeKey = (zone: string): string => `welcome:${zone}`

const DOOR_PREFIX = `${HOST_DOOR_LABEL}.`

/** A zone as a card names it: a bare lower-case domain, or '' when it is not
 *  one. The door at host.<zone> reads <zone>'s card (worker.js
 *  serveFrontDoor), so a card for host.<zone> would never be read: it names
 *  <zone>. */
export const welcomeZone = (raw: unknown): string => {
  const zone = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(zone)) return ''
  return zone.startsWith(DOOR_PREFIX) && zone.slice(DOOR_PREFIX.length).includes('.') ? zone.slice(DOOR_PREFIX.length) : zone
}

/** The one shape of link a card may carry as its room: a sealed swarm link
 *  (swarm-link.ts swarmLinkText) on an https page. The worker and the shim
 *  hold a card to the same shape (worker.js WELCOME_SWARM_RE, shim welcome.ts). */
export const WELCOME_SWARM_RE = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\/#swarm=[0-9a-f]{64}@[a-z0-9.:[\]-]+~[A-Za-z0-9_-]{43}$/

/** A card's room link as it may be carried, or '' when it is not that shape. */
export const welcomeSwarm = (raw: unknown): string => {
  const link = String(raw ?? '').trim()
  return WELCOME_SWARM_RE.test(link) ? link : ''
}

/** The card's bytes: canonical, so the same words always land on the same
 *  signature — and a card without a room is the same bytes it always was. */
export const welcomeCardBytes = (zone: string, title: string, tagline: string, swarm = ''): Uint8Array => {
  const room = welcomeSwarm(swarm)
  return new TextEncoder().encode(JSON.stringify({
    kind: 'host:welcome',
    zone,
    title: title.trim().slice(0, 60),
    tagline: tagline.trim().slice(0, 400),
    links: [],
    ...(room ? { swarm: room } : {}),
  }))
}

/** What a card says, read back. */
export type WelcomeCard = { readonly title: string; readonly tagline: string; readonly swarm: string }

/** The participant's own card for a zone, as far as it could be read: a card,
 *  none at all, or unknown — and unknown is never taken for none, so a word
 *  that sets one field never writes blanks over a card it could not read. */
export type OwnWelcome =
  | { readonly state: 'card'; readonly card: WelcomeCard }
  | { readonly state: 'none' }
  | { readonly state: 'unknown'; readonly reason: string }

const SIG_RE = /^[0-9a-f]{64}$/
const LOOPBACK_ZONE_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i

export type ReadOwnWelcomeDeps = {
  publicKey?: () => Promise<string | null>
  fetchIndex?: (host: string, pubkey: string) => Promise<HiveIndexResult>
  /** The card's bytes; 'gone' when the host answers that it holds none. */
  readBytes?: (host: string, sig: string) => Promise<Uint8Array | 'gone' | null>
}

/** A card's bytes from its host, checked against their signature. 'gone'
 *  when every place the host keeps bytes answers 404 — the host holds no such
 *  card, so a fresh one loses nothing it still has. null when it could not tell. */
export async function cardOnHost(host: string, sig: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | 'gone' | null> {
  const bare = host.toLowerCase()
  const scheme = LOOPBACK_ZONE_RE.test(bare) ? 'http' : 'https'
  let gone = 0
  for (const path of [`/${sig}`, `/content/${sig}`]) {
    try {
      const response = await fetchImpl(`${scheme}://${bare}${path}`, { signal: AbortSignal.timeout(8_000) })
      if (response.status === 404) { gone++; continue }
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength <= 64 * 1024 && await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) === sig) return bytes
    } catch { /* the next place, or not knowing */ }
  }
  return gone === 2 ? 'gone' : null
}

/** The card this participant signs for `zone` on `host` now — so setting one
 *  field keeps the others. */
export async function readOwnWelcome(host: string, zone: string, deps: ReadOwnWelcomeDeps = {}): Promise<OwnWelcome> {
  const publicKey = deps.publicKey
    ?? (() => get<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.() ?? Promise.resolve(null))
  const pubkey = String((await publicKey().catch(() => null)) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { state: 'unknown', reason: 'this hive has no signing key' }
  const index = await (deps.fetchIndex ?? fetchHiveIndex)(host, pubkey).catch(() => ({ ok: false, reason: 'unreachable' }) as HiveIndexResult)
  if (!index.ok) {
    // No index on the host yet is no card; anything else is not knowing.
    return index.reason === 'http' && index.status === 404 ? { state: 'none' } : { state: 'unknown', reason: `the index on ${host} could not be read` }
  }
  const sig = String(index.manifest.roots[welcomeKey(zone)] ?? '').toLowerCase()
  if (!SIG_RE.test(sig)) return { state: 'none' }
  const bytes = await (deps.readBytes ?? cardOnHost)(host, sig).catch(() => null)
  // A card the host no longer holds is no card: a word may sign a fresh one.
  if (bytes === 'gone') return { state: 'none' }
  if (!bytes) return { state: 'unknown', reason: `the card on ${host} could not be read` }
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    if (record?.['kind'] !== 'host:welcome' || record['zone'] !== zone) return { state: 'unknown', reason: 'the card named there is not this zone\'s card' }
    return {
      state: 'card',
      card: {
        title: String(record['title'] ?? '').trim().slice(0, 60),
        tagline: String(record['tagline'] ?? '').trim().slice(0, 400),
        swarm: welcomeSwarm(record['swarm']),
      },
    }
  } catch { return { state: 'unknown', reason: 'the card named there is not readable' } }
}

/** What a domain's front page itself shows — read back from the page, because
 *  a signed card only reaches a page the worker fronts, and only when its
 *  publishers' order puts it there. `card: false` when the page carries no
 *  signed card at all: its own site (an origin host), or a door none of its
 *  publishers' cards reaches. */
export type FrontPageRoom =
  | { readonly read: true; readonly card: boolean; readonly swarm: string }
  | { readonly read: false }

const CARRIED_RE = /<script id="hc-welcome" type="application\/json">([^<]*)<\/script>/

export async function frontPageRoom(domain: string, fetchImpl: typeof fetch = fetch): Promise<FrontPageRoom> {
  const scheme = LOOPBACK_ZONE_RE.test(domain) ? 'http' : 'https'
  try {
    const response = await fetchImpl(`${scheme}://${domain}/`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return { read: false }
    const carried = CARRIED_RE.exec(await response.text())
    if (!carried) return { read: true, card: false, swarm: '' }
    const card = JSON.parse(carried[1]!) as Record<string, unknown>
    return { read: true, card: true, swarm: welcomeSwarm(card?.['swarm']) }
  } catch { return { read: false } }
}

/** Where a zone's card shows, read back: its front page, else its door at
 *  host.<zone> — where the card answers when the apex is its own site, opens
 *  on a creation (zone-door.ts APEX_LABEL), or will not answer a hive's read.
 *  No card seen is an answer only when both pages answered: a page that did
 *  not may be the one that carries it, and `at` then names that page. */
export async function shownRoom(domain: string, fetchImpl: typeof fetch = fetch): Promise<{ at: string; page: FrontPageRoom }> {
  const apex = await frontPageRoom(domain, fetchImpl)
  if (apex.read && apex.card) return { at: domain, page: apex }
  const at = `${DOOR_PREFIX}${domain}`
  const door = await frontPageRoom(at, fetchImpl)
  if (door.read && door.card) return { at, page: door }
  if (apex.read && door.read) return { at: domain, page: apex }
  return { at: apex.read ? at : domain, page: { read: false } }
}

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

/** Send the card to `host` and name it in the signed index as `welcome:<zone>`. */
export async function publishWelcome(host: string, zone: string, title: string, tagline: string, swarm = ''): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> {
  const bytes = welcomeCardBytes(zone, title, tagline, swarm)
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? bytes : null))
  if (!sent.ok) return { ok: false, reason: sent.error }
  const stamped = await setHiveRoot(host, welcomeKey(zone), sig)
  return stamped.ok ? { ok: true, sig } : { ok: false, reason: stamped.reason ?? 'the index refused it' }
}
