// hypercomb-shared/core/secret-store.ts
// Secret state — THIS tab's, with the origin-wide localStorage key as the
// pre-fill for a new tab.
//
// The tab's own zone (sessionStorage `hc:mesh-zone`, mesh-session.ts) wins:
// a reload comes back with the secret this tab joined with, whatever another
// tab wrote since. A set() records it in both places; setting the value it
// already holds does nothing at all — no write, no 'change' (the swarm tears
// down and resyncs on 'change', and a no-op save used to send a {left}).
//
// A SECRET IS NEVER READ OFF THE ADDRESS BAR. It used to be seeded from the
// subdomain, so every visitor of business-card.<domain> (or any *.pages.dev
// deployment) shared one zone whose "secret" was the public host name — and
// `join` went straight in, the pair being complete. Only a person (the
// selector, a link, `use-live-relay`) gives a secret; the loopback dev
// default in runtime-initializer still respects an explicit clear.
//
// ONE TEXT, ONE ZONE: a secret set here is entered text and is folded by
// core's canonicalZoneText; one this tab already holds is kept as recorded.

import { canonicalZoneText } from '@hypercomb/core'
import { readMeshZone, writeMeshZone } from './mesh-session'

const KEY = 'hc:secret'
const CLEARED_KEY = 'hc:secret-cleared'

export class SecretStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
  }

  /** `exact`: the secret a link carries is recorded as carried (an exact
   *  zone, never entered text). */
  public set = (secret: string, exact = false): void => {
    const typed = (secret ?? '').trim()
    // The secret this tab holds, typed again, stays exactly as recorded.
    if (typed === this.#value) return
    const clean = exact ? typed : canonicalZoneText(typed)
    if (clean === this.#value) return
    this.#value = clean
    this.#write(clean)
    this.#markCleared(!clean)
    writeMeshZone({ secret: clean })
    this.dispatchEvent(new Event('change'))
  }

  /** Clearing is an explicit choice even when there is nothing to clear: it
   *  is remembered, so no default is seeded over it later. */
  public clear = (): void => {
    if (!this.#value) { this.#markCleared(true); return }
    this.set('')
  }

  #markCleared = (cleared: boolean): void => {
    try {
      if (cleared) localStorage.setItem(CLEARED_KEY, '1')
      else localStorage.removeItem(CLEARED_KEY)
    } catch { /* ignore */ }
  }

  // ── storage ───────────────────────────────────────────

  /** The tab's own secret first, else the origin-wide one. */
  #read = (): string => {
    const own = readMeshZone()?.secret
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

register('@hypercomb.social/SecretStore', new SecretStore())
