// diamondcoreprocessor.com/sharing/update-scout.service.ts
//
// The signed-sentinel update consumer (install-by-replication.md, step 5):
// once per boot, off the critical path, ask the publisher's hive index
// whether the followed install channel has moved past what this hive runs,
// and light the update pill when it has. The affordance is the EXISTING
// upgrade indicator — this scout only emits `update:available`; adopt/review
// keep their current paths (DCP resolves the package by signature).
//
// Demand-driven by doctrine: one check per boot, no push channel, no
// subscriptions to content writes. The consumer asks; the icon is the
// answer; the human decides.
//
// Trust: the follow record PINS the publisher pubkey, and
// fetchHiveManifestFromAny re-verifies the index signature against it
// end-to-end — a host can withhold an index but never substitute one.
// The scout is DORMANT until the participant follows a channel:
//
//   localStorage['hc:install-follow'] =
//     '{"pubkey":"<64-hex>","hosts":["content.pluginthematrix.com"],"channel":"essentials"}'
//
// (Seeded by hand today; an adoption/DCP flow can write it later. hosts may
// be omitted — the standing public content endpoint is the default.)
//
// Silence rules — the scout only ever ANNOUNCES a divergence, never argues:
//   - no follow record            → dormant (the bundled check still runs)
//   - no installed sig recorded   → silent (genesis belongs to install flows)
//   - index unreachable/forged    → silent (fetchHiveManifestFromAny → null)
//   - channel root absent         → silent
//   - root equals installed sig   → silent (never emits available:false —
//     the shell's bundled check owns that verdict, and clobbering it via
//     the EffectBus last-value replay would hide a real bundled update)

import { EffectBus } from '@hypercomb/core'
import { fetchHiveManifestFromAny } from './hive-pointer.js'
import { installRootOf, PUBLIC_CONTENT_HOSTS } from './hive-link.js'

export const INSTALL_FOLLOW_KEY = 'hc:install-follow'
/** The web shell's installed-package stamp (ensure-install's SYNC_SIG_KEY). */
const INSTALLED_SIG_KEY = 'sentinel.sync-signature'
/** Off the boot path — after first paint, bees, and the shell's own
 *  bundled-diff check (which runs at boot). */
const BOOT_CHECK_DELAY_MS = 12_000

const SIG_RE = /^[a-f0-9]{64}$/

export interface InstallFollow {
  pubkey: string
  hosts: string[]
  channel: string
}

/** Parse + validate the follow record. Null when absent or malformed —
 *  malformed follows are treated as no follow, never as a broken boot. */
export function readInstallFollow(storage: Pick<Storage, 'getItem'>): InstallFollow | null {
  let raw: string | null
  try { raw = storage.getItem(INSTALL_FOLLOW_KEY) } catch { return null }
  if (!raw) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { return null }
  const pubkey = String(parsed?.['pubkey'] ?? '').trim().toLowerCase()
  if (!SIG_RE.test(pubkey)) return null
  const rawHosts = parsed?.['hosts']
  const hosts = Array.isArray(rawHosts)
    ? rawHosts.map(h => String(h ?? '').trim().toLowerCase()).filter(Boolean)
    : []
  const channel = String(parsed?.['channel'] ?? '').trim().toLowerCase() || 'essentials'
  return { pubkey, hosts: hosts.length ? hosts : [...PUBLIC_CONTENT_HOSTS], channel }
}

/** The pure verdict: the sig to announce, or null for silence. `roots` must
 *  come from an ALREADY-VERIFIED index. */
export function scoutVerdict(
  roots: Record<string, string>,
  channel: string,
  installedSig: string | null,
): string | null {
  const installed = String(installedSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(installed)) return null          // genesis is not an update
  const published = installRootOf(roots, channel)
  if (!published || published === installed) return null
  return published
}

type ScoutDeps = {
  fetchManifest?: typeof fetchHiveManifestFromAny
  storage?: Pick<Storage, 'getItem'>
  emit?: (payload: Record<string, unknown>) => void
}

export class UpdateScoutService {

  /** One demand-driven check. Returns the announced sig, or null. */
  public readonly check = async (deps: ScoutDeps = {}): Promise<string | null> => {
    const storage = deps.storage ?? localStorage
    const follow = readInstallFollow(storage)
    if (!follow) return null

    const fetchManifest = deps.fetchManifest ?? fetchHiveManifestFromAny
    const manifest = await fetchManifest(follow.hosts, follow.pubkey)
    if (!manifest) return null

    let installed: string | null
    try { installed = storage.getItem(INSTALLED_SIG_KEY) } catch { return null }
    const sig = scoutVerdict(manifest.roots, follow.channel, installed)
    if (!sig) return null

    const emit = deps.emit ?? (payload => EffectBus.emit('update:available', payload))
    emit({ available: true, newCount: 0, newBees: [], packageSig: sig, previous: null, label: '' })
    return sig
  }
}

const scout = new UpdateScoutService()
window.ioc?.register?.('@diamondcoreprocessor.com/UpdateScoutService', scout)
// One check per boot, well after first paint and the shell's bundled check.
if (typeof window !== 'undefined') {
  setTimeout(() => { void scout.check() }, BOOT_CHECK_DELAY_MS)
}
