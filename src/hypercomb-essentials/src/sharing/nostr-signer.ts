// nostr/nostr-signer.ts
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { isSandboxDoor } from '@hypercomb/core'

type NostrEvent = { id?: string; pubkey?: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }

// Per-session key storage key. First load on a fresh browser profile
// mints a 32-byte secret here; subsequent loads reuse it. Each
// browser / incognito session / profile gets its own independent
// identity — no shared fallback that makes every peer self-skip.
const SECRET_KEY_STORAGE = 'hc:nostr:secret-key'

// Diagnostic logging — same master flag as the rest of the mesh stack
// (localStorage['hc:nostrmesh:debug'] = '1'). signEvent fires on every
// swarm publish (heartbeats included); ungated it floods the console.
const signerDebugEnabled = ((): boolean => {
  try { return localStorage.getItem('hc:nostrmesh:debug') === '1' } catch { return false }
})()

export class NostrSigner {

  /**
   * Hex-encoded public key derived from whatever the signer uses to
   * sign — either the NIP-07 extension's published pubkey, or the
   * derived pubkey from the resolved secret. Caches the value once
   * resolved; returns null if no signer is available.
   *
   * Used by paired-channel.drone to identify "am I the host?" (compare
   * to the channel's hostPubkey).
   */
  public getPublicKeyHex = async (): Promise<string | null> => {
    // A SANDBOX DOOR HOLDS NO SIGNER (hypercomb-core sandbox-door.ts). A
    // publisher's package runs there with full page power, so we never ask an
    // extension from it and never read, mint or persist a key in its storage —
    // the same rule LlmKeyStore keeps. `null` is "I own no bucket" to every
    // caller. A key a door minted before this rule stays where it is, unread.
    if (isSandboxDoor()) return null
    if (this.#cachedPubkey) return this.#cachedPubkey
    const anyWin = window as any
    if (anyWin?.nostr?.getPublicKey) {
      try {
        const pk = await anyWin.nostr.getPublicKey()
        if (typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk)) {
          this.#cachedPubkey = pk.toLowerCase()
          return this.#cachedPubkey
        }
      } catch { /* the user said no — see below */ }
      // AN EXTENSION IS PRESENT AND DID NOT GIVE US A KEY. Do NOT fall through
      // to minting a local one. `signEvent` below ALWAYS prefers
      // `window.nostr.signEvent` when the extension exists and never falls
      // through, so a minted local key could never sign anything here: the two
      // would disagree forever, and every commit would fail 'signer key
      // changed' for the rest of the session because both this cache and the
      // caller's pin the wrong key. Worse, a user who explicitly clicked
      // "reject" would walk away with a persistent signing identity in
      // plaintext localStorage that they declined — and since a molecule head
      // claim makes that key load-bearing for WRITE AUTHORITY, not just for
      // host PUTs, minting it silently is not a small thing.
      //
      // `null` means "I own no bucket", which every caller already handles, and
      // a later grant simply resolves on the next call.
      return null
    }
    const secretHex = this.resolveSecretKeyHex()
    if (!secretHex) return null
    try {
      const sk = this.hexToBytes(secretHex)
      const pk = getPublicKey(sk as any)
      this.#cachedPubkey = pk.toLowerCase()
      if (signerDebugEnabled) console.log('[sync] signer pubkey resolved', { pubkey: this.#cachedPubkey.slice(0, 8), instance: this.#instanceId })
      return this.#cachedPubkey
    } catch { return null }
  }

  #cachedPubkey: string | null = null

  public signEvent = async (evt: NostrEvent): Promise<NostrEvent> => {
    // already signed
    if (evt?.id && evt?.pubkey && evt?.sig) return evt
    if (isSandboxDoor()) throw new Error('nostr signer: a sandbox door signs nothing')

    const anyWin = window as any

    if (anyWin?.nostr?.signEvent) {
      const signed = await anyWin.nostr.signEvent(evt)
      if (!signed) throw new Error('nostr signer: nip-07 returned empty result')

      return signed as NostrEvent
    }

    const secretHex = this.resolveSecretKeyHex()
    if (!secretHex) throw new Error('nostr signer: no signer available (nip-07 missing and no fallback key configured)')

    const sk = this.hexToBytes(secretHex)
    const signed = finalizeEvent(evt as any, sk as any) as NostrEvent

    if (!signed.pubkey) {
      signed.pubkey = getPublicKey(sk as any)
    }
    // Diagnostic: log signer identity. Helps catch "different events
    // signed with different keys" when multiple module instances or a
    // race on auto-mint produces a divergent key set.
    if (signerDebugEnabled) console.log('[sync] signEvent', { kind: evt.kind, pubkey: signed.pubkey?.slice(0, 8), instance: this.#instanceId })

    if (!signed.id || !signed.sig) throw new Error('nostr signer: fallback signing failed')

    return signed
  }

  /** Stable per-instance id — distinguishes module-duplicate instances. */
  readonly #instanceId = Math.random().toString(36).slice(2, 8)

  /**
   * Resolve the secret key, in order:
   *
   *   1. `localStorage['hc:nostr:secret-key']` — this device's key.
   *   2. Mint a fresh random 32-byte key, persist it, return it.
   *
   * The key lives ONLY in this device's storage (never a pool, resource,
   * event or export — jwize 2026-10-07). No page global can name it: a
   * page-set key would sign under an identity the app reported for nobody,
   * and nothing would record the switch.
   *
   * The mint-on-miss path is the important one: every browser /
   * profile / incognito session lands at step 2 the first time and
   * walks away with its own stable identity. Two different sessions
   * never collide — which means self-skip in paired-channel.drone
   * only suppresses our actual own broadcasts, not the other peer's.
   *
   * PINNED FOR THE SESSION. Once resolved, the instance signs with this key
   * until the page reloads, so a signature is always made by the key
   * getPublicKeyHex reported; a storage write mid-session takes effect on
   * reload. If localStorage refuses the write (private mode quirks, storage
   * disabled) the minted key lives in memory until the page closes — better
   * than falling back to a shared constant.
   */
  private resolveSecretKeyHex = (): string => {
    if (this.#secretHex) return this.#secretHex

    try {
      const fromStorage = String(localStorage.getItem(SECRET_KEY_STORAGE) ?? '').trim().toLowerCase()
      if (this.isHex64(fromStorage)) return this.#secretHex = fromStorage
    } catch {
      // localStorage unavailable — fall through to mint.
    }

    const fresh = this.#mintSecretKeyHex()
    try { localStorage.setItem(SECRET_KEY_STORAGE, fresh) }
    catch { /* storage refused — the key lives in memory for this page */ }
    return this.#secretHex = fresh
  }

  /** The key this instance signs with, once resolved — pinned for the session. */
  #secretHex: string | null = null

  #mintSecretKeyHex = (): string => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    let hex = ''
    for (let i = 0; i < 32; i++) hex += bytes[i].toString(16).padStart(2, '0')
    return hex
  }

  private isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

  private hexToBytes = (hex: string): Uint8Array => {
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
}

// sharing/sharing.boot.drone.ts — the boot lane registers this (atomic-modules-plan.md): a dependency registers nothing.