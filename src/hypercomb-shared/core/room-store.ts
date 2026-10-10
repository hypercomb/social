// hypercomb-shared/core/room-store.ts
// Room state — THIS tab's, with the origin-wide localStorage key as the
// pre-fill for a new tab. On first access, captures any subdomain-derived
// room from the URL.
//
// The tab's own zone (sessionStorage `hc:mesh-zone`, mesh-session.ts) wins:
// a reload comes back in the room this tab was in, whatever another tab
// wrote since. A set() records the room in both places; setting the value it
// already holds does nothing at all — no write, no 'change' (the swarm tears
// down and resyncs on 'change', and a no-op save used to send a {left}).

import { readMeshZone, writeMeshZone } from './mesh-session'

const KEY = 'hc:room'

export class RoomStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if nothing is stored, try to extract from the current subdomain
    if (!this.#value) {
      const extracted = RoomStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (room: string): void => {
    const clean = (room ?? '').trim()
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
   * Extracts the room from the hostname when on a subdomain.
   * e.g. "myroom.hypercomb.io" → "myroom"
   *      "deep.path.hypercomb.io" → "deep.path"
   *      "localhost" → "" (no subdomain)
   *      "hypercomb.io" → "" (bare domain)
   */
  static extractSubdomain = (): string => {
    const host = (window.location.hostname ?? '').toLowerCase().trim()
    if (!host || host === 'localhost') return ''

    // ip address — no subdomain
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return ''

    const parts = host.split('.')
    // need at least 3 parts: sub.domain.tld
    if (parts.length < 3) return ''

    // strip the last two segments (domain.tld)
    const sub = parts.slice(0, -2).join('.')
    return sub
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
