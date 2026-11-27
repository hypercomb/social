// hypercomb-core/src/core/llm-keys.ts
//
// LLM KEYS ARE DEVICE-LOCAL TRUTH.
//
// A participant's API key is the one piece of data in this system that must
// never become content. It is never a resource, never a layer slot, never a
// decoration payload, never an EffectBus payload, never a toast, never a log
// line, never a history op — so it is never signed, never shared, never
// adopted, never synced, and never recoverable from a hive someone else
// holds. It lives in this device's localStorage and nowhere else. A doctrine
// ratchet in `src/doctrine.spec.ts` enforces the negative half of that
// sentence mechanically; this file is the positive half — the ONE place a key
// is written and read, so there is a single seam to audit. The pool write path
// asks `carriedBy` before it persists a document, so a held key that reaches a
// pool's bytes by any route is refused before the atom exists.
//
// Shape is copied from `hypercomb-shared/core/secret-store.ts` (EventTarget,
// `#fields`, `change` events) because that is the repo's existing credential-
// state pattern. It lives in CORE rather than shared because essentials may
// import core and may NEVER import shared, and the provider registry that
// needs it is an essentials module.
//
// ── storage scheme ────────────────────────────────────────────────────
//
//   hc:llm:<providerId>:key      one key per provider, the only thing written
//   hc:anthropic-api-key         LEGACY — read-only drain fallback
//
// The legacy single-vendor key predates providers. It is read as if it were
// `hc:llm:anthropic:key` so nobody has to re-paste anything, and it is never
// written — a `set('anthropic', …)` lands in the scheme above. `clear` does
// remove it, because a key you asked to be gone being still readable is the
// failure this file exists to prevent; that is a drain, not a write.
//
// ── at a sandbox door ─────────────────────────────────────────────────
//
// A door (`try-<change>.<zone>`, sandbox-door.ts) runs a PUBLISHER'S package
// with full page power, so a key typed there is typed into their code. At a
// door this store holds nothing: `set` does not store, and every read comes
// back empty — a surface that offers a key field finds no key and saves none.
// It is a courtesy the publisher's code could route around, never the guard;
// the guard is not typing a key at a door, which the door bar says.
//
// ── bridge codes ──────────────────────────────────────────────────────
//
// The second credential this file holds (`BridgeCodeStore`, below): who
// besides this machine's own tools may use the Claude bridge
// (documentation/claude-bridge-setup.md, "Who may use the bridge — codes").
// The CODE itself is never stored — only its SHA-256 — and only `generate`
// ever hands one back, once.
//
// ── entry pool nonces ─────────────────────────────────────────────────
//
// The third (`EntryNonceStore`, at the end): the nonce of each entry pool
// this device opened (documentation/open-entry-pools.md). The nonce is the
// capability: with the opening record it gives the pool's address, so it is
// kept here and never in the leader's record of the pool, which is a pool
// document the folder backup copies.
//
// All three stores write through `writeRaw`, so this file keeps exactly one
// raw storage write.

import { register } from '../ioc/ioc.js'
import { isSandboxDoor } from './sandbox-door.js'

/** A held value shorter than this never blocks a write: a placeholder typed
 *  into a key field ('x', 'ollama') is no key, and every real provider key is
 *  32 characters or more. */
const CARRIED_MIN_LENGTH = 20

/** IoC key. Resolve via `window.ioc.get(LLM_KEY_STORE_IOC_KEY)`. */
export const LLM_KEY_STORE_IOC_KEY = '@hypercomb.social/LlmKeyStore'

/** Legacy single-vendor storage key. Read-only drain source. */
export const LEGACY_ANTHROPIC_KEY_STORAGE = 'hc:anthropic-api-key'

/** The provider whose key the legacy storage slot holds. */
export const LEGACY_KEY_PROVIDER = 'anthropic'

const PREFIX = 'hc:llm:'
const SUFFIX = ':key'

/** Storage key for a provider's key. The scheme, in one function. */
export const llmKeyStorageKey = (providerId: string): string =>
  `${PREFIX}${String(providerId ?? '').trim().toLowerCase()}${SUFFIX}`

/** Is this a storage key this store owns (including the legacy slot)? */
export const isLlmKeyStorageKey = (key: string | null | undefined): boolean =>
  key === LEGACY_ANTHROPIC_KEY_STORAGE
  || (typeof key === 'string' && key.startsWith(PREFIX) && key.endsWith(SUFFIX))

/** Provider id out of a storage key, or `''` if it is not one of ours. */
export const providerIdOfStorageKey = (key: string | null | undefined): string => {
  if (key === LEGACY_ANTHROPIC_KEY_STORAGE) return LEGACY_KEY_PROVIDER
  if (typeof key !== 'string' || !key.startsWith(PREFIX) || !key.endsWith(SUFFIX)) return ''
  return key.slice(PREFIX.length, key.length - SUFFIX.length)
}

const readRaw = (key: string): string => {
  try { return (globalThis.localStorage?.getItem(key) ?? '').trim() } catch { return '' }
}

/** THE ONE RAW WRITE in this file, for every store in it. Without storage (a
 *  private window, node) the in-memory mirror still holds for the session. */
const writeRaw = (key: string, value: string): void => {
  try { globalThis.localStorage?.setItem(key, value) } catch { /* session-only */ }
}

const removeRaw = (key: string): void => {
  try { globalThis.localStorage?.removeItem(key) } catch { /* nothing to remove */ }
}

/**
 * Every LLM credential this device holds.
 *
 * `change` fires on any mutation, and on a `storage` event from another tab,
 * so an indicator or a picker can just listen. The event carries NO detail —
 * a key must never ride an event payload; listeners re-read.
 */
export class LlmKeyStore extends EventTarget {

  /** providerId → key. Mirrors localStorage; re-read on cross-tab change. */
  readonly #fields = new Map<string, string>()

  constructor() {
    super()
    this.#load()
    try {
      globalThis.addEventListener?.('storage', (event: Event) => {
        const key = (event as StorageEvent).key
        // `null` = the whole store was cleared.
        if (key !== null && !isLlmKeyStorageKey(key)) return
        this.#load()
        this.dispatchEvent(new Event('change'))
      })
    } catch { /* no window (tests, node) — the in-memory mirror still works */ }
  }

  /** This provider's key, or `''`. Falls back to the legacy slot. */
  get(providerId: string): string {
    if (isSandboxDoor()) return ''
    return this.#fields.get(this.#id(providerId)) ?? ''
  }

  /** Whether a usable key exists for this provider. */
  has(providerId: string): boolean {
    return !!this.get(providerId)
  }

  /** Provider ids with a key, sorted. The roster an indicator reads. */
  configured(): string[] {
    if (isSandboxDoor()) return []
    return [...this.#fields.keys()].sort()
  }

  /**
   * Which provider's held key these bytes carry, verbatim — the provider id,
   * never the key — or `''`. An exact match, so it has no false positives and
   * needs no list of vendor key shapes. It reads `#fields`, not `get()`, so the
   * refusal still holds at a sandbox door.
   */
  carriedBy(content: ArrayBuffer | ArrayBufferView | string): string {
    if (this.#fields.size === 0) return ''
    let text: string
    try { text = typeof content === 'string' ? content : new TextDecoder().decode(content) } catch { return '' }
    for (const [id, key] of this.#fields) if (key.length >= CARRIED_MIN_LENGTH && text.includes(key)) return id
    return ''
  }

  /** Store (or, with an empty value, clear) a provider's key. */
  set(providerId: string, key: string): void {
    const id = this.#id(providerId)
    if (!id || isSandboxDoor()) return
    const clean = (key ?? '').trim()
    if (!clean) { this.clear(id); return }
    this.#fields.set(id, clean)
    writeRaw(llmKeyStorageKey(id), clean)
    this.dispatchEvent(new Event('change'))
  }

  /**
   * Forget a provider's key. Removes the legacy slot too when clearing
   * anthropic — a cleared key that is still readable is not cleared.
   */
  clear(providerId: string): void {
    const id = this.#id(providerId)
    if (!id) return
    const had = this.#fields.delete(id)
    try {
      globalThis.localStorage?.removeItem(llmKeyStorageKey(id))
      if (id === LEGACY_KEY_PROVIDER) globalThis.localStorage?.removeItem(LEGACY_ANTHROPIC_KEY_STORAGE)
    } catch { /* nothing to remove */ }
    if (had) this.dispatchEvent(new Event('change'))
  }

  /** Re-read localStorage. Public so a test or a drain can force a refresh. */
  reload(): void {
    this.#load()
    this.dispatchEvent(new Event('change'))
  }

  #id(providerId: string): string {
    return String(providerId ?? '').trim().toLowerCase()
  }

  #load(): void {
    this.#fields.clear()
    let storage: Storage | undefined
    try { storage = globalThis.localStorage } catch { storage = undefined }
    if (!storage) return

    // Legacy first, so a real `hc:llm:anthropic:key` overwrites it below.
    const legacy = readRaw(LEGACY_ANTHROPIC_KEY_STORAGE)
    if (legacy) this.#fields.set(LEGACY_KEY_PROVIDER, legacy)

    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (!key || key === LEGACY_ANTHROPIC_KEY_STORAGE || !isLlmKeyStorageKey(key)) continue
        const id = providerIdOfStorageKey(key)
        const value = readRaw(key)
        if (id && value) this.#fields.set(id, value)
      }
    } catch { /* enumeration unavailable — legacy fallback still stands */ }
  }
}

/**
 * The singleton. Registered on BOTH registries: core's own map (for core and
 * node-side consumers that imported `get` from `ioc.js`) and `window.ioc`
 * (what every essentials module and Angular surface resolves against). The
 * shell registry may not exist yet when core loads, so the global half is
 * best-effort and idempotent — `register` ignores a second registration.
 */
export const llmKeyStore = new LlmKeyStore()

register(LLM_KEY_STORE_IOC_KEY, llmKeyStore)
try {
  (globalThis as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(LLM_KEY_STORE_IOC_KEY, llmKeyStore)
} catch { /* no shell registry yet — core's map answers via ioc.get's bridge */ }

// ── bridge codes ──────────────────────────────────────────────────────
//
// WHO BESIDES THIS MACHINE MAY USE THE CLAUDE BRIDGE. The broker
// (scripts/bridge/run-bridge.cjs) serves this machine's own tools — a
// loopback Node client that sends no Origin — and refuses everyone else
// unless they present a code: a remote session, and every browser page. The
// participant gives codes from the hive (`bridge give <name>`,
// assistant/bridge.queen.ts), and the renderer tab tells the broker their
// SHA-256 hashes — never the codes — when it registers and whenever the list
// changes (claude-bridge.worker.ts).
//
//   hc:bridge:codes     JSON `[{ label, hash, at }]` — never the code
//
// THE SHARED RULE, byte for byte with the broker (scripts/bridge/
// bridge-codes.cjs): a code is `String(x).trim()`, no case folding, 1–256
// PRINTABLE ASCII characters (0x21–0x7E, no spaces — a Node client presents
// it in the Authorization header, which carries nothing else intact); its
// hash is the lowercase hex SHA-256 of its UTF-8 bytes; its fingerprint is
// the hash's first 8 characters. A generated code is `hcb-` and 20 random
// bytes in RFC 4648 base32, lowercase.

/** IoC key. Resolve via `window.ioc.get(BRIDGE_CODE_STORE_IOC_KEY)`. */
export const BRIDGE_CODE_STORE_IOC_KEY = '@hypercomb.social/BridgeCodeStore'

/** Where the list lives on this device: labels and hashes, never a code. */
export const BRIDGE_CODES_STORAGE_KEY = 'hc:bridge:codes'

/** The longest code either side accepts. */
export const BRIDGE_CODE_MAX_LENGTH = 256

const BRIDGE_LABEL_MAX_LENGTH = 64
const BRIDGE_HASH_RE = /^[0-9a-f]{64}$/
/** A withdraw by fingerprint needs at least 4 hex characters of it. */
const BRIDGE_FINGERPRINT_PREFIX_RE = /^[0-9a-f]{4,64}$/
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** 1–256 printable ASCII characters — what a handshake header can carry. */
const BRIDGE_CODE_RE = new RegExp(`^[\\x21-\\x7e]{1,${BRIDGE_CODE_MAX_LENGTH}}$`)

/** The code as both sides read it, or `''` when it is not one. */
export const normalizeBridgeCode = (raw: unknown): string => {
  const code = raw === null || raw === undefined ? '' : String(raw).trim()
  return BRIDGE_CODE_RE.test(code) ? code : ''
}

/** Lowercase hex SHA-256 of the code's UTF-8 bytes — what the broker compares. */
export const hashBridgeCode = async (code: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The short name a code goes by in a list: its hash's first 8 characters. */
export const bridgeCodeFingerprint = (hash: string): string => String(hash ?? '').slice(0, 8)

/** RFC 4648 base32, lowercase, unpadded. */
const base32 = (bytes: Uint8Array): string => {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** RFC 4648 base32 of these bytes, lowercase. Exported for the spec. */
export const bridgeCodeBase32 = base32

/** A fresh code: `hcb-` and 20 random bytes in base32 (32 characters). */
export const mintBridgeCode = (): string =>
  `hcb-${base32(globalThis.crypto.getRandomValues(new Uint8Array(20)))}`

/** One held code, as stored. */
type HeldBridgeCode = { readonly label: string; readonly hash: string; readonly at: number }

/** One held code, as anyone may read it: no code, and no whole hash. */
export type BridgeCodeListing = { readonly label: string; readonly fingerprint: string; readonly at: number }

/** Why an add was refused: not a label or code, a label or code already
 *  held, or this page is a sandbox door. */
export type BridgeCodeRefusal = 'invalid' | 'duplicate' | 'door'

export type BridgeCodeAdded =
  | { readonly ok: true; readonly fingerprint: string }
  | { readonly ok: false; readonly reason: BridgeCodeRefusal }

export type BridgeCodeGiven =
  | { readonly ok: true; readonly code: string; readonly fingerprint: string }
  | { readonly ok: false; readonly reason: BridgeCodeRefusal }

const cleanBridgeLabel = (raw: unknown): string => {
  const label = String(raw ?? '').trim().replace(/\s+/g, ' ')
  return label.length <= BRIDGE_LABEL_MAX_LENGTH ? label : ''
}

/**
 * The bridge codes this device has given or been told, by label.
 *
 * `change` fires on any mutation, and on a `storage` event for its own key,
 * with NO detail — listeners re-read `hashes()` or `list()`. A sandbox door
 * holds nothing here: every read is empty and every add is refused.
 */
export class BridgeCodeStore extends EventTarget {

  /** Mirrors storage; re-read on a cross-tab change. */
  #held: HeldBridgeCode[] = []

  constructor() {
    super()
    this.#load()
    try {
      globalThis.addEventListener?.('storage', (event: Event) => {
        const key = (event as StorageEvent).key
        // `null` = the whole store was cleared.
        if (key !== null && key !== BRIDGE_CODES_STORAGE_KEY) return
        this.#load()
        this.dispatchEvent(new Event('change'))
      })
    } catch { /* no window (tests, node) — the in-memory mirror still works */ }
  }

  /** Every code held, by label and fingerprint, oldest first. */
  list(): BridgeCodeListing[] {
    if (isSandboxDoor()) return []
    return this.#held.map(({ label, hash, at }) => ({ label, fingerprint: bridgeCodeFingerprint(hash), at }))
  }

  /** The hashes the broker admits — the whole set, what the renderer sends. */
  hashes(): string[] {
    if (isSandboxDoor()) return []
    return this.#held.map(entry => entry.hash)
  }

  /** Hold a code someone already has, under a label. Only its hash is kept. */
  async add(label: string, code: string): Promise<BridgeCodeAdded> {
    if (isSandboxDoor()) return { ok: false, reason: 'door' }
    const name = cleanBridgeLabel(label)
    const clean = normalizeBridgeCode(code)
    if (!name || !clean) return { ok: false, reason: 'invalid' }
    if (this.#labelHeld(name)) return { ok: false, reason: 'duplicate' }
    const hash = await hashBridgeCode(clean)
    // Asked again after the await: another add may have landed meanwhile.
    if (this.#labelHeld(name) || this.#held.some(entry => entry.hash === hash)) return { ok: false, reason: 'duplicate' }
    this.#save([...this.#held, { label: name, hash, at: Date.now() }])
    return { ok: true, fingerprint: bridgeCodeFingerprint(hash) }
  }

  /** Mint a code for a label. The ONLY place a code is handed back — the
   *  caller shows it once and keeps nothing. */
  async generate(label: string): Promise<BridgeCodeGiven> {
    const code = mintBridgeCode()
    const added = await this.add(label, code)
    return added.ok ? { ok: true, code, fingerprint: added.fingerprint } : added
  }

  /**
   * Withdraw the one code a label (any case) or a fingerprint prefix (4+ hex
   * characters) names. Returns how many codes it named: 1 is withdrawn, 0 is
   * not found, and more than 1 is ambiguous and withdraws nothing.
   */
  withdraw(labelOrFingerprintPrefix: string): number {
    if (isSandboxDoor()) return 0
    const query = String(labelOrFingerprintPrefix ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
    if (!query) return 0
    const prefix = BRIDGE_FINGERPRINT_PREFIX_RE.test(query) ? query : ''
    const named = this.#held.filter(entry =>
      entry.label.toLowerCase() === query || (!!prefix && entry.hash.startsWith(prefix)))
    if (named.length === 1) this.#save(this.#held.filter(entry => entry !== named[0]))
    return named.length
  }

  /** Re-read storage. Public so a test can force a refresh. */
  reload(): void {
    this.#load()
    this.dispatchEvent(new Event('change'))
  }

  #labelHeld(label: string): boolean {
    const want = label.toLowerCase()
    return this.#held.some(entry => entry.label.toLowerCase() === want)
  }

  #save(held: HeldBridgeCode[]): void {
    this.#held = held
    if (held.length) writeRaw(BRIDGE_CODES_STORAGE_KEY, JSON.stringify(held))
    else removeRaw(BRIDGE_CODES_STORAGE_KEY)
    this.dispatchEvent(new Event('change'))
  }

  #load(): void {
    this.#held = []
    let rows: unknown
    try { rows = JSON.parse(readRaw(BRIDGE_CODES_STORAGE_KEY) || '[]') } catch { return }
    if (!Array.isArray(rows)) return
    for (const row of rows as Array<Partial<HeldBridgeCode> | null>) {
      const label = cleanBridgeLabel(row?.label)
      const hash = String(row?.hash ?? '')
      if (!label || !BRIDGE_HASH_RE.test(hash) || this.#labelHeld(label) || this.#held.some(entry => entry.hash === hash)) continue
      const at = Number(row?.at)
      this.#held.push({ label, hash, at: Number.isFinite(at) ? at : 0 })
    }
  }
}

/** The singleton, registered on both registries as `llmKeyStore` is. */
export const bridgeCodeStore = new BridgeCodeStore()

register(BRIDGE_CODE_STORE_IOC_KEY, bridgeCodeStore)
try {
  (globalThis as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(BRIDGE_CODE_STORE_IOC_KEY, bridgeCodeStore)
} catch { /* no shell registry yet — core's map answers via ioc.get's bridge */ }

// ── entry pool nonces ─────────────────────────────────────────────────
//
// THE CODE OF A POOL THIS DEVICE OPENED (documentation/open-entry-pools.md).
// A leader opens an entry pool and shows a code, `#post=<O>~<nonce>`: `O` is
// the signature of the public opening record and the nonce is 16 random
// bytes. Together they hash to the pool's address, which is the invitation.
// `O` is public, so the nonce alone is the secret, and it is kept the way a
// key is: in this device's storage, never in a pool. The leader's own record
// of the pool (`entries:opened`) holds everything else, and the pool write
// path asks `carriedBy` so a document that carries a held nonce is refused
// before the atom exists.
//
//   hc:entries:<H>:nonce     the nonce of the pool the index names as H
//
// Keyed by `H`, the name the leader's index gives the pool, because `H` is
// what every device of the leader can read; a device that holds no nonce for
// an `H` did not open that pool and cannot show its code again.

/** IoC key. Resolve via `window.ioc.get(ENTRY_NONCE_STORE_IOC_KEY)`. */
export const ENTRY_NONCE_STORE_IOC_KEY = '@hypercomb.social/EntryNonceStore'

const ENTRY_NONCE_PREFIX = 'hc:entries:'
const ENTRY_NONCE_SUFFIX = ':nonce'
/** `H` and `O`: 64 lowercase hex. */
const ENTRY_NAME_RE = /^[0-9a-f]{64}$/
/** A nonce: 16 bytes as 32 lowercase hex. */
const ENTRY_NONCE_RE = /^[0-9a-f]{32}$/

const cleanHex = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()

/** Storage key for the nonce of the pool named `H`. The scheme, in one function. */
export const entryNonceStorageKey = (pool: string): string =>
  `${ENTRY_NONCE_PREFIX}${cleanHex(pool)}${ENTRY_NONCE_SUFFIX}`

/** The pool name out of a storage key, or `''` if it is not one of this store's. */
const poolOfNonceStorageKey = (key: string | null | undefined): string => {
  if (typeof key !== 'string' || !key.startsWith(ENTRY_NONCE_PREFIX) || !key.endsWith(ENTRY_NONCE_SUFFIX)) return ''
  const pool = key.slice(ENTRY_NONCE_PREFIX.length, key.length - ENTRY_NONCE_SUFFIX.length)
  return ENTRY_NAME_RE.test(pool) ? pool : ''
}

/**
 * The nonces of the entry pools this device opened, by the pool's index name.
 *
 * `change` fires on any mutation, and on a `storage` event for one of its
 * keys, with NO detail: a nonce must never ride an event payload. A sandbox
 * door holds nothing here: `set` does not store and `get` comes back empty.
 */
export class EntryNonceStore extends EventTarget {

  /** H → nonce. Mirrors localStorage; re-read on a cross-tab change. */
  readonly #held = new Map<string, string>()

  constructor() {
    super()
    this.#load()
    try {
      globalThis.addEventListener?.('storage', (event: Event) => {
        const key = (event as StorageEvent).key
        // `null` = the whole store was cleared.
        if (key !== null && !poolOfNonceStorageKey(key)) return
        this.#load()
        this.dispatchEvent(new Event('change'))
      })
    } catch { /* no window (tests, node) — the in-memory mirror still works */ }
  }

  /** The nonce of the pool named `H`, or `''` when this device holds none. */
  get(pool: string): string {
    if (isSandboxDoor()) return ''
    return this.#held.get(cleanHex(pool)) ?? ''
  }

  /** Hold the nonce of the pool named `H`. False, and nothing kept, when
   *  either is not the hex it must be or this page is a sandbox door. */
  set(pool: string, nonce: string): boolean {
    const name = cleanHex(pool)
    const clean = cleanHex(nonce)
    if (!ENTRY_NAME_RE.test(name) || !ENTRY_NONCE_RE.test(clean) || isSandboxDoor()) return false
    if (this.#held.get(name) === clean) return true
    this.#held.set(name, clean)
    writeRaw(entryNonceStorageKey(name), clean)
    this.dispatchEvent(new Event('change'))
    return true
  }

  /** Forget the nonce of the pool named `H`: a recycled pool's code is gone
   *  for good. Works at a sandbox door too, where forgetting is never the harm. */
  drop(pool: string): void {
    const name = cleanHex(pool)
    if (!ENTRY_NAME_RE.test(name)) return
    const had = this.#held.delete(name)
    removeRaw(entryNonceStorageKey(name))
    if (had) this.dispatchEvent(new Event('change'))
  }

  /**
   * Which pool's held nonce these bytes carry: its `H`, never the nonce, or
   * `''`. A nonce is hex, so it is looked for in either case; 32 hex
   * characters do not turn up by chance. It reads `#held`, not `get()`, so
   * the refusal still holds at a sandbox door.
   */
  carriedBy(content: ArrayBuffer | ArrayBufferView | string): string {
    if (this.#held.size === 0) return ''
    let text: string
    try { text = (typeof content === 'string' ? content : new TextDecoder().decode(content)).toLowerCase() } catch { return '' }
    for (const [pool, nonce] of this.#held) if (text.includes(nonce)) return pool
    return ''
  }

  /** Re-read storage. Public so a test can force a refresh. */
  reload(): void {
    this.#load()
    this.dispatchEvent(new Event('change'))
  }

  #load(): void {
    this.#held.clear()
    let storage: Storage | undefined
    try { storage = globalThis.localStorage } catch { storage = undefined }
    if (!storage) return
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        const pool = poolOfNonceStorageKey(key)
        if (!key || !pool) continue
        const nonce = readRaw(key)
        if (ENTRY_NONCE_RE.test(nonce)) this.#held.set(pool, nonce)
      }
    } catch { /* enumeration unavailable — nothing held this session */ }
  }
}

/** The singleton, registered on both registries as `llmKeyStore` is. */
export const entryNonceStore = new EntryNonceStore()

register(ENTRY_NONCE_STORE_IOC_KEY, entryNonceStore)
try {
  (globalThis as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(ENTRY_NONCE_STORE_IOC_KEY, entryNonceStore)
} catch { /* no shell registry yet — core's map answers via ioc.get's bridge */ }
