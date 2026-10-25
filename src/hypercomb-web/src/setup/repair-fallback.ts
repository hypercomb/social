// hypercomb-web/src/setup/repair-fallback.ts
//
// A REPAIR THAT MISSES BECAUSE THE HEAD MOVED IS AN UPDATE, NOT A WIPE.
//
// Hosts are becoming head only (documentation/hosted-tenants.md §4): when a
// publisher's signed index moves, what only the old head reached answers as a
// plain 404. A hive whose installed package lost a few files — an interrupted
// write, a pool drained by hand — repairs them from its hosts for the SAME
// signature (ensure-install.ts repairInstalled). Once the host has moved on,
// those files are withdrawn there, the repair misses, and the old path wiped
// the install cache and cold-installed the head: a swap nobody asked for.
//
// The held-item rule says the opposite (documentation/using-a-creation.md,
// "Holding a published item"): the head you took stays until you upgrade or
// skip, and a newer head is a notice. So when the repair missed AND the host's
// install head is no longer the installed package AND the installed package
// still boots without what is missing, the shell boots it and raises the
// ordinary update notice (`update:available`, the update scout's payload).
//
// CONSERVATIVE — the wipe stays the answer whenever this cannot be sure:
//   - a missing dependency: an import-map hole can take down every bee that
//     imports it, so nothing here can say the package still boots;
//   - no learned render-critical bees for THIS package (critical-bees.ts), or
//     one of them missing: the hive would come up blank;
//   - more than a quarter of the bees missing: not a package any more;
//   - no head readable, a head that IS the installed package (the miss is a
//     real hole, not a move), or a head from a host the repair did not ask.
// Pure: every read is passed in.

import { hostZone } from '@hypercomb/runtime/host-zones'

const SIG = /^[0-9a-f]{64}$/

export type RepairFallback =
  | { kind: 'offer'; packageSig: string; source: 'channel' | 'door'; zone: string }
  | { kind: 'wipe'; reason: string }

export type MovedHead = { packageSig: string; zone: string; source: 'channel' | 'door' }

export type RepairFallbackInput = {
  installed: string | null
  bees: readonly string[]
  missingBees: readonly string[]
  missingDeps: readonly string[]
  /** The three render-critical bees learned for the installed package, or
   *  null when none are learned for it (critical-bees.ts). */
  critical: readonly string[] | null
  /** The zones the repair asked. */
  zones: readonly string[]
  /** Where the host's install head stands now, or null when unreadable. */
  head: () => Promise<MovedHead | null>
}

/** Can the installed package boot without what the repair could not fetch? */
export const stillBoots = (
  bees: readonly string[],
  missingBees: readonly string[],
  missingDeps: readonly string[],
  critical: readonly string[] | null,
): boolean => {
  if (missingDeps.length > 0) return false
  if (!critical || critical.length === 0) return false
  if (missingBees.some(sig => critical.includes(sig))) return false
  return missingBees.length * 4 <= bees.length
}

export const repairFallback = async (input: RepairFallbackInput): Promise<RepairFallback> => {
  const installed = String(input.installed ?? '').toLowerCase()
  if (!SIG.test(installed)) return { kind: 'wipe', reason: 'no installed package' }
  if (!stillBoots(input.bees, input.missingBees, input.missingDeps, input.critical)) {
    return { kind: 'wipe', reason: 'the installed package cannot boot without what is missing' }
  }
  let head: MovedHead | null = null
  try { head = await input.head() } catch { head = null }
  const moved = String(head?.packageSig ?? '').toLowerCase()
  if (!head || !SIG.test(moved)) return { kind: 'wipe', reason: 'no install head readable' }
  if (moved === installed) return { kind: 'wipe', reason: 'the head is the installed package — the misses are holes' }
  const asked = new Set(input.zones.map(hostZone).filter(Boolean))
  const zone = hostZone(head.zone)
  if (!zone || !asked.has(zone)) return { kind: 'wipe', reason: `the head was read from ${head.zone || 'nowhere'}, which the repair did not ask` }
  return { kind: 'offer', packageSig: moved, source: head.source, zone }
}
