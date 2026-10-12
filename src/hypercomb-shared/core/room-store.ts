// hypercomb-shared/core/room-store.ts
// Room state — THIS tab's, with the origin-wide localStorage key as the
// pre-fill for a new tab.
//
// NEVER THE PAGE'S ADDRESS (jwize, 2026-10-11: "The domain on the other hand
// should not be used (current address in the browser)"). A zone host's
// subdomain (`myroom.hypercomb.io`) used to pre-fill the room — the page's
// own domain deciding part of a room's identity, its words and its every
// address. The room is only ever what someone typed or a link carried.
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

export class RoomStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
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
