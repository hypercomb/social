// hypercomb-runtime/src/held-dependencies.ts
//
// THE DEPENDENCIES THE BROOD IS HOLDING. A dependency draft (module-drafts.ts
// draftDependency) is written into the sign('dependencies') pool beside the
// trunk's bundle for the same namespace, and held in the brood until a hand
// rules on it. A picked bundle reaches the bag only through mayRunBee
// (composeDependencies), but a trunk's are kept whatever the brood says, so
// the import map leaves a held bag leaf out by itself, the rest of the bag
// still mapping. The FLAT SCANS — the import map's fallback when there is no
// usable bag, and the loader's scan when there is no alias map — read every
// file in the pool, and the first file listed for an alias won. A held draft
// could therefore run before anybody accepted it, here today and on every
// device it is carried to (documentation/module-sandbox.md, "Home, held").
//
// One roster walk per boot answers the question for the whole pool, rather
// than three storage reads per file. A signature with no brood record is not
// in the set, so every trunk dependency loads exactly as before: installs hold
// bees only, and mayRunBee runs anything never held.

import { broodRoster, mayRunBee, type BroodRecord } from '@hypercomb/core'

export type HeldDependencyDeps = {
  readonly roster: () => Promise<readonly BroodRecord[]>
  readonly mayRun: (sig: string) => Promise<boolean>
}

// Reached at call time, inside the try below, never at module load: a shell
// whose core cannot answer (or a spec that mocks core without the brood) then
// holds nothing rather than failing to boot.
const live: HeldDependencyDeps = { roster: () => broodRoster(), mayRun: sig => mayRunBee(sig) }

/** Every held signature the brood knows, pure (no `.js`). Fails closed per
 *  record: a ruling that cannot be read holds. Never throws: a roster that
 *  cannot be read holds nothing, which is the gate as it stood before. */
export const heldDependencies = async (deps: HeldDependencyDeps = live): Promise<ReadonlySet<string>> => {
  const held = new Set<string>()
  let roster: readonly BroodRecord[]
  try { roster = await deps.roster() } catch { return held }
  await Promise.all(roster.map(async record => {
    let runs = false
    try { runs = await deps.mayRun(record.sig) } catch { runs = false }
    if (!runs) held.add(record.sig)
  }))
  return held
}

/** The pool names a bundle `<sig>.js` or `<sig>`; the brood names it `<sig>`. */
export const isHeldDependency = (held: ReadonlySet<string>, name: string): boolean =>
  held.has(name.replace(/\.js$/i, '').toLowerCase())
