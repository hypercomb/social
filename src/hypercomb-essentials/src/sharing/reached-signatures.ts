// sharing/reached-signatures.ts
//
// WHAT A HEAD REACHES — every signature its layers name, by the host's own
// reach rule (documentation/hosted-tenants.md §4, `genome.rs` harvest): a
// string value that is a whole signature, in every field except the referent
// fields, which point at the past. Taking a new head hatches the eggs for what
// it reaches (core eggs.ts `eggs:hatch`): a head-only host answers a withdrawn
// old version as a plain 404 and serves it again on a revert, and a miss laid
// under the old head must not keep the new one from being asked for.
//
// Pure and bounded. Layers already in hand are read; nothing is fetched.

const SIG = /^[0-9a-f]{64}$/
/** Fields that point at the past, never at what the head holds. */
const REFERENT_FIELDS = new Set(['prev', 'seal', 'groupSig', 'targetSig', 'pubkey'])
/** The host's walk budget (2000 members): past it, stop — a hint, not a census. */
const MAX_REACHED = 2000

export function reachedSignatures(layers: Iterable<unknown>, also: Iterable<string> = []): string[] {
  const out = new Set<string>()
  const add = (value: string): void => { const sig = value.toLowerCase(); if (SIG.test(sig)) out.add(sig) }
  for (const sig of also) add(String(sig ?? ''))
  const visit = (value: unknown, depth: number): void => {
    if (out.size >= MAX_REACHED || depth > 16) return
    if (typeof value === 'string') { add(value); return }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (!REFERENT_FIELDS.has(key)) visit(item, depth + 1)
      }
    }
  }
  for (const layer of layers) visit(layer, 0)
  return [...out].slice(0, MAX_REACHED)
}
