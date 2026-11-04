// hypercomb-shim/src/bootstrap/device-key.ts
//
// THIS BROWSER'S OWN KEY, on a front door (documentation/phone-showcase-signing.md;
// jwize 2026-11-04: "once in our community we can promote it by clicking to go live").
//
// A front door held no key. A browser that ACCEPTED an invite from its owner
// (device-invite.ts) now does: its own, made here, never copied from anywhere.
// A visitor never gets one — nothing makes it but the Allow tap.
//
// A credential has one home: this device's localStorage, under the same name the
// hive's signer keeps it (essentials sharing/nostr-signer.ts). On an origin where
// the hive also runs, the two are one device with one key, as they should be.
// This file holds the key and nothing else: it writes no pool, no resource, no
// event (doctrine.spec.ts holds a credential's reader to that).

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const SECRET_KEY_STORAGE = 'hc:nostr:secret-key'
const HEX64 = /^[0-9a-f]{64}$/

export type EventTemplate = { kind: number; created_at: number; tags: string[][]; content: string }

export type DeviceSigner = {
  readonly pubkey: string
  readonly sign: (template: EventTemplate) => Record<string, unknown>
}

const hex = (bytes: Uint8Array): string => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16))

/** The key this browser holds, or null. `make` mints one when there is none — only the Allow tap asks
 *  for that. A key this browser cannot keep is not made: it would sign once and be lost. */
export const deviceSigner = (make = false): DeviceSigner | null => {
  let held = ''
  try { held = String(localStorage.getItem(SECRET_KEY_STORAGE) ?? '').trim().toLowerCase() } catch { return null }
  if (!HEX64.test(held)) {
    if (!make) return null
    held = hex(generateSecretKey())
    try { localStorage.setItem(SECRET_KEY_STORAGE, held) } catch { return null }
  }
  const secret = bytesOf(held)
  return { pubkey: getPublicKey(secret), sign: template => finalizeEvent(template, secret) as unknown as Record<string, unknown> }
}
