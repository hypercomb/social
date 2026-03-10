// hypercomb-core/src/core/signature-store.ts

import { SignatureService, type Signature } from './signature.service.js'

/**
 * Central allowlist of verified signatures.
 *
 * Scripts whose signatures are in the store don't need re-verification —
 * just check isTrusted(sig). The store is populated from:
 *
 * 1. install.manifest.json at install time (all known bee/dep/layer sigs)
 * 2. DCP at runtime (authoritative allowlist, fetched as first request)
 *
 * The store itself is signature-addressed: storeSig identifies the current
 * version. Client sends storeSig to DCP; if it matches, no update needed.
 */
export class SignatureStore extends EventTarget {

  #trusted = new Set<string>()
  #storeSig: string | null = null
  #textCache = new Map<string, Signature>()

  get size(): number { return this.#trusted.size }
  get storeSig(): string | null { return this.#storeSig }

  /** Mark a signature as trusted (allowed to run). */
  trust(sig: string): void { this.#trusted.add(sig) }

  /** Bulk-trust all signatures from an iterable (e.g., manifest arrays). */
  trustAll(sigs: Iterable<string>): void {
    for (const s of sigs) if (s) this.#trusted.add(s)
  }

  /** Check if a signature is in the trusted allowlist. */
  isTrusted(sig: string): boolean { return this.#trusted.has(sig) }

  /**
   * Verify bytes against an expected signature.
   * Returns true if trusted (skips hashing) or if hash matches (and trusts for future).
   * Returns false on mismatch — content is corrupt or tampered.
   */
  async verify(bytes: ArrayBuffer, expectedSig: string): Promise<boolean> {
    if (this.#trusted.has(expectedSig)) return true
    const actual = await SignatureService.sign(bytes)
    if (actual === expectedSig) {
      this.#trusted.add(expectedSig)
      return true
    }
    return false
  }

  /**
   * Sign a text string with memoization. Same text always produces the same
   * signature, so the cache eliminates redundant SHA-256 for repeated calls
   * (e.g., computeSignatureLocation called 4+ times per render cycle).
   */
  async signText(text: string): Promise<Signature> {
    const cached = this.#textCache.get(text)
    if (cached) return cached
    const bytes = new TextEncoder().encode(text)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    this.#textCache.set(text, sig)
    return sig
  }

  /**
   * Load a full allowlist from DCP. storeSig is the manifest's own signature
   * for freshness checking — client sends this to DCP, if it matches the
   * server's current version, no update needed.
   */
  load(sigs: string[], storeSig: string): void {
    this.#trusted = new Set(sigs.filter(Boolean))
    this.#storeSig = storeSig
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Serialize for localStorage persistence. */
  toJSON(): { sigs: string[]; storeSig: string | null } {
    return { sigs: [...this.#trusted], storeSig: this.#storeSig }
  }

  /** Restore from localStorage. */
  restore(data: { sigs?: string[]; storeSig?: string | null }): void {
    if (!data?.sigs) return
    this.#trusted = new Set(data.sigs.filter(Boolean))
    this.#storeSig = data.storeSig ?? null
  }
}
