// sharing/package-attestation.ts
//
// WHO VOUCHES FOR A PACKAGE — the attester runtime's activation gate asks
// (core attestation.types.ts; the rules in runtime/activation-authority.ts).
//
// The verifying material is the SAME follow record the update scout reads:
// the publisher key pinned by install-publisher.json (or the participant's
// own hc:install-follow), the hosts that serve that publisher's signed index,
// and the channel. A package is attested when the index verifies against the
// pinned key end-to-end (hive-pointer.ts: wrong key and bad signature are both
// FORGED, never "malformed") and its `install:<channel>` root IS the package.
//
// WITNESSED ROOTS. A signed index names only the CURRENT root, but every older
// root stays a valid build forever, and the hosts window offers them for
// pinning and rollback. So each root this attester has seen the followed key
// name is remembered under that key (hc:attested-packages, sig → pubkey), and
// a later ask for it is answered 'held' without a fetch. A root the followed
// key never named — a stranger's build, or one that was never stamped — is
// 'not-named'. Changing whom you follow empties the answer: a witness under
// another key is no witness.
//
// WHERE THE INDEX IS ASKED FOR. The followed hosts first (that is what they
// are for), then the offering domains and their `content.` faces — a host that
// serves the publisher's index vouches for its own head, and one that does not
// simply costs a 404. EVERY verified copy is read before 'not-named' is
// answered, because one host may hold a stale-but-authentic index naming the
// previous root. A FORGED read from any host outranks silence from the rest:
// a host serving an index that is not the publisher's is the loudest
// condition in the protocol.

import { ATTESTATION_IOC_KEY, type AttestationVerdict, type PackageAttestation } from '@hypercomb/core'
import { installRootOf } from './hive-link.js'
import { fetchHiveIndex, type HiveIndexResult } from './hive-pointer.js'
import { readInstallFollow, type InstallFollow } from './update-scout.service.js'

/** localStorage key: `{ "<packageSig>": "<pubkey that named it>" }`. */
export const ATTESTED_PACKAGES_KEY = 'hc:attested-packages'

const SIG_RE = /^[a-f0-9]{64}$/
const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type AttestDeps = {
  storage?: StorageLike
  /** The publisher this package names; defaults to install-publisher.json
   *  through readInstallFollow. Pass null to follow nobody. */
  publisher?: unknown
  fetchIndex?: typeof fetchHiveIndex
}

/** Every root a followed key has been seen to name. Unreadable = nothing. */
export const readWitnessed = (storage: StorageLike): Record<string, string> => {
  try {
    const raw = storage.getItem(ATTESTED_PACKAGES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [sig, key] of Object.entries(parsed as Record<string, unknown>)) {
      const k = String(key ?? '').toLowerCase()
      if (SIG_RE.test(sig) && SIG_RE.test(k)) out[sig] = k
    }
    return out
  } catch { return {} }
}

const witness = (storage: StorageLike, sig: string, pubkey: string): void => {
  const held = readWitnessed(storage)
  if (held[sig] === pubkey) return
  held[sig] = pubkey
  try { storage.setItem(ATTESTED_PACKAGES_KEY, JSON.stringify(held)) } catch { /* in-session only */ }
}

/** Every host worth asking for the followed publisher's index, in order:
 *  the followed hosts, then each offering zone and its `content.` face. */
export const indexHostsFor = (follow: InstallFollow, zones: readonly string[]): string[] => {
  const offered = zones.map(z => String(z ?? '').trim().toLowerCase()).filter(Boolean)
  const faces = offered.flatMap(z =>
    z.startsWith('content.') || LOOPBACK_RE.test(z) ? [z] : [z, `content.${z}`])
  return [...new Set([...follow.hosts, ...faces])]
}

export const attestPackage = async (
  packageSig: string,
  zones: readonly string[],
  deps: AttestDeps = {},
): Promise<AttestationVerdict> => {
  const storage = deps.storage ?? localStorage
  const sig = String(packageSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(sig)) return { ok: false, reason: 'not-named', detail: 'not a signature' }

  const follow = readInstallFollow(storage, 'publisher' in deps ? deps.publisher : undefined)
  if (!follow) return { ok: false, reason: 'no-follow' }

  // A witnessed root answers without a fetch — under the key followed NOW.
  if (readWitnessed(storage)[sig] === follow.pubkey) return { ok: true, pubkey: follow.pubkey, witnessed: 'held' }

  const fetchIndex = deps.fetchIndex ?? fetchHiveIndex
  let forged = false
  let named: string | null = null
  let verified = false
  for (const host of indexHostsFor(follow, zones)) {
    let result: HiveIndexResult
    try { result = await fetchIndex(host, follow.pubkey) } catch { continue }
    if (!result.ok) { if (result.reason === 'forged') forged = true; continue }
    verified = true
    const root = installRootOf(result.manifest.roots, follow.channel)
    if (!root) continue
    // Everything the followed key names is worth remembering — the current
    // root today is a rollback row tomorrow.
    witness(storage, root, follow.pubkey)
    named ??= root
    if (root === sig) return { ok: true, pubkey: follow.pubkey, witnessed: 'current' }
  }

  if (verified) {
    return {
      ok: false,
      reason: 'not-named',
      detail: named
        ? `the followed publisher currently names ${named.slice(0, 12)}…`
        : `the followed publisher names no ${follow.channel} root`,
    }
  }
  return forged ? { ok: false, reason: 'forged' } : { ok: false, reason: 'unreachable' }
}

const attestation: PackageAttestation = {
  attest: (packageSig, zones) => attestPackage(packageSig, zones),
}

if (typeof window !== 'undefined') {
  window.ioc?.register?.(ATTESTATION_IOC_KEY, attestation)
}
