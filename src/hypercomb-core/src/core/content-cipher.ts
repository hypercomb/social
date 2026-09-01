// core/content-cipher.ts
//
// CONVERGENT ENCRYPTION OVER ATOM BYTES. The one shape of encryption that a
// content-addressed, replicated store can carry without losing what makes it
// one.
//
// The whole design turns on a single decision: the signature names the
// CIPHERTEXT. That is only survivable if the ciphertext is a pure function of
// the plaintext — so the key is DERIVED from the plaintext, never chosen:
//
//   same plaintext → same key → same ciphertext → SAME SIGNATURE, everywhere
//
// which is what keeps every downstream property alive. Deduplication still
// works (one signature, stored once). Mirrors are byte-identical, so a second
// host is a COPY and not another door. An author's root signature resolves on
// any host that holds the closure. And `replication-walker.ts` does not change
// by one line — it is kind-blind by design, and sealed bytes are just bytes.
//
// A randomly-keyed scheme breaks all of that at once: every host's copy gets a
// different name, dedup dies, and a root sig computed by the author resolves
// nowhere else. That is not a weaker variant of this, it is a different system.
//
// WHY A FIXED NONCE IS SAFE HERE, AND ONLY HERE. Reusing a (key, nonce) pair
// across two different plaintexts destroys AES-GCM — it leaks the XOR of the
// plaintexts and forges the tag. This code derives the key from the plaintext,
// so a given key only ever encrypts the ONE plaintext it came from, and the
// pair can never be reused across different content. Do not lift this nonce
// derivation into any other cipher call site; it is load-bearing on the
// convergence property, not a general pattern.
//
// WHAT THIS DELIBERATELY DOES NOT DO — the honest limits, stated rather than
// discovered later:
//   · Convergence is a CONFIRMATION ORACLE. Anyone who can guess the plaintext
//     can derive the key, seal it, and compare signatures to confirm you hold
//     it. Pass `secret` to salt the derivation per hive, which closes the
//     oracle and, by the same stroke, ends cross-participant dedup for that
//     content. It is a per-pool choice; there is no answer that is right
//     globally.
//   · There is no revocation. Whoever fetched the atom and held its key keeps
//     both, forever. Re-wrapping an envelope stops future grants, not past
//     copies. That is inherent to replication, not a gap in this file.
//   · Key custody is NOT here. This seals and opens; who may hold the key is
//     the envelope's job (wrapped to a recipient pubkey, client-side, never on
//     a host). Hosts stay dumb — they hold opaque bytes and can read nothing.

const MAGIC = new Uint8Array([0x48, 0x43, 0x53, 0x31]) // "HCS1"
const FLAG_SALTED = 0x01
/** Set when the key came from a SECRET rather than from the content. */
const FLAG_SECRET = 0x02
const NONCE_BYTES = 12
const KEY_BYTES = 32
const HEADER_BYTES = MAGIC.length + 1 + NONCE_BYTES

/** Derivation domain. Changing this string re-keys every atom ever sealed, so
 *  it is versioned in the magic rather than edited in place. */
const INFO = new TextEncoder().encode('hypercomb/atom/v1')

export type SealedAtom = {
  /** The bytes to sign and store. Opaque to every host. */
  readonly bytes: Uint8Array
  /** The atom key. Goes in an envelope wrapped to a recipient — NEVER stored
   *  beside the atom, and never sent to a host. */
  readonly key: Uint8Array
}

const view = (data: ArrayBuffer | Uint8Array): Uint8Array =>
  data instanceof Uint8Array ? data : new Uint8Array(data)

/** A standalone ArrayBuffer for a view that may be a window onto a larger one.
 *  `subtle` takes the whole underlying buffer otherwise, which silently
 *  encrypts more than was asked for. */
const bufferOf = (data: Uint8Array): ArrayBuffer =>
  data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer as ArrayBuffer
    : data.slice().buffer as ArrayBuffer

/**
 * Key and nonce, both derived from the plaintext digest through one HKDF
 * expansion. `secret`, when given, is the HKDF salt — the per-hive value that
 * closes the confirmation oracle at the cost of cross-participant dedup.
 */
const deriveMaterial = async (
  plaintext: Uint8Array,
  secret?: Uint8Array,
): Promise<{ key: Uint8Array; nonce: Uint8Array }> => {
  const digest = await crypto.subtle.digest('SHA-256', bufferOf(plaintext))
  const ikm = await crypto.subtle.importKey('raw', digest, 'HKDF', false, ['deriveBits'])
  const salt = secret && secret.byteLength ? bufferOf(secret) : new ArrayBuffer(0)
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: bufferOf(view(INFO)) },
    ikm,
    (KEY_BYTES + NONCE_BYTES) * 8,
  )
  const material = new Uint8Array(bits)
  return { key: material.slice(0, KEY_BYTES), nonce: material.slice(KEY_BYTES) }
}

/**
 * Seal plaintext into the bytes that get signed and stored.
 *
 * Returns the sealed bytes AND the atom key. The caller signs `bytes` exactly
 * as it would sign plaintext today — the store, the walker and every host see
 * nothing but an opaque atom under an ordinary signature.
 */
export const sealAtom = async (
  plaintext: ArrayBuffer | Uint8Array,
  options?: { secret?: ArrayBuffer | Uint8Array },
): Promise<SealedAtom> => {
  const input = view(plaintext)
  const secret = options?.secret ? view(options.secret) : undefined
  const { key, nonce } = await deriveMaterial(input, secret)
  const aes = await crypto.subtle.importKey('raw', bufferOf(key), 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bufferOf(nonce) },
    aes,
    bufferOf(input),
  ))

  const bytes = new Uint8Array(HEADER_BYTES + sealed.byteLength)
  bytes.set(MAGIC, 0)
  bytes[MAGIC.length] = secret?.byteLength ? FLAG_SALTED : 0
  bytes.set(nonce, MAGIC.length + 1)
  bytes.set(sealed, HEADER_BYTES)
  return { bytes, key }
}

/**
 * Open a sealed atom with its key. Returns null rather than throwing on any
 * failure — a wrong key, a truncated atom and a plaintext atom are all just
 * "this did not open", and every caller has the same fallback.
 */
export const openAtom = async (
  sealed: ArrayBuffer | Uint8Array,
  key: ArrayBuffer | Uint8Array,
): Promise<Uint8Array | null> => {
  const input = view(sealed)
  if (!isSealed(input)) return null
  const nonce = input.subarray(MAGIC.length + 1, HEADER_BYTES)
  const body = input.subarray(HEADER_BYTES)
  try {
    const aes = await crypto.subtle.importKey('raw', bufferOf(view(key)), 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bufferOf(view(nonce)) },
      aes,
      bufferOf(view(body)),
    )
    return new Uint8Array(plain)
  } catch { return null }
}

/**
 * Does this atom carry the seal header? A cheap prefix test, so a read path
 * can carry sealed and plaintext atoms side by side without a registry saying
 * which is which — the bytes answer for themselves.
 *
 * Four magic bytes can collide with arbitrary plaintext; the AEAD tag is what
 * actually decides, and `openAtom` returning null is the real verdict.
 */
export const isSealed = (bytes: ArrayBuffer | Uint8Array): boolean => {
  const input = view(bytes)
  if (input.byteLength < HEADER_BYTES) return false
  for (let i = 0; i < MAGIC.length; i++) if (input[i] !== MAGIC[i]) return false
  return true
}

/** Was this atom sealed with a per-hive secret? Reading it needs that secret's
 *  holder, not just the atom key — worth knowing before offering a key. */
export const isSalted = (bytes: ArrayBuffer | Uint8Array): boolean =>
  isSealed(bytes) && (view(bytes)[MAGIC.length]! & FLAG_SALTED) !== 0

/** Bytes a seal adds, independent of payload size: header + AEAD tag. */
export const SEAL_OVERHEAD_BYTES = HEADER_BYTES + 16

// ── the door ────────────────────────────────────────────────────────────────
//
// Atom keys are convergent, which is what buys dedup and identical mirrors —
// and which makes them useless as an ACCESS mechanism, because deriving one
// needs the plaintext you are trying to read. Circular by construction.
//
// So the thing a reader actually holds is a key derived from a SECRET alone.
// That secret opens ONE atom — an index naming the closure and its atom keys —
// and everything else follows from what the index says. One door, then bytes.
//
// A CAPABILITY, NOT A CREDENTIAL. Nobody validates this. There is no server to
// ask, by design: the host is a static folder that serves ciphertext to anyone
// and learns nothing, every mirror behaves identically, and holding the secret
// IS the authorization. That is what keeps a host dumb while the content stays
// discreet.
//
// It follows — and is not a defect to be fixed later — that whoever receives
// the secret can pass it on, and that there is no revocation. Re-sealing under
// a new secret governs FUTURE bytes; every copy already fetched stays readable
// by whoever already held the old one. Rotation is cheap forward, impossible
// backward.
//
// The secret must reach a browser through the URL FRAGMENT, never the query
// string: fragments are not sent to the origin, so they stay out of its logs,
// its referrers and any proxy in between.

/** Derivation domain for secret-held keys. Separate from the atom domain, so
 *  the same bytes can never serve as both an atom key and a door key. */
const DOOR_INFO = new TextEncoder().encode('hypercomb/door/v1')
const DOOR_NONCE_INFO = new TextEncoder().encode('hypercomb/door/nonce/v1')

const deriveDoor = async (
  secret: Uint8Array,
  plaintext: Uint8Array,
): Promise<{ key: Uint8Array; nonce: Uint8Array }> => {
  const ikm = await crypto.subtle.importKey('raw', bufferOf(secret), 'HKDF', false, ['deriveBits'])
  const hkdf = { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0) } as const

  // The KEY comes from the secret and nothing else — that is what makes it
  // openable by someone who does not yet have the content.
  const keyBits = await crypto.subtle.deriveBits(
    { ...hkdf, info: bufferOf(view(DOOR_INFO)) }, ikm, KEY_BYTES * 8,
  )

  // The NONCE varies with the content, so one secret can seal many different
  // payloads without ever repeating a (key, nonce) pair — the failure that
  // would otherwise be fatal here, since the key is FIXED per secret. It is
  // derived rather than random so that re-sealing the same bytes is
  // idempotent, and it is stored in the header so a reader never derives it.
  const digest = await crypto.subtle.digest('SHA-256', bufferOf(plaintext))
  const info = new Uint8Array(DOOR_NONCE_INFO.length + digest.byteLength)
  info.set(DOOR_NONCE_INFO, 0)
  info.set(new Uint8Array(digest), DOOR_NONCE_INFO.length)
  const nonceBits = await crypto.subtle.deriveBits(
    { ...hkdf, info: bufferOf(info) }, ikm, NONCE_BYTES * 8,
  )

  return { key: new Uint8Array(keyBits), nonce: new Uint8Array(nonceBits) }
}

/**
 * Seal bytes so that holding `secret` is enough to open them — no content
 * knowledge required. This is the door: use it for the index that names a
 * closure and its atom keys, not for the content atoms themselves.
 */
export const sealToSecret = async (
  plaintext: ArrayBuffer | Uint8Array,
  secret: ArrayBuffer | Uint8Array,
): Promise<Uint8Array> => {
  const input = view(plaintext)
  const { key, nonce } = await deriveDoor(view(secret), input)
  const aes = await crypto.subtle.importKey('raw', bufferOf(key), 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bufferOf(nonce) }, aes, bufferOf(input),
  ))

  const bytes = new Uint8Array(HEADER_BYTES + sealed.byteLength)
  bytes.set(MAGIC, 0)
  bytes[MAGIC.length] = FLAG_SECRET
  bytes.set(nonce, MAGIC.length + 1)
  bytes.set(sealed, HEADER_BYTES)
  return bytes
}

/**
 * Open what `sealToSecret` sealed. Null on a wrong secret, a tampered atom, or
 * bytes that were never sealed this way — one fallback for every failure, so
 * no caller has to tell them apart.
 */
export const openWithSecret = async (
  sealed: ArrayBuffer | Uint8Array,
  secret: ArrayBuffer | Uint8Array,
): Promise<Uint8Array | null> => {
  const input = view(sealed)
  if (!needsSecret(input)) return null
  const nonce = input.subarray(MAGIC.length + 1, HEADER_BYTES)
  const body = input.subarray(HEADER_BYTES)
  try {
    const { key } = await deriveDoor(view(secret), new Uint8Array(0))
    const aes = await crypto.subtle.importKey('raw', bufferOf(key), 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bufferOf(view(nonce)) }, aes, bufferOf(view(body)),
    )
    return new Uint8Array(plain)
  } catch { return null }
}

/** Does opening this need a secret someone holds, rather than an atom key?
 *  Lets a reader tell "I need your token" from "I need the index" by looking
 *  at the bytes, with nothing else to consult. */
export const needsSecret = (bytes: ArrayBuffer | Uint8Array): boolean =>
  isSealed(bytes) && (view(bytes)[MAGIC.length]! & FLAG_SECRET) !== 0
