// sharing/sealed-adopt.ts
//
// THE ADOPTER'S HALF OF A PRIVATE VERSION (documentation/sealed-audiences.md; jwize 2026-11-05: "for adopters they show up
// as eggs in their hive … when they get the key they can see the content … they can have the content").
//
// An adopter holds a SIGNATURE: the root of a branch somebody offered. When the hosts do not hold that root in plain bytes,
// the adopt cannot land and the tile waits as an egg (swarm-adopt.drone.ts, #layEgg). This is the other way to reach those
// bytes: if the publisher sealed a private version of that very root to THIS device's key, open it and keep it.
//
//   root + publisher + hosts  →  the signed index names the envelopes for that root  →  the first with a seal for this key
//   opens (sealed-publish.ts)  →  every atom the key index names is opened, CHECKED against its plaintext signature
//   →  written to the local store under that plaintext signature.
//
// What lands is the publisher's own tree, byte for byte, under the signatures the publisher made it with — so the ordinary
// fold finds it locally and runs exactly as for any adopt, and the egg hatches into a tile the participant holds outright.
// Ciphertext is never written; the key and the host are no longer needed once this has run.
//
// Complete-or-absent: nothing is written unless every atom the key index names opened and verified. A key that opens a
// partial version, or a host that lost a ciphertext, leaves the egg an egg rather than a husk.

import { openPrivateForRoot, type OpenedVersion } from './sealed-publish.js'

const SIG = /^[0-9a-f]{64}$/

/** Where a branch's private versions may live: the hosts that carry its ciphertext, and whose signed index names them. */
export type SealedSource = {
  readonly hosts: readonly string[]
  /** The public key that signed the index (an adopter's offer carries it). */
  readonly publisher: string
}

export type LocalizeResult =
  | { ok: true; head: string; atoms: number; host: string }
  | { ok: false; reason: 'no-source' | 'no-version' | 'other-head' | 'incomplete' | 'unwritable' }

export type LocalizeDeps = {
  /** The first private version of the branch rooted at `root` that this device's key opens, from one host. */
  readonly open: (host: string, publisher: string, root: string) => Promise<OpenedVersion | null>
  /** Keep one verified plaintext atom under its signature. False when it did not land. */
  readonly put: (sig: string, bytes: Uint8Array) => Promise<boolean>
}

/** Open the private version of the branch rooted at `root` and keep every atom of it. Never throws. */
export async function localizeSealed(root: string, source: SealedSource, deps: LocalizeDeps = liveDeps()): Promise<LocalizeResult> {
  const want = String(root ?? '').toLowerCase()
  const publisher = String(source?.publisher ?? '').toLowerCase()
  const hosts = [...new Set((source?.hosts ?? []).map(host => String(host ?? '').trim()).filter(Boolean))]
  if (!SIG.test(want) || !SIG.test(publisher) || hosts.length === 0) return { ok: false, reason: 'no-source' }

  let opened: OpenedVersion | null = null
  let from = ''
  for (const host of hosts) {
    try { opened = await deps.open(host, publisher, want) } catch { opened = null }
    if (opened) { from = host; break }
  }
  if (!opened) return { ok: false, reason: 'no-version' }
  // The fold the adopter queued is for THIS signature; a key that opens a different head is a different version, not it.
  if (opened.head !== want) return { ok: false, reason: 'other-head' }

  const kept = new Map<string, Uint8Array>()
  for (const sig of opened.atoms) {
    const bytes = await opened.read(sig).catch(() => null)
    if (!bytes) return { ok: false, reason: 'incomplete' }
    kept.set(sig, bytes)
  }
  if (!kept.has(want)) return { ok: false, reason: 'incomplete' }
  for (const [sig, bytes] of kept) {
    if (bytes.byteLength === 0) continue
    if (!(await deps.put(sig, bytes).catch(() => false))) return { ok: false, reason: 'unwritable' }
  }
  return { ok: true, head: want, atoms: kept.size, host: from }
}

// ── the live collaborators ──

type StoreLike = { writeLayerBytes?: (signature: string, bytes: ArrayBuffer) => Promise<void> }

/** The store as the running hive has it. Every atom is written with `writeLayerBytes`: it puts a sig-named file at the flat
 *  root (layers and resources share that heap), refuses bytes that do not hash to their name, and leaves a complete copy
 *  alone. `putResource` is not used: it announces `content:wrote`, which reads as the participant AUTHORING something. */
const liveDeps = (): LocalizeDeps => ({
  open: openPrivateForRoot,
  put: async (sig, bytes) => {
    const store = (window as unknown as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.writeLayerBytes) return false
    try {
      await store.writeLayerBytes(sig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      return true
    } catch { return false }
  },
})
