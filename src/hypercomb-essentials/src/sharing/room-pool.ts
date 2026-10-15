// sharing/room-pool.ts
//
// A SWARM ROOM IS A POOL (documentation/swarm-pools.md). This is its pure
// half — the address, a member's shape, how a member is checked, and which
// members stand — shared by the service and its spec. No store, no network.
//
//   address  sign('swarm:' + roomPreimage(room, secret, host)). It holds the
//            room's secret, so it cannot be guessed: whoever asks it was
//            given it. NEVER derived through the pool registry — the registry
//            keeps every meaning it derives in a list anyone can read, and
//            this meaning carries the secret.
//   member   a nostr event, kind ROOM_MEMBER_KIND, signed by one key, tagged
//            ['pool', <address>] ['head', <sig of what it shares>]
//            ['page', <the room page's sig>], and named on the host by the
//            sha256 of its exact bytes. Flat — no author folders.

import { roomPreimage, SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'

export const ROOM_MEMBER_KIND = 30567

const SIG = /^[0-9a-f]{64}$/
const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

/** A member as read: who claims what, on which room page, when. */
export interface RoomMember {
  readonly name: string
  readonly signer: string
  readonly head: string
  readonly page: string
  readonly at: number
}

type MemberEvent = { kind?: unknown; pubkey?: unknown; created_at?: unknown; tags?: unknown; id?: unknown; sig?: unknown; content?: unknown }

/** The room's pool address, or '' when the room is not complete (no host). */
export async function roomPoolAddress(room: string, secret: string, host: unknown): Promise<string> {
  const preimage = roomPreimage(room, secret, host)
  if (!preimage) return ''
  return SignatureService.sign(utf8('swarm:' + preimage))
}

/** The unsigned member a key signs: this room, this page, this head. */
export function memberTemplate(pool: string, page: string, head: string, at = Math.floor(Date.now() / 1000)) {
  return {
    kind: ROOM_MEMBER_KIND,
    created_at: at,
    tags: [['pool', pool], ['head', head], ['page', page]],
    content: '',
  }
}

const tag = (evt: MemberEvent, name: string): string => {
  const tags = Array.isArray(evt.tags) ? evt.tags : []
  const hit = tags.find((t): t is unknown[] => Array.isArray(t) && t[0] === name)
  return String(hit?.[1] ?? '').toLowerCase()
}

/** A member's bytes as the member they are, or null: they must hash to their
 *  name, be a room member of THIS pool naming a head and a page, and carry a
 *  valid signature. `verify` is injectable for the spec. */
export async function readMember(
  pool: string,
  name: string,
  bytes: Uint8Array,
  verify: (evt: unknown) => boolean = (evt) => verifyEvent(evt as Parameters<typeof verifyEvent>[0]),
): Promise<RoomMember | null> {
  if (!SIG.test(name) || bytes.byteLength > 4096) return null
  if (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) !== name) return null
  let evt: MemberEvent
  try { evt = JSON.parse(new TextDecoder().decode(bytes)) as MemberEvent } catch { return null }
  if (Number(evt?.kind) !== ROOM_MEMBER_KIND || tag(evt, 'pool') !== pool) return null
  const head = tag(evt, 'head')
  const page = tag(evt, 'page')
  if (!SIG.test(head) || !SIG.test(page)) return null
  try { if (!verify(evt)) return null } catch { return null }
  return { name, signer: String(evt.pubkey ?? '').toLowerCase(), head, page, at: Number(evt.created_at) || 0 }
}

/** The names in a host's pool listing — newline text, one 64-hex per line.
 *  A page (HTML) or anything else yields nothing. */
export function listingNames(text: string): string[] {
  return String(text ?? '').split('\n').map(line => line.trim().toLowerCase()).filter(line => SIG.test(line))
}

/** What stands: each signer's newest member per page. Older members stay on
 *  the host (history never heals); readers take the newest. */
export function standingMembers(members: Iterable<RoomMember>): RoomMember[] {
  const newest = new Map<string, RoomMember>()
  for (const m of members) {
    const key = `${m.signer}\0${m.page}`
    const held = newest.get(key)
    if (!held || m.at > held.at || (m.at === held.at && m.name > held.name)) newest.set(key, m)
  }
  return [...newest.values()].sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1))
}
