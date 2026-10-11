// hypercomb-shared/core/room-store.ts
// Room state — THIS tab's, with the origin-wide localStorage key as the
// pre-fill for a new tab. On first access, an explicit ZONE HOST's subdomain
// pre-fills the room (never the secret).
//
// The tab's own zone (sessionStorage `hc:mesh-zone`, mesh-session.ts) wins:
// a reload comes back in the room this tab was in, whatever another tab
// wrote since. A set() records the room in both places; setting the value it
// already holds does nothing at all — no write, no 'change' (the swarm tears
// down and resyncs on 'change', and a no-op save used to send a {left}).
//
// ONE TEXT, ONE ZONE: a room set here is entered text and is folded by core's
// canonicalZoneText (a zero-width space, a full-width IME, a smart quote or a
// doubled space no longer splits a room in two). A room this tab already
// holds — resumed, or saved again unchanged — is kept exactly as recorded.

import { canonicalZoneText } from '@hypercomb/core'
import { readMeshZone, writeMeshZone } from './mesh-session'

const KEY = 'hc:room'

/** The hosts whose subdomain names a room: `<room>.<zone host>`. Any other
 *  multi-label origin — business-card.jwize.com, a *.pages.dev deployment —
 *  is somebody's address, never a room every visitor would share. */
const ZONE_HOSTS: readonly string[] = ['hypercomb.io']
/** Labels that are a host's own, never a room. */
const NOT_A_ROOM = new Set(['www'])

export class RoomStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if nothing is stored, try a zone host's subdomain
    if (!this.#value) {
      const extracted = RoomStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  /** `exact`: the room a link carries — an exact zone, never entered text —
   *  is recorded as carried, so the guest lands where the inviter is (a
   *  recorded, pre-fold room included). */
  public set = (room: string, exact = false): void => {
    const typed = (room ?? '').trim()
    // The room this tab holds, typed again, stays exactly as recorded.
    if (typed === this.#value) return
    const clean = exact ? typed : canonicalZoneText(typed)
    if (clean === this.#value) return
    this.#value = clean
    this.#write(clean)
    writeMeshZone({ room: clean })
    this.dispatchEvent(new Event('change'))
  }

  public clear = (): void => {
    this.set('')
  }

  // ── subdomain extraction ──────────────────────────────

  /**
   * Extracts the room from the hostname on a ZONE HOST's subdomain.
   * e.g. "myroom.hypercomb.io" → "myroom"
   *      "deep.path.hypercomb.io" → "deep.path"
   *      "www.hypercomb.io" → "" (the host's own label)
   *      "business-card.jwize.com" → "" (not a zone host)
   *      "localhost" → "" (no subdomain)
   *      "hypercomb.io" → "" (bare domain)
   */
  static extractSubdomain = (): string => {
    const host = (window.location.hostname ?? '').toLowerCase().trim().replace(/\.$/, '')
    const zone = ZONE_HOSTS.find(z => host.endsWith(`.${z}`))
    if (!zone) return ''
    const sub = host.slice(0, -(zone.length + 1))
    return sub && !NOT_A_ROOM.has(sub) ? sub : ''
  }

  // ── storage ───────────────────────────────────────────

  /** The tab's own room first, else the origin-wide one. */
  #read = (): string => {
    const own = readMeshZone()?.room
    if (typeof own === 'string') return own.trim()
    try { return (localStorage.getItem(KEY) ?? '').trim() } catch { return '' }
  }

  #write = (v: string): void => {
    try {
      if (v) localStorage.setItem(KEY, v)
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
  }
}

register('@hypercomb.social/RoomStore', new RoomStore())
