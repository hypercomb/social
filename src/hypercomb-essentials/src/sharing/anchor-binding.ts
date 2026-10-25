// sharing/anchor-binding.ts
//
// WHICH ANCHOR THIS DEVICE PUBLISHES FOR (becoming-a-host.md, "Letting another
// place publish for you"). Every place makes its own key; the anchor is the key
// everything already names the participant by. A device that has taken an invite
// holds its own key AND this binding, and from then on its publishes are the
// anchor's. A device with no binding is its own anchor, exactly as before.
//
// ONE DOCUMENT, ONE POOL: `keys:binding` — colon-scoped, kind document, per
// participant, NEVER replicated. It must not travel: a device that merely
// synced a binding would publish as an anchor whose list does not name its key.
// Admission is the signed list, and only taking an invite writes this.
//
// NOT A SECRET. The anchor is a public key and `sources` are hosts that hold
// its list, so this is an ordinary participant document, never the signer's
// storage (the doctrine ratchet keeps browser keys for credentials only).
//
// Side-effect free: keys.queen.ts constructs the one instance and registers it.

import { ParticipantDocument, type ParticipantDocumentOptions } from '../preferences/participant-document.js'

export const ANCHOR_BINDING_MEANING = 'keys:binding'
export const ANCHOR_BINDING_IOC_KEY = '@hypercomb.social/AnchorBinding'

const HEX64 = /^[0-9a-f]{64}$/
const SOURCES_MAX = 8
/** How long a reader waits for the pool before it believes "unbound". */
const READY_MS = 3000

export type AnchorBindingRecord = {
  readonly kind: 'anchor-binding@1'
  /** The anchor this device publishes for, or null: it is its own anchor. */
  readonly anchor: string | null
  /** Hosts that held the anchor's list when it was taken, to carry it from. */
  readonly sources: readonly string[]
}

export const EMPTY_ANCHOR_BINDING: AnchorBindingRecord = { kind: 'anchor-binding@1', anchor: null, sources: [] }

/** The record as stored, or null when the bytes are not one. */
export const parseAnchorBinding = (raw: unknown): AnchorBindingRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o['kind'] !== 'anchor-binding@1') return null
  const anchor = typeof o['anchor'] === 'string' && HEX64.test(o['anchor']) ? o['anchor'] : null
  const sources = Array.isArray(o['sources'])
    ? [...new Set(o['sources'].filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim().toLowerCase()))].slice(0, SOURCES_MAX)
    : []
  return { kind: 'anchor-binding@1', anchor, sources: anchor ? sources : [] }
}

export class AnchorBinding extends EventTarget {
  readonly #doc: ParticipantDocument<AnchorBindingRecord>

  constructor(options: Partial<ParticipantDocumentOptions<AnchorBindingRecord>> = {}) {
    super()
    this.#doc = new ParticipantDocument<AnchorBindingRecord>({
      meaning: ANCHOR_BINDING_MEANING,
      parse: parseAnchorBinding,
      empty: EMPTY_ANCHOR_BINDING,
      ...options,
    })
    this.#doc.addEventListener('change', () => this.dispatchEvent(new Event('change')))
  }

  /** The anchor this device publishes for, or null when it is its own. */
  anchor(): string | null { return this.#doc.value.anchor }

  sources(): readonly string[] { return this.#doc.value.sources }

  /** Take an anchor (an invite was spent). */
  bind(anchor: string, sources: readonly string[]): void {
    const clean = String(anchor ?? '').toLowerCase()
    if (!HEX64.test(clean)) return
    this.#doc.write({ kind: 'anchor-binding@1', anchor: clean, sources: [...new Set(sources.map(s => s.trim().toLowerCase()).filter(Boolean))].slice(0, SOURCES_MAX) })
    this.dispatchEvent(new Event('change'))
  }

  /** Publish as this device's own key again. */
  unbind(): void {
    this.#doc.write(EMPTY_ANCHOR_BINDING)
    this.dispatchEvent(new Event('change'))
  }

  /** Has a reader already waited the full moment for a pool that never came? */
  #gaveUp = false

  /** Resolves once the pool has been read — or after a moment, when no Store
   *  ever comes — so a publish at boot does not sign as the wrong key. Once it
   *  has given up it does not wait again: every later call answers at once. */
  ready(): Promise<void> {
    if (this.#doc.hydrated || this.#gaveUp) return Promise.resolve()
    return new Promise(resolve => {
      const done = (): void => { clearTimeout(timer); this.#doc.removeEventListener('hydrated', done); resolve() }
      const timer = setTimeout(() => { this.#gaveUp = true; done() }, READY_MS)
      this.#doc.addEventListener('hydrated', done)
    })
  }
}
