// diamondcoreprocessor.com/nostr/nostr-signer.ts
import { finalizeEvent, getPublicKey } from 'nostr-tools'

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
    if (this.#cachedPubkey) return this.#cachedPubkey
    const anyWin = window as any
    if (anyWin?.nostr?.getPublicKey) {
      try {
        const pk = await anyWin.nostr.getPublicKey()
        if (typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk)) {
          this.#cachedPubkey = pk.toLowerCase()
          return this.#cachedPubkey
        }
      } catch { /* fall through */ }
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
   * Resolve the secret key, in priority order:
   *
   *   1. `window.NOSTR_SECRET_KEY` — test / scripted override.
   *   2. `localStorage['hc:nostr:secret-key']` — persisted per-session key.
   *   3. Mint a fresh random 32-byte key, persist it, return it.
   *
   * The mint-on-miss path is the important one: every browser /
   * profile / incognito session lands at step 3 the first time and
   * walks away with its own stable identity. Two different sessions
   * never collide — which means self-skip in paired-channel.drone
   * only suppresses our actual own broadcasts, not the other peer's.
   *
   * Persistence is best-effort: if localStorage is unavailable
   * (private mode quirks, storage disabled), we mint an ephemeral
   * in-memory key that lives until the page closes. Better than
   * falling back to a shared constant.
   */
  private resolveSecretKeyHex = (): string => {
    const anyWin = window as any

    const fromWindow = String(anyWin?.NOSTR_SECRET_KEY ?? '').trim().toLowerCase()
    if (this.isHex64(fromWindow)) return fromWindow

    try {
      const fromStorage = String(localStorage.getItem(SECRET_KEY_STORAGE) ?? '').trim().toLowerCase()
      if (this.isHex64(fromStorage)) return fromStorage
    } catch {
      // localStorage unavailable — fall through to mint.
    }

    if (this.#ephemeralSecretKey && this.isHex64(this.#ephemeralSecretKey)) {
      return this.#ephemeralSecretKey
    }

    const fresh = this.#mintSecretKeyHex()
    try { localStorage.setItem(SECRET_KEY_STORAGE, fresh) }
    catch { this.#ephemeralSecretKey = fresh }
    return fresh
  }

  /** Cached only when localStorage refused the write (rare). */
  #ephemeralSecretKey: string | null = null

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

window.ioc.register('@diamondcoreprocessor.com/NostrSigner', new NostrSigner())