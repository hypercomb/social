// room-store.ts — shared room state, single localStorage key. On first
// access, captures any subdomain-derived room from the URL.
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1:
// the contract lives in core (mesh-zone.types.ts); shells reach the instance
// through IoC only to write, and hear values on EffectBus (announced at
// construction + every change — replay makes late chrome safe).

import { EffectBus, ROOM_STORE_KEY, ROOM_CHANGED, type ZoneValueStore } from '@hypercomb/core'

const KEY = 'hc:room'

export class RoomStore extends EventTarget implements ZoneValueStore {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if localStorage is empty, try to extract from the current subdomain
    if (!this.#value) {
      const extracted = RoomStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
    EffectBus.emit(ROOM_CHANGED, { value: this.#value })
  }

  public set = (room: string): void => {
    const clean = (room ?? '').trim()
    this.#value = clean
    this.#write(clean)
    this.dispatchEvent(new Event('change'))
    EffectBus.emit(ROOM_CHANGED, { value: clean })
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

  // ── localStorage ──────────────────────────────────────

  #read = (): string => {
    try { return (localStorage.getItem(KEY) ?? '').trim() } catch { return '' }
  }

  #write = (v: string): void => {
    try {
      if (v) localStorage.setItem(KEY, v)
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
  }
}

export const roomStore = new RoomStore()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureRoomStoreRegistered = (): void => {
  if (!window.ioc?.has?.(ROOM_STORE_KEY)) {
    window.ioc?.register?.(ROOM_STORE_KEY, roomStore)
  }
}
ensureRoomStoreRegistered()
