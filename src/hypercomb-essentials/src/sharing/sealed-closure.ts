// sharing/sealed-closure.ts
//
// A PRIVATE VERSION OF A BRANCH, AS BYTES (documentation/sealed-audiences.md, items 4 and 5; jwize 2026-10-25: "we can
// send the encrypted information there … and then the participants get the key to view it").
//
// The closure is every atom the branch's head reaches. Each atom is sealed convergently (content-cipher `sealAtom`), so
// the ciphertext has a signature of its own and a host carries it like any bytes. The KEY INDEX maps each plaintext
// signature to its ciphertext signature and key; it is itself sealed under the DOOR SECRET (`sealToSecret`), and the door
// secret reaches participants in an envelope (sealed-envelope.ts). Reading reverses it: secret → key index → for any
// plaintext signature a layer names, fetch the ciphertext, open it, and CHECK that the plaintext hashes to the signature
// asked for before handing it on. Plaintext is never written under the ciphertext's signature.
//
// Pure: bytes in, bytes out; fetching and uploading are injected.

import { SignatureService, openAtom, openWithSecret, sealAtom, sealToSecret } from '@hypercomb/core'
import { collectSigsDeep } from './decoration-closure.js'

const SIG = /^[0-9a-f]{64}$/
const KEY = /^[0-9a-f]{64}$/
export const CLOSURE_ATOMS_MAX = 20_000
export const KEY_INDEX_VERSION = 1

export type KeyIndex = {
  readonly v: 1
  /** The plaintext signature of the branch's head. */
  readonly head: string
  /** Per plaintext signature: the ciphertext's signature and the key that opens it. */
  readonly atoms: Readonly<Record<string, { readonly c: string; readonly k: string }>>
}

const hex = (bytes: Uint8Array): string => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
const unhex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g)!.map(pair => parseInt(pair, 16)))
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
export const signBytes = (bytes: Uint8Array): Promise<string> => SignatureService.sign(toBuffer(bytes))

/** Every atom `head` reaches that `getBytes` holds, by presence: JSON atoms are searched for the signatures they name. */
export async function collectClosure(head: string, getBytes: (sig: string) => Promise<Uint8Array | null>): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>()
  if (!SIG.test(head)) return found
  const queue = [head]
  const seen = new Set<string>(queue)
  while (queue.length && found.size < CLOSURE_ATOMS_MAX) {
    const sig = queue.shift()!
    const bytes = await getBytes(sig)
    if (!bytes) continue
    found.set(sig, bytes)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { continue }
    for (const next of collectSigsDeep(parsed)) if (!seen.has(next)) { seen.add(next); queue.push(next) }
  }
  return found
}

/** Seal a closure atom by atom. Refuses an atom whose bytes are not what its signature says. */
export async function sealClosure(
  atoms: ReadonlyMap<string, Uint8Array>,
  head: string,
  options: { salt?: Uint8Array } = {},
): Promise<{ keyIndex: KeyIndex; sealed: Map<string, Uint8Array> } | null> {
  if (!SIG.test(head) || !atoms.has(head)) return null
  const sealed = new Map<string, Uint8Array>()
  const index: Record<string, { c: string; k: string }> = {}
  for (const [sig, bytes] of atoms) {
    if (!SIG.test(sig) || (await signBytes(bytes)) !== sig) return null
    const atom = await sealAtom(bytes, options.salt ? { secret: options.salt } : undefined)
    const cipherSig = await signBytes(atom.bytes)
    sealed.set(cipherSig, atom.bytes)
    index[sig] = { c: cipherSig, k: hex(atom.key) }
  }
  return { keyIndex: { v: KEY_INDEX_VERSION, head, atoms: index }, sealed }
}

/** The key index sealed under the door secret: its bytes and its signature (what an envelope's `door` names). */
export async function sealKeyIndex(keyIndex: KeyIndex, secretHex: string): Promise<{ bytes: Uint8Array; sig: string } | null> {
  if (!KEY.test(secretHex)) return null
  const bytes = await sealToSecret(new TextEncoder().encode(JSON.stringify(keyIndex)), unhex(secretHex))
  return { bytes, sig: await signBytes(bytes) }
}

/** The key index a door secret opens, believed only as far as its shape; null for anything else. */
export async function openKeyIndex(doorBytes: Uint8Array, secretHex: string): Promise<KeyIndex | null> {
  if (!KEY.test(secretHex)) return null
  const plain = await openWithSecret(doorBytes, unhex(secretHex))
  if (!plain) return null
  let raw: Record<string, unknown>
  try { raw = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown> } catch { return null }
  if (raw?.['v'] !== KEY_INDEX_VERSION || !SIG.test(String(raw['head'] ?? ''))) return null
  const given = raw['atoms']
  if (!given || typeof given !== 'object' || Array.isArray(given)) return null
  const atoms: Record<string, { c: string; k: string }> = {}
  for (const [sig, value] of Object.entries(given as Record<string, unknown>)) {
    const entry = value as { c?: unknown; k?: unknown } | null
    if (!SIG.test(sig) || !entry || !SIG.test(String(entry.c ?? '')) || !KEY.test(String(entry.k ?? ''))) return null
    atoms[sig] = { c: String(entry.c), k: String(entry.k) }
  }
  return { v: KEY_INDEX_VERSION, head: String(raw['head']), atoms }
}

/** One plaintext atom, by the signature a layer names it with: fetch the ciphertext, open it, and hand it over only if
 *  it hashes to that signature. Null for an atom the index does not hold, a ciphertext that is missing, tampered or does
 *  not open, or plaintext that is not what was asked for. */
export async function openFromIndex(
  keyIndex: KeyIndex,
  plainSig: string,
  fetchBytes: (sig: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
  const entry = keyIndex.atoms[plainSig]
  if (!entry) return null
  const cipher = await fetchBytes(entry.c)
  if (!cipher || (await signBytes(cipher)) !== entry.c) return null
  const plain = await openAtom(cipher, unhex(entry.k))
  if (!plain || (await signBytes(plain)) !== plainSig) return null
  return plain
}
