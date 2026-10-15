// sharing/room-pool.service.ts
//
// THE ROOM POOL, CLIENT SIDE (documentation/swarm-pools.md, step two).
//
// A swarm room is a pool on the room's host — the host field, the meeting
// point. Presence stays on the relay; the pool is what stays:
//
//   WRITE  when a relay takes this tab's word for a page (the exact page-event
//          content it shares there), the word goes to the room's host as an
//          atom, and a signed member points at it — `['head', sha256(word)]`
//          on `['page', <room page sig>]`. Once per changed word, settled for
//          a moment so a burst of edits is one member.
//   READ   on joining (and on demand) the pool's listing is read, every new
//          member fetched and verified, and the newest member per signer per
//          page stands. Template-first ordering arrives with the template
//          (step three); presence still decides what the room shows.
//
// The address holds the room's secret; it is derived here and never goes
// through the pool registry. A dependency: the drone (room-pool.drone.ts)
// registers it.

import { EffectBus } from '@hypercomb/core'
import { isJoinedHere } from './membership.js'
import { isLoopbackHost } from './zone-door.js'
import { nip98Header } from './hive-pointer.js'
import { listingNames, memberTemplate, readMember, roomPoolAddress, standingMembers, type RoomMember } from './room-pool.js'

export const ROOM_POOL_KEY = '@diamondcoreprocessor.com/RoomPool'

/** A burst of edits on one page settles into one member. */
const SETTLE_MS = 4_000
const FETCH_MS = 8_000

type SwarmShape = { takenWord?: (sig: string) => string | null }
type MeshShape = { swarmHost?: () => string }
type HostSyncShape = { putOne?: (host: string, sig: string, bytes: Uint8Array) => Promise<{ ok: boolean }> }
type CredentialShape = { value?: string }
type SignerShape = { signEvent: (evt: Record<string, unknown>) => Promise<Record<string, unknown>> }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))]
    .map(b => b.toString(16).padStart(2, '0')).join('')

export type ShareOutcome = 'written' | 'unchanged' | 'no-room' | 'no-word' | 'refused' | 'unreachable'

export class RoomPool extends EventTarget {
  #members = new Map<string, RoomMember>()
  #poolOfMembers = ''
  #written = new Map<string, string>()          // page sig → head of the member written
  #timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor() {
    super()
    EffectBus.on<{ sig?: string }>('swarm:page-announced', (p) => {
      const sig = String(p?.sig ?? '')
      if (/^[0-9a-f]{64}$/.test(sig)) this.#settle(sig)
    })
    EffectBus.on('swarm:zone-complete', () => { void this.read() })
  }

  /** The current room's host (the meeting point), or ''. */
  host(): string {
    try { return String(get<MeshShape>('@diamondcoreprocessor.com/NostrMeshDrone')?.swarmHost?.() ?? '').trim() } catch { return '' }
  }

  /** The current room's pool address, or '' outside a complete room. */
  async address(): Promise<string> {
    const room = get<CredentialShape>('@hypercomb.social/RoomStore')?.value ?? ''
    const secret = get<CredentialShape>('@hypercomb.social/SecretStore')?.value ?? ''
    const host = this.host()
    if (!room || !secret || !host) return ''
    return roomPoolAddress(room, secret, host)
  }

  /** What stands in the pool as last read: the newest member per signer per page. */
  standing(): RoomMember[] { return standingMembers(this.#members.values()) }

  /** Put this tab's word for the page at `pageSig` into the room pool. */
  async share(pageSig: string): Promise<ShareOutcome> {
    if (!isJoinedHere()) return 'no-room'
    const host = this.host()
    const pool = await this.address()
    if (!host || !pool) return 'no-room'
    const word = get<SwarmShape>('@diamondcoreprocessor.com/SwarmDrone')?.takenWord?.(pageSig)
    if (!word) return 'no-word'
    const bytes = new TextEncoder().encode(word)
    const head = await sha256(bytes)
    if (this.#written.get(pageSig) === head) return 'unchanged'

    // The word first, as an atom on the room's host — a member never names
    // bytes the host does not hold.
    const put = await get<HostSyncShape>('@diamondcoreprocessor.com/HostSyncService')?.putOne?.(host, head, bytes)
    if (!put?.ok) return 'refused'

    const signer = get<SignerShape>('@diamondcoreprocessor.com/NostrSigner')
    if (!signer) return 'refused'
    let body: Uint8Array
    try { body = new TextEncoder().encode(JSON.stringify(await signer.signEvent(memberTemplate(pool, pageSig, head)))) } catch { return 'refused' }
    const name = await sha256(body)
    const url = `${this.#base(host)}/${pool}/${name}`
    const auth = await nip98Header(signer as never, url, 'PUT')
    if (!auth) return 'refused'
    try {
      const res = await fetch(url, { method: 'PUT', headers: { Authorization: auth }, body: body.slice().buffer as ArrayBuffer, signal: AbortSignal.timeout(FETCH_MS) })
      if (!res.ok) return 'refused'
    } catch { return 'unreachable' }

    this.#written.set(pageSig, head)
    const member = await readMember(pool, name, body)
    if (member && this.#poolOfMembers === pool) this.#members.set(name, member)
    this.dispatchEvent(new CustomEvent('change'))
    return 'written'
  }

  /** Read the room pool from its host: every member not yet held, verified.
   *  Returns what stands. Quiet on any failure — the room still works live. */
  async read(): Promise<RoomMember[]> {
    const host = this.host()
    const pool = await this.address()
    if (!host || !pool) return []
    if (pool !== this.#poolOfMembers) { this.#members.clear(); this.#poolOfMembers = pool }
    const base = this.#base(host)
    let names: string[] = []
    try {
      const res = await fetch(`${base}/${pool}/`, { signal: AbortSignal.timeout(FETCH_MS) })
      if (!res.ok) return this.standing()
      names = listingNames(await res.text())
    } catch { return this.standing() }
    let changed = false
    await Promise.all(names.filter(n => !this.#members.has(n)).map(async (name) => {
      try {
        const res = await fetch(`${base}/${pool}/${name}`, { signal: AbortSignal.timeout(FETCH_MS) })
        if (!res.ok) return
        const member = await readMember(pool, name, new Uint8Array(await res.arrayBuffer()))
        if (member) { this.#members.set(name, member); changed = true }
      } catch { /* a member that does not arrive is not read */ }
    }))
    if (changed) this.dispatchEvent(new CustomEvent('change'))
    return this.standing()
  }

  #settle(pageSig: string): void {
    const held = this.#timers.get(pageSig)
    if (held) clearTimeout(held)
    this.#timers.set(pageSig, setTimeout(() => {
      this.#timers.delete(pageSig)
      void this.share(pageSig)
    }, SETTLE_MS))
  }

  #base(host: string): string {
    return `${isLoopbackHost(host) ? 'http' : 'https'}://${host}`
  }
}
